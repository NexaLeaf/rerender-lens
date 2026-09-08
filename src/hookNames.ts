/**
 * Custom hook names, opt-in (`resolveHookNames`). React keeps no record of which custom hook
 * called a primitive, so, like React DevTools, we re-run the component once with a stand-in
 * dispatcher: every primitive records the call stack, and the frames between the primitive and the
 * component are the custom hooks. Values come from the fiber's real hook nodes so the component
 * takes the same code path. Results are cached per component type; a throwing render yields no names.
 */
import type { Fiber, HookNode } from './fiber';

/** `currentDispatcherRef` as react-dom injects it: `{ current }` (React 16-18) or the shared internals `{ H }` (React 19). */
export type DispatcherRef = { current?: unknown; H?: unknown };

type Dispatcher = Record<string, (...args: unknown[]) => unknown>;

/** Hook nodes each primitive appends to `memoizedState` (React 18/19 dev). Primitives not listed use none. */
const NODE_COUNT: Record<string, number> = {
  useState: 1,
  useReducer: 1,
  useRef: 1,
  useMemo: 1,
  useCallback: 1,
  useEffect: 1,
  useLayoutEffect: 1,
  useInsertionEffect: 1,
  useImperativeHandle: 1,
  useSyncExternalStore: 2,
  useTransition: 2,
  useDeferredValue: 1,
  useId: 1,
  useOptimistic: 1,
  useActionState: 3,
  useFormState: 3,
  useEffectEvent: 1,
  useCacheRefresh: 1,
};

/** Every React primitive: frames with these names are React's own wrappers, never a custom hook. */
const BUILTIN_HOOKS = new Set([...Object.keys(NODE_COUNT), 'useContext', 'useDebugValue', 'use']);

const noop = (): void => {};

