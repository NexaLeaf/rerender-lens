import type { ComponentMatcher, Notifier, Options, RenderReport } from './types';
import { isReactElement } from './diff';
import { configure, getDisplayName, isEnabled, shouldTrack } from './tracker';
import { getState } from './state';
import { fiberById, fiberForNode, fiberName, fiberType, getRenderers, hostNodesOf, instanceIdOf, isProductionReact, nearestComponent } from './fiber';
import type { Fiber, RendererInfo } from './fiber';
import { clearHighlight, flash, highlight } from './overlay';
import { VERSION } from './version';

export const DEVTOOLS_MARKER = '__rerenderLens' as const;
/** Bumped when the message shape or bridge API changes in a way the panel must know about. */
export const PROTOCOL_VERSION = 2;

export interface DevtoolsMessage {
  [DEVTOOLS_MARKER]: true;
  version: number;
  type: 'report' | 'clear' | 'hello';
  payload?: unknown;
}

/** Payload of a `hello` message. */
export interface HelloPayload {
  /** Buffered reports available for `replay()` / `pull()`. */
  count: number;
  /** Library version. */
  library: string;
  protocol: number;
  react: RendererInfo[];
  /** True when every React renderer on the page is a production build. */
  production: boolean;
  enabled: boolean;
  options: SerializableOptions;
  /** Who created this bridge: the page's own `init` call, or the extension's injected copy. */
  source: 'page' | 'extension';
  /** True when the extension injected a copy of the library into this page (whether or not it is the active one). */
  injected: boolean;
  /** Roots React scheduled (dev builds) and commits observed since `init`; the gap is work that never committed. */
  scheduled: number;
  commits: number;
}

declare global {
  interface Window {
    /** Set by the extension's inject script: version of the injected library. */
    __RERENDER_LENS_INJECTED__?: string;
  }
}

/** `Options` with matchers as strings (`"Name"` or `"/regex/flags"`) and no functions. */
export interface SerializableOptions {
  trackAllMemoized?: boolean;
  trackAllComponents?: boolean;
  include?: string[];
  exclude?: string[];
  trackHooks?: boolean;
  includeState?: boolean;
  resolveHookNames?: boolean;
  logAll?: boolean;
  silent?: boolean;
  collapse?: boolean;
  ignoreHotReload?: boolean;
  maxReportsPerComponent?: number;
}

export interface DevtoolsNotifierOptions {
  /** How many reports to keep for `replay()`. Default 300. */
  bufferSize?: number;
  /** Where to post. Default `window`. */
  target?: Pick<Window, 'postMessage'>;
  /** Max serialization depth. Default 6. */
  maxDepth?: number;
  /** Flash the DOM of components that re-rendered avoidably. Default false; toggle later with `flashAvoidable`. */
  flashAvoidable?: boolean;
  /** Reported in `info()`. The extension's inject script passes `'extension'`. Default `'page'`. */
  source?: 'page' | 'extension';
}

export interface InspectResult {
  component: string;
  instanceId: number | null;
  tracked: boolean;
  path: string[];
  /** Serialized reports for this instance, oldest first. */
  reports: unknown[];
}

export interface PullResult {
  /** Sequence number of the newest report included; pass it back as `since`. */
  seq: number;
  reports: unknown[];
  /** True when the caller missed reports that fell out of the buffer. */
  dropped: boolean;
}

