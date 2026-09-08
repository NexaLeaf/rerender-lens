/**
 * Fiber-tree inspection. Runs after every React commit via the DevTools global
 * hook, exactly like React DevTools itself. Element types are never touched, so
 * Fast Refresh, memo comparators and component identity all stay intact.
 */
import type { Change, HookChange, ParentInfo, RenderTrigger, SourceLocation } from './types';
import { classify, diffRecords } from './diff';
import { buildReport } from './report';
import { dispatch, getState, warnOnce } from './state';
import { getDisplayName, shouldTrack } from './tracker';

// React work tags (stable since 16.9).
const FunctionComponent = 0;
const ClassComponent = 1;
const HostRoot = 3;
const HostComponent = 5;
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
  /** React <= 18 with the JSX dev transform. */
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
  /** React 19: an Error captured where the element was created. */
  _debugStack?: { stack?: string } | string | null;
  actualDuration?: number;
}

export interface FiberRoot {
  current: Fiber;
}

/** What `react-dom` passes to `hook.inject`. */
export interface RendererInfo {
  version?: string;
  /** 1 = development build, 0 = production build. */
  bundleType?: number;
  rendererPackageName?: string;
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

/**
 * Renderers seen through `hook.inject`. Hooks created by react-refresh (Vite's preamble) never
 * fill `hook.renderers`, so `attach` wraps `inject` and records what react-dom registers.
 */
const capturedRenderers = new Map<number, RendererInfo>();
const INJECT_WRAPPED = Symbol.for('rerender-lens.injectWrapped');

function pickRenderer(r: unknown): RendererInfo {
  const info = (r ?? {}) as RendererInfo;
  return { version: info.version, bundleType: info.bundleType, rendererPackageName: info.rendererPackageName };
}

function wrapInject(hook: DevtoolsHook): void {
  const h = hook as DevtoolsHook & { [INJECT_WRAPPED]?: boolean };
  if (h[INJECT_WRAPPED] || typeof hook.inject !== 'function') return;
  const original = hook.inject;
  hook.inject = function (this: unknown, renderer: unknown) {
    const id = original.call(this, renderer);
    capturedRenderers.set(typeof id === 'number' ? id : capturedRenderers.size + 1, pickRenderer(renderer));
    return id;
  };
  h[INJECT_WRAPPED] = true;
}

/** Start observing commits. Returns a function that stops observing. */
export function attach(): () => void {
  const hook = ensureDevtoolsHook();
  wrapInject(hook);
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

/** The renderers React registered on the hook (version and dev/prod bundle type). */
export function getRenderers(): RendererInfo[] {
  const g = globalThis as unknown as Record<string, DevtoolsHook | undefined>;
  const hook = g[HOOK];
  const byId = new Map<number, RendererInfo>(capturedRenderers);
  if (hook && hook.renderers && typeof hook.renderers.forEach === 'function') {
    hook.renderers.forEach((r, id) => {
      if (!byId.has(id)) byId.set(id, pickRenderer(r));
    });
  }
  return [...byId.values()];
}

/** True when every registered React renderer is a production build (names minified, no hook labels). */
export function isProductionReact(): boolean {
  const renderers = getRenderers();
  return renderers.length > 0 && renderers.every((r) => r.bundleType === 0);
}

const flagsOf = (f: Fiber): number => f.flags ?? f.effectTag ?? 0;

const isComponentTag = (tag: number): boolean =>
  tag === FunctionComponent || tag === ClassComponent || tag === ForwardRef || tag === MemoComponent || tag === SimpleMemoComponent;

/** `React.memo` fibers, or class instances that extend `PureComponent`. */
export function isMemoizedFiber(fiber: Fiber): boolean {
  if (fiber.tag === MemoComponent || fiber.tag === SimpleMemoComponent) return true;
  if (fiber.tag === ClassComponent) {
    const inst = fiber.stateNode as { isPureReactComponent?: boolean } | null;
    return !!(inst && inst.isPureReactComponent);
  }
  return false;
}

/**
 * Timing from React's profiler fields. `actualDuration` covers the subtree; children that bailed
 * out were reset to 0 by `createWorkInProgress`, so subtracting the direct children leaves self time.
 */
export function durationsOf(fiber: Fiber): { self: number; tree: number } | null {
  if (typeof fiber.actualDuration !== 'number') return null;
  const tree = fiber.actualDuration;
  let children = 0;
  for (let c = fiber.child; c; c = c.sibling) if (typeof c.actualDuration === 'number') children += c.actualDuration;
  return { self: Math.max(0, tree - children), tree };
}

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
/** Reverse lookup for the DevTools bridge (highlight, inspect). Weak so unmounted fibers can be collected. */
const fibersById = new Map<number, WeakRef<Fiber>>();
const hasWeakRef = typeof WeakRef === 'function';

function remember(id: number, fiber: Fiber): void {
  if (!hasWeakRef) return;
  fibersById.set(id, new WeakRef(fiber));
  if (fibersById.size > 5000) {
    for (const [k, ref] of fibersById) if (!ref.deref()) fibersById.delete(k);
  }
}

/** Instance id of a fiber if it has already been reported, without assigning one. */
export function instanceIdOf(fiber: Fiber): number | undefined {
  return ids.get(fiber) ?? (fiber.alternate ? ids.get(fiber.alternate) : undefined);
}

/** The most recent fiber object known for an instance id, or null when it was unmounted or never reported. */
export function fiberById(id: number): Fiber | null {
  const f = fibersById.get(id)?.deref() ?? null;
  if (!f) return null;
  // Prefer the alternate when it is newer (React swaps the pair on every render).
  const alt = f.alternate;
  if (alt && counts.get(alt) !== undefined && (counts.get(alt) ?? 0) > (counts.get(f) ?? 0)) return alt;
  return f;
}

function instanceId(fiber: Fiber): number {
  const existing = instanceIdOf(fiber);
  if (existing !== undefined) {
    ids.set(fiber, existing);
    remember(existing, fiber);
    return existing;
  }
  const s = getState();
  const id = s.nextInstanceId++;
  ids.set(fiber, id);
  remember(id, fiber);
  return id;
}

/** DOM nodes rendered directly by a component fiber (stops at the first host node on every branch). */
export function hostNodesOf(fiber: Fiber, limit = 50): Element[] {
  const out: Element[] = [];
  const stack: Fiber[] = [];
  for (let c = fiber.child; c; c = c.sibling) stack.push(c);
  while (stack.length && out.length < limit) {
    const f = stack.pop()!;
    if (f.tag === HostComponent) {
      if (typeof Element !== 'undefined' && f.stateNode instanceof Element) out.push(f.stateNode);
      continue;
    }
    for (let c = f.child; c; c = c.sibling) stack.push(c);
  }
  return out;
}

/** The fiber React attached to a DOM node, if any. */
export function fiberForNode(node: unknown): Fiber | null {
  if (!node || typeof node !== 'object') return null;
  const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  return key ? ((node as Record<string, Fiber | null>)[key] ?? null) : null;
}

/** Nearest component fiber at or above `fiber`. */
export function nearestComponent(fiber: Fiber | null): Fiber | null {
  let f: Fiber | null = fiber;
  while (f && f.tag !== HostRoot) {
    if (isComponentTag(f.tag)) return f;
    f = f.return;
  }
  return null;
}

const INTERNAL_FRAME = /react-dom|react_jsx|jsx-(dev-)?runtime|\/react\/|node_modules\/react|react-stack-bottom-frame|react_stack_bottom_frame|scheduler/;

/** Parse the first application frame out of a stack string (React 19 `_debugStack`). */
export function parseStackLocation(stack: string): SourceLocation | undefined {
  for (const line of stack.split('\n')) {
    const m = /(?:at\s+(?:.*?\s+)?\(?|@)?((?:https?|file|webpack|vite|blob):[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (!m || !m[1] || INTERNAL_FRAME.test(m[1])) continue;
    return { fileName: m[1], lineNumber: Number(m[2]), columnNumber: Number(m[3]) };
  }
  return undefined;
}

export function sourceOf(fiber: Fiber): SourceLocation | undefined {
  const src = fiber._debugSource;
  if (src && typeof src.fileName === 'string') {
    const out: SourceLocation = { fileName: src.fileName };
    if (typeof src.lineNumber === 'number') out.lineNumber = src.lineNumber;
    if (typeof src.columnNumber === 'number') out.columnNumber = src.columnNumber;
    return out;
  }
  const st = fiber._debugStack;
  const text = typeof st === 'string' ? st : st && typeof st.stack === 'string' ? st.stack : null;
  return text ? parseStackLocation(text) : undefined;
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
  if (rendered.length === 0) return;
  const commitId = s.nextCommitId++;
  const parentCache = new Map<Fiber, ParentInfo | null>();
  for (const fiber of rendered) {
    const alt = fiber.alternate!;
    const a = analyze(fiber, alt, trackHooks);
    const durations = durationsOf(fiber);
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
      memoized: isMemoizedFiber(fiber),
      selfDuration: durations ? durations.self : undefined,
      treeDuration: durations ? durations.tree : undefined,
      commitId,
      source: sourceOf(fiber),
    });
    dispatch(report);
  }
}
