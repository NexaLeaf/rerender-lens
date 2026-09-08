import type { Change, ChangeKind } from './types';

const REACT_ELEMENT = Symbol.for('react.element');
const REACT_TRANSITIONAL_ELEMENT = Symbol.for('react.transitional.element');

export function isReactElement(v: unknown): v is { type: unknown; props: Record<string, unknown>; key: unknown } {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { $$typeof?: unknown }).$$typeof;
  return t === REACT_ELEMENT || t === REACT_TRANSITIONAL_ELEMENT;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

type Seen = Map<object, Set<object>>;

function remember(seen: Seen, a: object, b: object): boolean {
  let set = seen.get(a);
  if (!set) {
    set = new Set();
    seen.set(a, set);
  }
  if (set.has(b)) return true;
  set.add(b);
  return false;
}

/**
 * Bounds the work of one comparison scope (a commit, or one public `deepEqual` call): pairs already
 * compared are memoized, so a large value shared by many components is walked once per commit, and
 * a visit budget turns a huge structure into "different" instead of freezing the page.
 */
interface DiffScope {
  cache: WeakMap<object, WeakMap<object, boolean>>;
  remaining: number;
  exhausted: boolean;
}
let scope: DiffScope | null = null;
/** Object visits allowed for one public `deepEqual` call. */
export const DEFAULT_DIFF_BUDGET = 50_000;

/** Start a scope (`onCommit` does this per commit); call the returned function to end it. */
export function beginDiffScope(budget = 200_000): () => void {
  const previous = scope;
  scope = { cache: new WeakMap(), remaining: budget, exhausted: false };
  return () => {
    scope = previous;
  };
}

/** True when the current scope gave up on a value because it was too large to walk. */
export function diffBudgetExhausted(): boolean {
  return scope?.exhausted === true;
}

/**
 * Structural equality that understands Map, Set, Date, RegExp, typed arrays,
 * React elements and cyclic references. Functions are equal only by reference.
 */
export function deepEqual(a: unknown, b: unknown, seen: Seen = new Map()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (!scope) {
    const end = beginDiffScope(DEFAULT_DIFF_BUDGET);
    try {
      return deepEqual(a, b, seen);
    } finally {
      end();
    }
  }
  const sc = scope;
  const objA = a as object;
  const objB = b as object;
  const hit = sc.cache.get(objA)?.get(objB);
  if (hit !== undefined) return hit;
  if (--sc.remaining < 0) {
    sc.exhausted = true;
    return false;
  }
  const result = deepEqualObjects(objA, objB, seen);
  let m = sc.cache.get(objA);
  if (!m) {
    m = new WeakMap();
    sc.cache.set(objA, m);
  }
  m.set(objB, result);
  return result;
}

function deepEqualObjects(a: object, b: object, seen: Seen): boolean {
  const objA = a;
  const objB = b;
  if (remember(seen, objA, objB)) return true; // cycle: assume equal on this branch

  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof RegExp) return b instanceof RegExp && a.source === b.source && a.flags === b.flags;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], seen)) return false;
    return true;
  }
  if (Array.isArray(b)) return false;

  if (ArrayBuffer.isView(a)) {
    if (!ArrayBuffer.isView(b) || a.constructor !== b.constructor) return false;
    const ta = a as unknown as ArrayLike<number>;
    const tb = b as unknown as ArrayLike<number>;
    if (ta.length !== tb.length) return false;
    for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return false;
    return true;
  }

  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !deepEqual(v, b.get(k), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    if (a.size > 50) {
      // Members that are equal-but-not-identical would need O(n²) work; large sets compare by identity.
      for (const v of a) if (!b.has(v)) return false;
      return true;
    }
    outer: for (const v of a) {
      if (b.has(v)) continue;
      for (const w of b) if (deepEqual(v, w, seen)) continue outer;
      return false;
    }
    return true;
  }

  if (isReactElement(a)) {
    if (!isReactElement(b)) return false;
    return a.type === b.type && a.key === b.key && deepEqual(a.props, b.props, seen);
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    const rb = b as Record<string, unknown>;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], rb[k], seen)) return false;
    }
    return true;
  }

  // Class instances, DOM nodes, promises, etc.: reference equality only.
  return false;
}

/** Classify why two values differ. Assumes `!Object.is(prev, next)`. */
export function classify(prev: unknown, next: unknown): ChangeKind {
  if (typeof prev === 'function' && typeof next === 'function') {
    return prev.name === next.name && prev.toString() === next.toString() ? 'function' : 'different';
  }
  if (isReactElement(prev) && isReactElement(next)) {
    return deepEqual(prev, next) ? 'element' : 'different';
  }
  return deepEqual(prev, next) ? 'deep-equal' : 'different';
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (base === '') return key;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

/**
 * Shallow-diff two records. Every changed key produces exactly one Change;
 * for `different` values that are plain objects/arrays, the nested path that
 * actually differs is reported in `path` to make the console output actionable.
 */
export function diffRecords(
  prev: Record<string, unknown> | undefined | null,
  next: Record<string, unknown> | undefined | null,
  basePath = '',
): Change[] {
  const p = prev ?? {};
  const n = next ?? {};
  const changes: Change[] = [];
  const keys = new Set([...Object.keys(p), ...Object.keys(n)]);
  for (const key of keys) {
    const inPrev = Object.prototype.hasOwnProperty.call(p, key);
    const inNext = Object.prototype.hasOwnProperty.call(n, key);
    const path = joinPath(basePath, key);
    if (inPrev && !inNext) {
      changes.push({ path, kind: 'removed', prev: p[key], next: undefined });
      continue;
    }
    if (!inPrev && inNext) {
      changes.push({ path, kind: 'added', prev: undefined, next: n[key] });
      continue;
    }
    const a = p[key];
    const b = n[key];
    if (Object.is(a, b)) continue;
    const kind = classify(a, b);
    if (kind === 'different') {
      // Once the budget is gone the nested walk would only burn more time; report the top-level key.
      changes.push({ path: diffBudgetExhausted() ? path : (firstDifferentPath(a, b, path) ?? path), kind, prev: a, next: b });
    } else {
      changes.push({ path, kind, prev: a, next: b });
    }
  }
  return changes;
}

/**
 * Walk plain objects/arrays to find the deepest path where the values first differ, e.g. `style.color`
 * or `items[2].id`; null when they are deep-equal. Two different values with no path to descend into
 * (primitives at the root) give `(value)`. Works on live values and on the panel's serialized ones.
 */
export function firstDifferentPath(a: unknown, b: unknown, path = '', depth = 0): string | null {
  if (depth > 8) return path || '(value)';
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return path ? `${path}.length` : 'length';
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return firstDifferentPath(a[i], b[i], joinPath(path, i), depth + 1);
    }
    return null;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return firstDifferentPath(a[k], b[k], joinPath(path, k), depth + 1);
    }
    return null;
  }
  return deepEqual(a, b) ? null : path || '(value)';
}

export interface Leaf {
  path: string;
  prev: unknown;
  next: unknown;
}

/** Every leaf at which two values differ, at most `limit` of them (the panel's diff view of `different` changes). */
export function diffLeaves(a: unknown, b: unknown, limit = 20, path = '', out: Leaf[] = []): Leaf[] {
  if (out.length >= limit || Object.is(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && out.length < limit; i++) diffLeaves(a[i], b[i], limit, joinPath(path, i), out);
    return out;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (out.length >= limit) break;
      diffLeaves(a[k], b[k], limit, joinPath(path, k), out);
    }
    return out;
  }
  if (!deepEqual(a, b)) out.push({ path: path || '(value)', prev: a, next: b });
  return out;
}
