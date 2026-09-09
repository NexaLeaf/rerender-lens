import type { ComponentMatcher, Options, TrackableStatics, TrackingVerdict } from './types';
import { MARKER } from './types';
import { attach } from './fiber';
import { getState } from './state';

const MEMO = Symbol.for('react.memo');
const FORWARD_REF = Symbol.for('react.forward_ref');

interface MemoType {
  $$typeof: symbol;
  type: unknown;
  displayName?: string;
}
interface ForwardRefType {
  $$typeof: symbol;
  render: unknown;
  displayName?: string;
}

const isMemo = (t: unknown): t is MemoType => typeof t === 'object' && t !== null && (t as MemoType).$$typeof === MEMO;
const isForwardRef = (t: unknown): t is ForwardRefType =>
  typeof t === 'object' && t !== null && (t as ForwardRefType).$$typeof === FORWARD_REF;
const isClass = (t: unknown): boolean =>
  typeof t === 'function' && !!(t.prototype as { isReactComponent?: unknown } | undefined)?.isReactComponent;
const isPureClass = (t: unknown): boolean =>
  isClass(t) && !!((t as { prototype: { isPureReactComponent?: unknown } }).prototype).isPureReactComponent;
const isComponentLike = (t: unknown): boolean => typeof t === 'function' || isMemo(t) || isForwardRef(t);

/**
 * The function the bundler actually compiled: `memo(X)` / `forwardRef(X)` (and nestings of the two)
 * unwrapped to `X`. Anything else is returned untouched.
 */
export function unwrapComponent(type: unknown): unknown {
  let t = type;
  for (let i = 0; i < 5; i++) {
    if (isMemo(t)) t = t.type;
    else if (isForwardRef(t)) t = t.render;
    else break;
  }
  return t;
}

export function getDisplayName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (isMemo(type)) return type.displayName ?? getDisplayName(type.type);
  if (isForwardRef(type)) return type.displayName ?? getDisplayName(type.render);
  if (typeof type === 'function') {
    const t = type as TrackableStatics;
    return t.displayName ?? (t.name || 'Anonymous');
  }
  return 'Anonymous';
}

function hasMarker(type: unknown): boolean {
  if (type === null || (typeof type !== 'function' && typeof type !== 'object')) return false;
  if ((type as TrackableStatics)[MARKER] === true) return true;
  if (isMemo(type)) return hasMarker(type.type);
  if (isForwardRef(type)) return hasMarker(type.render);
  return false;
}

function matches(m: ComponentMatcher, name: string): boolean {
  if (typeof m === 'string') return m === name;
  if (m instanceof RegExp) return m.test(name);
  return m(name);
}

/** Decide whether a component type is tracked under the given options. */
export function shouldTrack(type: unknown, o: Options): boolean {
  if (!isComponentLike(type)) return false;
  const name = getDisplayName(type);
  if (o.exclude?.some((m) => matches(m, name))) return false;
  if (hasMarker(type)) return true;
  if (o.include?.some((m) => matches(m, name))) return true;
  if (o.trackAllComponents) return true;
  if (o.trackAllMemoized) return isMemo(type) || isPureClass(type);
  return false;
}

const ANONYMOUS = 'Anonymous';

/**
 * The same decision as `shouldTrack`, with the rule that made it and what to change. Pure and
 * allocation-light, but one step slower than `shouldTrack` (it builds strings), so the commit path
 * keeps calling `shouldTrack`; `test/tracking.test.ts` proves the two never disagree.
 */
export function explainTracking(type: unknown, o: Options): TrackingVerdict {
  if (typeof type === 'string')
    return { tracked: false, name: type, memoized: false, reason: `<${type}> is a DOM element, not a React component; only components are tracked.` };
  if (!isComponentLike(type))
    return { tracked: false, name: ANONYMOUS, memoized: false, reason: 'This is not a React component type, so it is never tracked.' };
  const name = getDisplayName(type);
  const memo = isMemo(type);
  const memoized = memo || isPureClass(type);
  if (o.exclude?.some((m) => matches(m, name)))
    return { tracked: false, name, memoized, reason: `<${name}> matches "exclude", which wins over every other rule.`, fix: `Remove "${name}" from the exclude list.` };
  if (hasMarker(type)) return { tracked: true, name, memoized, reason: `<${name}> is marked with track() (the ${MARKER} static).` };
  if (o.include?.some((m) => matches(m, name))) return { tracked: true, name, memoized, reason: `<${name}> matches "include".` };
  if (o.trackAllComponents) return { tracked: true, name, memoized, reason: '"Track every component" is on, so every component is tracked.' };
  if (o.trackAllMemoized && memoized)
    return { tracked: true, name, memoized, reason: `<${name}> is ${memo ? 'a React.memo component' : 'a PureComponent'}, and "Track every React.memo and PureComponent" is on.` };
  if (name === ANONYMOUS)
    return {
      tracked: false,
      name,
      memoized,
      reason: 'This component has no display name, so "include" and "exclude" cannot address it.',
      fix: "Give the function a name, set displayName, or mark it with track(fn, 'Name').",
    };
  if (o.trackAllMemoized)
    return {
      tracked: false,
      name,
      memoized,
      reason: `"Track every React.memo and PureComponent" only covers React.memo components and PureComponent classes, and <${name}> is neither.`,
      fix: `Add "${name}" to include, wrap it in React.memo, or turn on "Track every component".`,
    };
  return {
    tracked: false,
    name,
    memoized,
    reason: `Nothing selects <${name}>: it is not marked with track(), no "include" pattern matches it, and neither "track every" option is on.`,
    fix: `Add "${name}" to include, or turn on "Track every React.memo and PureComponent" / "Track every component".`,
  };
}

/**
 * Start reporting re-renders of tracked components. Observes React commits
 * through the DevTools global hook; nothing in React is patched or wrapped.
 * Returns a function that stops reporting.
 */
export function init(options: Options = {}): () => void {
  const s = getState();
  s.options = { ...options };
  s.printed.clear();
  // "since init": the tracking summary describes this run's options, not a previous one's.
  s.seen.clear();
  s.seenTracked.clear();
  s.seenOverflow = false;
  if (!s.enabled) {
    s.detach = attach();
    s.enabled = true;
  }
  return disable;
}

/** Merge options at runtime. Takes effect on the next commit. */
export function configure(options: Options): void {
  const s = getState();
  s.options = { ...s.options, ...options };
}

/** Stop reporting and restore the DevTools hook callback. */
export function disable(): void {
  const s = getState();
  if (!s.enabled) return;
  s.detach?.();
  s.detach = null;
  s.enabled = false;
}

export function isEnabled(): boolean {
  return getState().enabled;
}

/**
 * Opt a component in, with types preserved: `export default track(MyComponent)`.
 * Pass `name` for anonymous arrow functions, which have no inferable name.
 */
export function track<T>(component: T, name?: string): T {
  const t = component as unknown as TrackableStatics;
  t[MARKER] = true;
  if (name) t.displayName = name;
  return component;
}
