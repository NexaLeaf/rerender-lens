import type * as React from 'react';
import type { Change, ComponentMatcher, HookChange, Options, ReactLike, TrackableStatics } from './types';
import { MARKER } from './types';
import { classify, diffRecords } from './diff';
import { buildReport } from './report';
import { dispatch, getState, type HookSample } from './state';

const MEMO = Symbol.for('react.memo');
const FORWARD_REF = Symbol.for('react.forward_ref');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyType = any;

interface MemoType {
  $$typeof: symbol;
  type: AnyType;
  compare: ((a: AnyType, b: AnyType) => boolean) | null;
  displayName?: string;
}
interface ForwardRefType {
  $$typeof: symbol;
  render: (props: AnyType, ref: AnyType) => AnyType;
  displayName?: string;
}

const isMemo = (t: unknown): t is MemoType =>
  typeof t === 'object' && t !== null && (t as MemoType).$$typeof === MEMO;
const isForwardRef = (t: unknown): t is ForwardRefType =>
  typeof t === 'object' && t !== null && (t as ForwardRefType).$$typeof === FORWARD_REF;
const isClass = (t: unknown): t is new (...args: AnyType[]) => React.Component =>
  typeof t === 'function' && !!(t.prototype as { isReactComponent?: unknown } | undefined)?.isReactComponent;
const isPureClass = (t: unknown): boolean =>
  isClass(t) && !!(t.prototype as { isPureReactComponent?: unknown }).isPureReactComponent;
const isComponentLike = (t: unknown): boolean => typeof t === 'function' || isMemo(t) || isForwardRef(t);

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

const SKIP_STATICS = new Set(['length', 'name', 'prototype', 'arguments', 'caller', '$$typeof', 'render', 'type', 'compare']);

function hoistStatics(from: object, to: object): void {
  for (const key of Object.getOwnPropertyNames(from)) {
    if (SKIP_STATICS.has(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(from, key);
    if (desc) {
      try {
        Object.defineProperty(to, key, desc);
      } catch {
        /* non-configurable target key; ignore */
      }
    }
  }
}

function sameHookRefs(prev: HookSample[] | null, next: HookSample[] | null): boolean {
  if (!prev || !next) return true; // no information: treat as unchanged
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) if (!Object.is(prev[i]!.value, next[i]!.value)) return false;
  return true;
}

function diffHooks(prev: HookSample[] | null, next: HookSample[] | null): HookChange[] {
  if (!prev || !next) return [];
  const out: HookChange[] = [];
  const len = Math.max(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b) continue;
    if (Object.is(a.value, b.value)) continue;
    out.push({ path: `${b.hook}#${i}`, hook: b.hook, index: i, kind: classify(a.value, b.value), prev: a.value, next: b.value });
  }
  return out;
}

interface Store {
  props: Record<string, unknown>;
  hooks: HookSample[] | null;
  count: number;
}

function wrapRender(
  R: ReactLike,
  render: (props: AnyType, second?: AnyType) => AnyType,
  name: string,
): (props: AnyType, second?: AnyType) => AnyType {
  const Wrapped = function (props: Record<string, unknown>, second?: unknown) {
    const s = getState();
    const store = R.useRef<Store | null>(null);
    const capture: HookSample[] | null = s.options.trackHooks === false ? null : [];
    const outer = s.capture;
    s.capture = capture;
    let result: unknown;
    try {
      result = render(props, second);
    } finally {
      s.capture = outer;
    }
    const prev = store.current;
    if (!prev || !s.patched) {
      store.current = { props, hooks: capture, count: prev?.count ?? 0 };
      return result;
    }
    // Same props object and same hook values means React re-invoked the render
    // function without a real update (StrictMode double render). Skip silently.
    const sameProps = prev.props === props;
    if (sameProps && sameHookRefs(prev.hooks, capture)) {
      store.current = { props, hooks: capture, count: prev.count };
      return result;
    }
    const count = prev.count + 1;
    store.current = { props, hooks: capture, count };
    dispatch(
      buildReport({
        component: name,
        renderCount: count,
        prevProps: prev.props,
        nextProps: props,
        propChanges: sameProps ? [] : diffRecords(prev.props, props),
        hookChanges: diffHooks(prev.hooks, capture),
      }),
    );
    return result;
  };
  hoistStatics(render, Wrapped);
  Object.defineProperty(Wrapped, 'name', { value: name, configurable: true });
  (Wrapped as TrackableStatics).displayName = name;
  return Wrapped;
}

const COUNT = Symbol.for('rerender-lens.count');

