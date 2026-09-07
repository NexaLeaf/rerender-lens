/**
 * Fiber-tree inspection. Runs after every React commit via the DevTools global
 * hook, exactly like React DevTools itself. Element types are never touched, so
 * Fast Refresh, memo comparators and component identity all stay intact.
 */
import type { Change, HookChange, ParentInfo, RenderTrigger } from './types';
import { classify, diffRecords } from './diff';
import { buildReport } from './report';
import { dispatch, getState, warnOnce } from './state';
import { getDisplayName, shouldTrack } from './tracker';

// React work tags (stable since 16.9).
const FunctionComponent = 0;
const ClassComponent = 1;
const HostRoot = 3;
const ForwardRef = 11;
const MemoComponent = 14;
const SimpleMemoComponent = 15;
const PerformedWork = 1;

export interface ContextDependency {
  context: { displayName?: string; _currentValue?: unknown };
  memoizedValue: unknown;
  next: ContextDependency | null;
}

export interface HookNode {
  memoizedState: unknown;
  queue: { lastRenderedReducer?: (...a: unknown[]) => unknown; dispatch?: unknown; getSnapshot?: unknown } | null;
  next: HookNode | null;
}

export interface Fiber {
  tag: number;
  key: unknown;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  memoizedState: unknown;
  alternate: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  flags?: number;
  /** React 16 name for `flags`. */
  effectTag?: number;
  dependencies?: { firstContext: ContextDependency | null } | null;
  _debugOwner?: { type?: unknown; name?: string } | null;
  _debugHookTypes?: string[] | null;
  actualDuration?: number;
}

export interface FiberRoot {
  current: Fiber;
}

export interface DevtoolsHook {
  renderers: Map<number, unknown>;
  supportsFiber: boolean;
  inject(renderer: unknown): number;
  onCommitFiberRoot?: (id: number, root: FiberRoot, priority?: unknown, didError?: boolean) => void;
  onCommitFiberUnmount?: (id: number, fiber: Fiber) => void;
  onScheduleFiberRoot?: (id: number, root: FiberRoot, children: unknown) => void;
  onPostCommitFiberRoot?: (id: number, root: FiberRoot) => void;
  isDisabled?: boolean;
}

const HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

/**
 * Make sure `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` exists. React DOM only looks
 * for it once, when the `react-dom` module is evaluated, so this must run before
 * that unless the React DevTools extension or Fast Refresh already created it.
 */