/** Function names in the frames between our dispatcher and the component (innermost first). */
export function customHooksFromStack(stack: string, componentName: string, marker: string): string[] {
  const names: string[] = [];
  let past = false;
  for (const line of stack.split('\n')) {
    const m = /^\s*at\s+(?:async\s+)?([^\s(]+)|^([^@\s]+)@/.exec(line);
    const name = m ? (m[1] || m[2] || '').replace(/^Object\./, '').replace(/^Proxy\./, '') : '';
    if (!name) continue;
    if (!past) {
      if (name.includes(marker)) past = true;
      continue;
    }
    if (name === componentName || name.endsWith('.' + componentName)) break;
    // React 18's `react` entry wraps each primitive in a named function (`useState` -> dispatcher.useState),
    // which puts a frame with the primitive's own name between our dispatcher and the custom hook.
    if (/^use[A-Z0-9_]/.test(name) && !BUILTIN_HOOKS.has(name)) names.push(name);
    if (names.length > 8) break;
  }
  return names;
}

interface Replay {
  /** node index -> custom hook chain */
  byNode: Map<number, string[]>;
  ok: boolean;
}

const cache = new WeakMap<object, Replay>();

function makeDispatcher(fiber: Fiber, componentName: string, out: Map<number, string[]>, marker: string): { dispatcher: Dispatcher; nodesConsumed: () => number } {
  let node: HookNode | null = fiber.memoizedState as HookNode | null;
  let index = 0;
  const take = (count: number): HookNode | null => {
    const first = node;
    for (let i = 0; i < count && node; i++) node = node.next;
    index += count;
    return first;
  };
  const record = (primitive: string, count: number): HookNode | null => {
    const stack = new Error().stack || '';
    const chain = customHooksFromStack(stack, componentName, marker);
    const start = index;
    const first = take(count);
    if (chain.length) for (let i = 0; i < count; i++) out.set(start + i, chain);
    return first;
  };
  const memoized = (n: HookNode | null): unknown => (n ? n.memoizedState : undefined);
  const dispatcher: Dispatcher = {};
  const define = (name: string, impl: (...a: unknown[]) => unknown): void => {
    // The function name carries the marker so the stack parser knows where the component's frames start.
    const fn = { [marker + name]: (...a: unknown[]) => impl(...a) }[marker + name]!;
    dispatcher[name] = fn;
  };
  define('useState', () => {
    const n = record('useState', 1);
    return [memoized(n), noop];
  });
  define('useReducer', () => {
    const n = record('useReducer', 1);
    return [memoized(n), noop];
  });
  define('useRef', (init) => {
    const n = record('useRef', 1);
    return n ? n.memoizedState : { current: init };
  });
  define('useMemo', (fn) => {
    const n = record('useMemo', 1);
    const s = memoized(n);
    return Array.isArray(s) ? s[0] : typeof fn === 'function' ? (fn as () => unknown)() : undefined;
  });
  define('useCallback', (fn) => {
    const n = record('useCallback', 1);
    const s = memoized(n);
    return Array.isArray(s) ? s[0] : fn;
  });
  for (const effect of ['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useImperativeHandle']) define(effect, () => void record(effect, 1));
  define('useContext', (ctx) => {
    record('useContext', 0);
    const c = ctx as { _currentValue?: unknown; _currentValue2?: unknown } | null;
    return c ? c._currentValue : undefined;
  });
  define('useDebugValue', () => void record('useDebugValue', 0));
  define('useSyncExternalStore', (_subscribe, getSnapshot) => {
    const n = record('useSyncExternalStore', 2);
    return n ? n.memoizedState : typeof getSnapshot === 'function' ? (getSnapshot as () => unknown)() : undefined;
  });
  define('useTransition', () => {
    record('useTransition', 2);
    return [false, noop];
  });
  define('useDeferredValue', (v) => {
    const n = record('useDeferredValue', 1);
    return n ? n.memoizedState : v;
  });
  define('useId', () => {
    const n = record('useId', 1);
    return n ? n.memoizedState : 'id';
  });
  define('useOptimistic', (v) => {
    const n = record('useOptimistic', 1);
    return [n ? n.memoizedState : v, noop];
  });
  for (const action of ['useActionState', 'useFormState']) {
    define(action, (_fn, init) => {
      const n = record(action, 3);
      return [n ? n.memoizedState : init, noop, false];
    });
  }
  define('useEffectEvent', (fn) => {
    record('useEffectEvent', 1);
    return fn;
  });
  define('useCacheRefresh', () => {
    record('useCacheRefresh', 1);
    return noop;
  });
  define('useHostTransitionStatus', () => ({ pending: false, data: null, method: null, action: null }));
  define('useMemoCache', (size) => new Array(Number(size) || 0).fill(Symbol.for('react.memo_cache_sentinel')));
  define('use', (usable) => {
    record('use', 0);
    const u = usable as { then?: unknown; status?: string; value?: unknown; _currentValue?: unknown } | null;
    if (u && typeof u.then === 'function') {
      if (u.status === 'fulfilled') return u.value;
      throw new Error('rerender-lens: cannot replay use() on a pending promise');
    }
    return u ? u._currentValue : undefined;
  });
  define('readContext', (ctx) => (ctx as { _currentValue?: unknown } | null)?._currentValue);
  return { dispatcher, nodesConsumed: () => index };
}

/** Unwrap memo/forwardRef to the function that actually calls hooks. */
function renderFunctionOf(type: unknown): { fn: ((...a: unknown[]) => unknown) | null; name: string } {
  let t = type as { $$typeof?: symbol; type?: unknown; render?: unknown; displayName?: string; name?: string } | null;
  while (t && typeof t === 'object' && t.type) t = t.type as typeof t;
  if (t && typeof t === 'object' && typeof t.render === 'function') return { fn: t.render as (...a: unknown[]) => unknown, name: (t.render as { name?: string }).name || t.displayName || 'Component' };
  if (typeof t === 'function') return { fn: t as (...a: unknown[]) => unknown, name: (t as { name?: string }).name || 'Component' };
  return { fn: null, name: 'Component' };
}

/**
 * Custom hook chain per hook node index for a rendered function-component fiber. Empty map when the
 * replay fails, when the dispatcher ref is missing, or when the node count does not match.
 */
export function resolveHookNames(fiber: Fiber, ref: DispatcherRef | null | undefined): Map<number, string[]> {
  const type = fiber.type as object | null;
  if (!type || !ref) return new Map();
  const cached = cache.get(type);
  if (cached) return cached.byNode;
  const result: Replay = { byNode: new Map(), ok: false };
  cache.set(type, result);
  const { fn, name } = renderFunctionOf(type);
  if (!fn) return result.byNode;
  const useH = 'H' in ref;
  const marker = '__rl_';
  const previous = useH ? ref.H : ref.current;
  const { dispatcher, nodesConsumed } = makeDispatcher(fiber, name, result.byNode, marker);
  // The real dispatcher may be a dev proxy that throws on unknown members; ours only needs the hook methods.
  const proxy = new Proxy(dispatcher, {
    get(target, key) {
      if (key in target) return target[key as string];
      return () => undefined;
    },
  });
  let total = 0;
  for (let n = fiber.memoizedState as HookNode | null; n && typeof n === 'object' && 'next' in n; n = n.next) total++;
  try {
    if (useH) (ref as { H: unknown }).H = proxy;
    else (ref as { current: unknown }).current = proxy;
    const secondArg = fiber.tag === 11 ? ((fiber.stateNode as { ref?: unknown } | null)?.ref ?? null) : undefined;
    fn(fiber.memoizedProps ?? {}, secondArg);
    result.ok = nodesConsumed() === total;
    if (!result.ok) result.byNode.clear();
  } catch {
    result.byNode.clear();
  } finally {
    if (useH) (ref as { H: unknown }).H = previous;
    else (ref as { current: unknown }).current = previous;
  }
  return result.byNode;
}

/** Forget cached names (tests, Fast Refresh). */
export function clearHookNameCache(): void {
  // WeakMap has no clear(); types swapped by Fast Refresh are new keys anyway.
}

export { NODE_COUNT as HOOK_NODE_COUNT };