function wrapClass(Original: new (...args: AnyType[]) => React.Component, name: string): typeof Original {
  class Tracked extends Original {
    static displayName = name;
    override componentDidUpdate(prevProps: AnyType, prevState: AnyType, snapshot?: AnyType): void {
      const s = getState();
      if (s.patched) {
        const self = this as unknown as Record<symbol, number | undefined>;
        const count = (self[COUNT] = (self[COUNT] ?? 0) + 1);
        const propChanges: Change[] = prevProps === this.props ? [] : diffRecords(prevProps, this.props as Record<string, unknown>);
        const stateChanges: Change[] =
          prevState === this.state ? [] : diffRecords(prevState ?? {}, (this.state as Record<string, unknown>) ?? {});
        dispatch(
          buildReport({
            component: name,
            renderCount: count,
            prevProps,
            nextProps: this.props as Record<string, unknown>,
            propChanges,
            stateChanges,
          }),
        );
      }
      const superDidUpdate = Original.prototype.componentDidUpdate as
        | ((this: React.Component, p: AnyType, st: AnyType, sn?: AnyType) => void)
        | undefined;
      if (superDidUpdate) superDidUpdate.call(this, prevProps, prevState, snapshot);
    }
  }
  return Tracked;
}

function createWrapper(R: ReactLike, type: AnyType): AnyType | null {
  const name = getDisplayName(type);
  if (isMemo(type)) {
    const inner = createWrapper(R, type.type);
    if (!inner) return null;
    const wrapped = R.memo(inner, type.compare ?? undefined) as unknown as MemoType;
    hoistStatics(type, wrapped);
    wrapped.displayName = name;
    return wrapped;
  }
  if (isForwardRef(type)) {
    const wrapped = R.forwardRef(wrapRender(R, type.render, name) as React.ForwardRefRenderFunction<unknown, AnyType>) as unknown as ForwardRefType;
    hoistStatics(type, wrapped);
    wrapped.displayName = name;
    return wrapped;
  }
  if (isClass(type)) return wrapClass(type, name);
  if (typeof type === 'function') return wrapRender(R, type, name);
  return null;
}

/** Map an element type to its tracked wrapper (or return it unchanged). */
export function resolveType(type: AnyType): AnyType {
  const s = getState();
  if (!s.patched || !s.React) return type;
  if (type === null || (typeof type !== 'function' && typeof type !== 'object')) return type;
  if (s.wrapperSet.has(type)) return type;

  let tracked: boolean;
  const d = s.decisions.get(type);
  if (d && d.generation === s.generation) {
    tracked = d.tracked;
  } else {
    tracked = shouldTrack(type, s.options);
    s.decisions.set(type, { generation: s.generation, tracked });
  }
  if (!tracked) return type;

  let w = s.wrappers.get(type);
  if (!w) {
    const created = createWrapper(s.React, type);
    if (!created) return type;
    w = created as object;
    s.wrappers.set(type, w);
    s.wrapperSet.add(w);
  }
  return w;
}

const HOOK_KEYS = ['useState', 'useReducer', 'useContext', 'useSyncExternalStore'] as const;

function assign(target: object, key: string, value: unknown): void {
  try {
    (target as Record<string, unknown>)[key] = value;
  } catch {
    /* fallthrough */
  }
  if ((target as Record<string, unknown>)[key] !== value) {
    throw new Error(
      `[rerender-lens] Cannot patch React.${key}. Pass the default import (\`import React from 'react'\`), not a namespace import.`,
    );
  }
}

/**
 * Patch `React.createElement` (and the state hooks) so tracked components report
 * their re-renders. Returns a function that undoes the patch.
 */
export function init(R: ReactLike, options: Options = {}): () => void {
  const s = getState();
  if (s.patched) {
    configure(options);
    return disable;
  }
  s.React = R;
  s.options = { ...options };
  s.generation++;

  const origCreateElement = R.createElement as (...args: unknown[]) => unknown;
  s.originals.createElement = origCreateElement;
  assign(R, 'createElement', function createElement(this: unknown, ...args: unknown[]) {
    args[0] = resolveType(args[0]);
    return origCreateElement.apply(R, args);
  });

  for (const key of HOOK_KEYS) {
    const orig = (R as unknown as Record<string, unknown>)[key] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof orig !== 'function') continue;
    s.originals[key] = orig;
    const patched = function (this: unknown, ...args: unknown[]) {
      const r = orig.apply(this, args);
      const cap = getState().capture;
      if (cap) cap.push({ hook: key, value: key === 'useState' || key === 'useReducer' ? (r as unknown[])[0] : r });
      return r;
    };
    Object.defineProperty(patched, 'name', { value: key, configurable: true });
    assign(R, key, patched);
  }

  s.patched = true;
  return disable;
}

/** Update options at runtime. Include/exclude changes apply to elements created afterwards. */
export function configure(options: Options): void {
  const s = getState();
  s.options = { ...s.options, ...options };
  s.generation++;
}

/** Restore the original React functions. Already-created wrappers keep working but stop reporting. */
export function disable(): void {
  const s = getState();
  if (!s.patched || !s.React) return;
  const R = s.React as unknown as Record<string, unknown>;
  for (const [key, orig] of Object.entries(s.originals)) {
    if (orig) R[key] = orig;
  }
  s.originals = {};
  s.patched = false;
  s.React = null;
  s.capture = null;
}

export function isEnabled(): boolean {
  return getState().patched;
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
