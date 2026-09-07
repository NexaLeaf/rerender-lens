import type { Notifier, RenderReport } from './types';
import { isReactElement } from './diff';
import { getDisplayName } from './tracker';

export const DEVTOOLS_MARKER = '__rerenderLens' as const;
export const PROTOCOL_VERSION = 1;

export interface DevtoolsMessage {
  [DEVTOOLS_MARKER]: true;
  version: number;
  type: 'report' | 'clear' | 'hello';
  payload?: unknown;
}

export interface DevtoolsNotifierOptions {
  /** How many reports to keep for `replay()`. Default 300. */
  bufferSize?: number;
  /** Where to post. Default `window`. */
  target?: Pick<Window, 'postMessage'>;
  /** Max serialization depth. Default 6. */
  maxDepth?: number;
}

export interface DevtoolsBridge {
  /** Re-post every buffered report (a panel that opened late calls this). */
  replay(): void;
  clear(): void;
  readonly size: number;
  readonly version: number;
}

declare global {
  interface Window {
    __RERENDER_LENS_DEVTOOLS__?: DevtoolsBridge;
  }
}

/** Convert a report into a structured-clone-safe value (functions, elements, cycles removed). */
export function serialize(value: unknown, maxDepth = 6, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (t === 'bigint') return `${String(value)}n`;
  if (t === 'symbol') return String(value);
  if (t === 'function') return `ƒ ${(value as { name?: string }).name || 'anonymous'}`;
  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (depth >= maxDepth) return '[…]';
  seen.add(obj);
  try {
    if (isReactElement(obj)) return `<${getDisplayName(obj.type)}>`;
    if (obj instanceof Date) return { $type: 'Date', value: obj.toISOString() };
    if (obj instanceof RegExp) return { $type: 'RegExp', value: String(obj) };
    if (obj instanceof Map) {
      return { $type: 'Map', entries: [...obj].map(([k, v]) => [serialize(k, maxDepth, seen, depth + 1), serialize(v, maxDepth, seen, depth + 1)]) };
    }
    if (obj instanceof Set) return { $type: 'Set', values: [...obj].map((v) => serialize(v, maxDepth, seen, depth + 1)) };
    if (Array.isArray(obj)) return obj.map((v) => serialize(v, maxDepth, seen, depth + 1));
    if (typeof Element !== 'undefined' && obj instanceof Element) return `<${obj.tagName.toLowerCase()}>`;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) out[k] = serialize((obj as Record<string, unknown>)[k], maxDepth, seen, depth + 1);
    const proto = Object.getPrototypeOf(obj) as { constructor?: { name?: string } } | null;
    if (proto && proto !== Object.prototype && proto.constructor?.name) out.$type = proto.constructor.name;
    return out;
  } finally {
    seen.delete(obj);
  }
}

/**
 * A notifier that posts every report on `window` for a DevTools extension to pick up.
 * Also installs `window.__RERENDER_LENS_DEVTOOLS__` with `replay()` / `clear()`.
 */
export function createDevtoolsNotifier(options: DevtoolsNotifierOptions = {}): Notifier {
  const bufferSize = options.bufferSize ?? 300;
  const maxDepth = options.maxDepth ?? 6;
  const target = options.target ?? (typeof window !== 'undefined' ? window : undefined);
  const buffer: unknown[] = [];

  const post = (type: DevtoolsMessage['type'], payload?: unknown): void => {
    if (!target) return;
    const msg: DevtoolsMessage = { [DEVTOOLS_MARKER]: true, version: PROTOCOL_VERSION, type, payload };
    target.postMessage(msg, '*');
  };

  const bridge: DevtoolsBridge = {
    replay: () => {
      post('hello', { count: buffer.length });
      for (const p of buffer) post('report', p);
    },
    clear: () => {
      buffer.length = 0;
      post('clear');
    },
    get size() {
      return buffer.length;
    },
    version: PROTOCOL_VERSION,
  };
  if (typeof window !== 'undefined') window.__RERENDER_LENS_DEVTOOLS__ = bridge;
  post('hello', { count: 0 });

  return (report: RenderReport) => {
    const payload = serialize(report, maxDepth);
    buffer.push(payload);
    if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
    post('report', payload);
  };
}