export interface DevtoolsBridge {
  /** Re-post every buffered report (a panel that opened late calls this). */
  replay(): void;
  clear(): void;
  readonly size: number;
  readonly version: number;
  /** Library version. */
  readonly library: string;
  /** Everything the panel shows in its status line. */
  info(): HelloPayload;
  /** Reports newer than `since`. Lets a panel poll without any content script. */
  pull(since?: number): PullResult;
  /** Merge options at runtime; matchers are strings (`"/^Grid/"` becomes a RegExp). */
  configure(options: SerializableOptions): SerializableOptions;
  getOptions(): SerializableOptions;
  /** Outline the DOM of an instance in the page; `null` clears. */
  highlight(instanceId: number | null): boolean;
  /** Turn the avoidable-render flash on or off. */
  flashAvoidable(on: boolean): void;
  /** Re-render details for a DOM node (DevTools' `$0`). */
  inspect(node: unknown): InspectResult | null;
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
    if (isReactElement(obj)) {
      // Keep the props so the panel can diff element trees (children) leaf by leaf.
      const out: Record<string, unknown> = { $type: 'element', name: getDisplayName(obj.type) };
      if (obj.key !== null && obj.key !== undefined) out.key = String(obj.key);
      out.props = serialize(obj.props, maxDepth, seen, depth + 1);
      return out;
    }
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

const matcherToString = (m: ComponentMatcher): string | null =>
  typeof m === 'string' ? m : m instanceof RegExp ? String(m) : null;

const stringToMatcher = (s: string): ComponentMatcher => {
  const m = /^\/(.+)\/([a-z]*)$/.exec(s);
  if (m && m[1] !== undefined) {
    try {
      return new RegExp(m[1], m[2]);
    } catch {
      return s;
    }
  }
  return s;
};

/** The current options in a JSON-safe form (function matchers and custom consoles are dropped). */
export function serializeOptions(o: Options): SerializableOptions {
  const out: SerializableOptions = {};
  const bools = ['trackAllMemoized', 'trackAllComponents', 'trackHooks', 'includeState', 'resolveHookNames', 'logAll', 'silent', 'collapse', 'ignoreHotReload'] as const;
  for (const k of bools) if (typeof o[k] === 'boolean') out[k] = o[k];
  if (typeof o.maxReportsPerComponent === 'number') out.maxReportsPerComponent = o.maxReportsPerComponent;
  if (o.include) out.include = o.include.map(matcherToString).filter((x): x is string => x !== null);
  if (o.exclude) out.exclude = o.exclude.map(matcherToString).filter((x): x is string => x !== null);
  return out;
}

export function deserializeOptions(o: SerializableOptions): Options {
  const out: Options = {};
  const bools = ['trackAllMemoized', 'trackAllComponents', 'trackHooks', 'includeState', 'resolveHookNames', 'logAll', 'silent', 'collapse', 'ignoreHotReload'] as const;
  for (const k of bools) if (typeof o[k] === 'boolean') out[k] = o[k];
  if (typeof o.maxReportsPerComponent === 'number') out.maxReportsPerComponent = o.maxReportsPerComponent;
  if (Array.isArray(o.include)) out.include = o.include.filter((s) => typeof s === 'string' && s).map(stringToMatcher);
  if (Array.isArray(o.exclude)) out.exclude = o.exclude.filter((s) => typeof s === 'string' && s).map(stringToMatcher);
  return out;
}

interface Entry {
  seq: number;
  instanceId: number;
  payload: unknown;
}

/**
 * A notifier that posts every report on `window` for a DevTools extension to pick up.
 * Also installs `window.__RERENDER_LENS_DEVTOOLS__` with `replay()` / `clear()` / `pull()` and friends.
 */
export function createDevtoolsNotifier(options: DevtoolsNotifierOptions = {}): Notifier {
  const bufferSize = options.bufferSize ?? 300;
  const maxDepth = options.maxDepth ?? 6;
  const target = options.target ?? (typeof window !== 'undefined' ? window : undefined);
  const buffer: Entry[] = [];
  let seq = 0;
  let flashOn = options.flashAvoidable ?? false;

  const post = (type: DevtoolsMessage['type'], payload?: unknown): void => {
    if (!target) return;
    const msg: DevtoolsMessage = { [DEVTOOLS_MARKER]: true, version: PROTOCOL_VERSION, type, payload };
    target.postMessage(msg, '*');
  };

  const source = options.source ?? 'page';
  const info = (): HelloPayload => ({
    count: buffer.length,
    library: VERSION,
    protocol: PROTOCOL_VERSION,
    react: getRenderers(),
    production: isProductionReact(),
    enabled: isEnabled(),
    options: serializeOptions(getState().options),
    source,
    injected: typeof window !== 'undefined' && typeof window.__RERENDER_LENS_INJECTED__ === 'string',
    scheduled: getState().scheduled,
    commits: getState().commits,
  });

  const bridge: DevtoolsBridge = {
    replay: () => {
      post('hello', info());
      for (const e of buffer) post('report', e.payload);
    },
    clear: () => {
      buffer.length = 0;
      post('clear');
    },
    get size() {
      return buffer.length;
    },
    version: PROTOCOL_VERSION,
    library: VERSION,
    info,
    pull: (since = 0) => {
      const first = buffer[0];
      const dropped = since > 0 && !!first && first.seq > since + 1;
      const reports = buffer.filter((e) => e.seq > since).map((e) => e.payload);
      return { seq, reports, dropped };
    },
    configure: (next) => {
      configure(deserializeOptions(next ?? {}));
      return serializeOptions(getState().options);
    },
    getOptions: () => serializeOptions(getState().options),
    highlight: (id) => {
      if (id === null || id === undefined) {
        clearHighlight();
        return true;
      }
      const fiber = fiberById(id);
      if (!fiber) {
        clearHighlight();
        return false;
      }
      const nodes = hostNodesOf(fiber);
      highlight({ nodes, label: fiberName(fiber) });
      return nodes.length > 0;
    },
    flashAvoidable: (on) => {
      flashOn = !!on;
    },
    inspect: (node) => {
      const comp = nearestComponent(fiberForNode(node));
      if (!comp) return null;
      const id = instanceIdOf(comp) ?? null;
      const path: string[] = [];
      let f: Fiber | null = comp.return;
      while (f) {
        if (f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 14 || f.tag === 15) path.unshift(fiberName(f));
        f = f.return;
      }
      return {
        component: fiberName(comp),
        instanceId: id,
        tracked: shouldTrack(fiberType(comp), getState().options),
        path,
        reports: id === null ? [] : buffer.filter((e) => e.instanceId === id).slice(-20).map((e) => e.payload),
      };
    },
  };
  if (typeof window !== 'undefined') window.__RERENDER_LENS_DEVTOOLS__ = bridge;
  post('hello', info());

  return (report: RenderReport) => {
    const payload = serialize(report, maxDepth);
    buffer.push({ seq: ++seq, instanceId: report.instanceId, payload });
    if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
    post('report', payload);
    if (flashOn && report.avoidable && report.instanceId) {
      const fiber = fiberById(report.instanceId);
      if (fiber) flash({ nodes: hostNodesOf(fiber), label: report.component });
    }
  };
}