export function ensureDevtoolsHook(): DevtoolsHook {
  const g = globalThis as unknown as Record<string, DevtoolsHook | undefined>;
  let hook = g[HOOK];
  if (!hook) {
    let nextId = 0;
    const renderers = new Map<number, unknown>();
    hook = {
      renderers,
      supportsFiber: true,
      inject(renderer) {
        const id = ++nextId;
        renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onScheduleFiberRoot() {},
      onPostCommitFiberRoot() {},
    };
    g[HOOK] = hook;
  }
  return hook;
}

/** Start observing commits. Returns a function that stops observing. */
export function attach(): () => void {
  const hook = ensureDevtoolsHook();
  const previous = hook.onCommitFiberRoot;
  const patched: DevtoolsHook['onCommitFiberRoot'] = function (this: unknown, id, root, priority, didError) {
    try {
      onCommit(root);
    } catch (err) {
      warnOnce('commit', `failed to inspect a commit: ${String(err)}`);
    }
    if (typeof previous === 'function') return previous.call(this, id, root, priority, didError);
  };
  hook.onCommitFiberRoot = patched;
  return () => {
    if (hook.onCommitFiberRoot === patched) hook.onCommitFiberRoot = previous;
  };
}

const flagsOf = (f: Fiber): number => f.flags ?? f.effectTag ?? 0;

const isComponentTag = (tag: number): boolean =>
  tag === FunctionComponent || tag === ClassComponent || tag === ForwardRef || tag === MemoComponent || tag === SimpleMemoComponent;

/** The value React DevTools would show as the fiber's type (memo/forwardRef outer object when present). */
export function fiberType(fiber: Fiber): unknown {
  return fiber.elementType ?? fiber.type;
}

export function fiberName(fiber: Fiber): string {
  return getDisplayName(fiberType(fiber));
}

/** Was this fiber's component function/class executed in the commit that produced it? */
function didRender(fiber: Fiber): boolean {
  return (flagsOf(fiber) & PerformedWork) !== 0;
}

/** True when Fast Refresh swapped the component code for this fiber in the last render. */
function isHotSwapped(fiber: Fiber, alt: Fiber): boolean {
  return fiber.type !== alt.type;
}

// Per-fiber bookkeeping. Fibers alternate between two objects, so look up both.
const counts = new WeakMap<Fiber, number>();
const ids = new WeakMap<Fiber, number>();

function instanceId(fiber: Fiber): number {
  const existing = ids.get(fiber) ?? (fiber.alternate ? ids.get(fiber.alternate) : undefined);
  if (existing !== undefined) {
    ids.set(fiber, existing);
    return existing;
  }
  const s = getState();
  const id = s.nextInstanceId++;
  ids.set(fiber, id);
  return id;
}

function bumpCount(fiber: Fiber): number {
  const prev = counts.get(fiber) ?? (fiber.alternate ? counts.get(fiber.alternate) : undefined) ?? 0;
  const n = prev + 1;
  counts.set(fiber, n);
  return n;
}

function componentPath(fiber: Fiber): string[] {
  const path: string[] = [];
  let f: Fiber | null = fiber.return;
  while (f && f.tag !== HostRoot) {
    if (isComponentTag(f.tag)) path.unshift(fiberName(f));
    f = f.return;
  }
  return path;
}

function ownerName(fiber: Fiber): string | null {
  const owner = fiber._debugOwner;
  if (!owner) return null;
  if (owner.type !== undefined) return getDisplayName(owner.type);
  return typeof owner.name === 'string' ? owner.name : null;
}

const isStateNode = (n: HookNode): boolean => !!n.queue && typeof n.queue.lastRenderedReducer === 'function';
const isStoreNode = (n: HookNode): boolean => !!n.queue && typeof n.queue.getSnapshot === 'function';

function hookLabel(node: HookNode): string {
  if (isStoreNode(node)) return 'useSyncExternalStore';
  if (isStateNode(node)) {
    const r = node.queue!.lastRenderedReducer!;
    return r.name === 'basicStateReducer' ? 'useState' : 'useReducer';
  }
  return 'state';
}

/** Hooks that never create a node in `memoizedState`. */
const NODELESS_HOOKS = new Set(['useContext', 'useDebugValue', 'use']);

/** Diff the state-bearing hook nodes of a function component. */
function diffHooks(fiber: Fiber, alt: Fiber): HookChange[] {
  const out: HookChange[] = [];
  if (fiber.tag === ClassComponent) return out;
  let a = alt.memoizedState as HookNode | null;
  let b = fiber.memoizedState as HookNode | null;
  if (!a || !b || typeof b !== 'object' || !('next' in b)) return out;

  // Only trust the dev hook-type list when it maps 1:1 onto the node list.
  const types = fiber._debugHookTypes?.filter((t) => !NODELESS_HOOKS.has(t));
  let nodeCount = 0;
  for (let n: HookNode | null = b; n; n = n.next) nodeCount++;
  const labels = types && types.length === nodeCount ? types : null;

  let i = 0;
  while (a && b) {
    if ((isStateNode(b) || isStoreNode(b)) && !Object.is(a.memoizedState, b.memoizedState)) {
      const hook = labels?.[i] ?? hookLabel(b);
      out.push({
        path: `${hook}#${i}`,
        hook,
        index: i,
        kind: classify(a.memoizedState, b.memoizedState),
        prev: a.memoizedState,
        next: b.memoizedState,
      });
    }
    a = a.next;
    b = b.next;
    i++;
  }
  return out;
}

/** Diff the contexts this fiber reads. */
function diffContexts(fiber: Fiber, alt: Fiber): HookChange[] {
  const out: HookChange[] = [];
  let a = alt.dependencies?.firstContext ?? null;
  let b = fiber.dependencies?.firstContext ?? null;
  let i = 0;
  while (a && b) {
    if (a.context === b.context && !Object.is(a.memoizedValue, b.memoizedValue)) {
      const name = b.context.displayName ?? 'Context';
      out.push({
        path: `useContext(${name})`,
        hook: 'useContext',
        index: i,
        kind: classify(a.memoizedValue, b.memoizedValue),
        prev: a.memoizedValue,
        next: b.memoizedValue,
      });
    }
    a = a.next;
    b = b.next;
    i++;
  }
  return out;
}

const isGenuine = (c: Change): boolean => c.kind === 'different' || c.kind === 'added' || c.kind === 'removed';

interface Analysis {
  propChanges: Change[];
  stateChanges: Change[];
  hookChanges: HookChange[];
  trigger: RenderTrigger;
}

function analyze(fiber: Fiber, alt: Fiber, trackHooks: boolean): Analysis {
  const prevProps = alt.memoizedProps ?? {};
  const nextProps = fiber.memoizedProps ?? {};
  const propChanges = prevProps === nextProps ? [] : diffRecords(prevProps, nextProps);
  let stateChanges: Change[] = [];
  let hookChanges: HookChange[] = [];
  if (fiber.tag === ClassComponent) {
    if (alt.memoizedState !== fiber.memoizedState) {
      stateChanges = diffRecords(
        (alt.memoizedState as Record<string, unknown>) ?? {},
        (fiber.memoizedState as Record<string, unknown>) ?? {},
      );
    }
  } else if (trackHooks) {
    hookChanges = [...diffHooks(fiber, alt), ...diffContexts(fiber, alt)];
  }
  const isStateHook = (h: HookChange): boolean => h.hook !== 'useContext' && h.hook !== 'useSyncExternalStore';
  const causes: RenderTrigger[] = [];
  if (propChanges.some(isGenuine)) causes.push('props');
  if (stateChanges.some(isGenuine) || hookChanges.some((h) => isStateHook(h) && isGenuine(h))) causes.push('state');
  if (hookChanges.some((h) => !isStateHook(h) && isGenuine(h))) causes.push('hooks');
  const trigger: RenderTrigger = causes.length === 0 ? 'parent' : causes.length === 1 ? causes[0]! : 'mixed';
  return { propChanges, stateChanges, hookChanges, trigger };
}

function nearestRenderedAncestor(fiber: Fiber, cache: Map<Fiber, ParentInfo | null>, trackHooks: boolean): ParentInfo | null {
  let f: Fiber | null = fiber.return;
  while (f && f.tag !== HostRoot) {
    if (isComponentTag(f.tag) && f.alternate && didRender(f)) {
      let info = cache.get(f);
      if (info === undefined) {
        info = { name: fiberName(f), trigger: analyze(f, f.alternate, trackHooks).trigger };
        cache.set(f, info);
      }
      return info;
    }
    f = f.return;
  }
  return null;
}

/** Inspect one committed root. */
export function onCommit(root: FiberRoot): void {
  const s = getState();
  if (!s.enabled) return;
  const o = s.options;
  const trackHooks = o.trackHooks !== false;

  const rendered: Fiber[] = [];
  let hot = false;
  const stack: Fiber[] = [root.current];
  while (stack.length) {
    const fiber = stack.pop()!;
    const alt = fiber.alternate;
    if (alt && isComponentTag(fiber.tag) && didRender(fiber)) {
      if (isHotSwapped(fiber, alt)) hot = true;
      if (shouldTrack(fiberType(fiber), o)) rendered.push(fiber);
    }
    // A bailed-out subtree keeps the same child fiber objects; nothing below it rendered.
    if (!alt || fiber.child !== alt.child) {
      for (let c = fiber.child; c; c = c.sibling) stack.push(c);
    }
  }
  if (hot && o.ignoreHotReload !== false) return;

  // Depth-first pop order is reversed; restore document order for readable output.
  rendered.reverse();
  const parentCache = new Map<Fiber, ParentInfo | null>();
  for (const fiber of rendered) {
    const alt = fiber.alternate!;
    const a = analyze(fiber, alt, trackHooks);
    const report = buildReport({
      component: fiberName(fiber),
      instanceId: instanceId(fiber),
      renderCount: bumpCount(fiber),
      prevProps: alt.memoizedProps ?? {},
      nextProps: fiber.memoizedProps ?? {},
      propChanges: a.propChanges,
      stateChanges: a.stateChanges,
      hookChanges: a.hookChanges,
      parent: a.trigger === 'parent' ? nearestRenderedAncestor(fiber, parentCache, trackHooks) : null,
      owner: ownerName(fiber),
      path: componentPath(fiber),
      selfDuration: typeof fiber.actualDuration === 'number' ? fiber.actualDuration : undefined,
    });
    dispatch(report);
  }
}
