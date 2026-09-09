import type { ComponentMatcher, Notifier, Options, RenderReport, TrackingSummary, TrackingVerdict } from './types';
import { isReactElement } from './diff';
import { configure, explainTracking, getDisplayName, isEnabled, shouldTrack, unwrapComponent } from './tracker';
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
  /** The library's own cost: total and worst-case time spent inspecting commits, in ms. */
  overhead: { totalMs: number; maxCommitMs: number };
  /** Reports skipped because a commit exceeded the per-commit cap or time budget. */
  truncated: number;
  /** What the current options select, and how much of the page they cover: the panel's answer to "why is it empty?". */
  tracking: TrackingSummary;
  /**
   * Same-origin scripts of the page (`<script src>` and `<link rel=modulepreload>`), so a panel can find
   * the bundle a component was compiled into and name it through its source map. Capped at `MAX_SCRIPTS`.
   */
  scripts: string[];
}

/** Command sent by a panel over the BroadcastChannel; answered with a `ChannelReply` of the same id. */
export interface ChannelCommand {
  __rerenderLensCmd: true;
  id: string;
  cmd: 'info' | 'pull' | 'replay' | 'clear' | 'configure' | 'highlight' | 'flash' | 'explain' | 'functionSource' | 'fetchText';
  arg?: unknown;
}

export interface ChannelReply {
  __rerenderLensReply: true;
  id: string;
  result?: unknown;
  error?: string;
}

/** Default channel name for `createDevtoolsNotifier({ channel: true })` and the panel served by the Vite plugin. */
export const DEFAULT_CHANNEL = 'rerender-lens';

declare global {
  interface Window {
    /** Set by the extension's inject script: version of the injected library. */
    __RERENDER_LENS_INJECTED__?: string;
    /** Relay URL (`npx rerender-lens panel`) picked up by `createDevtoolsNotifier` when no `relay` option is given. */
    __RERENDER_LENS_RELAY__?: string;
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
  /**
   * Also publish on a `BroadcastChannel`, so a panel in another same-origin tab (the one the Vite plugin
   * serves at `/__rerender-lens/`) receives reports and can send commands. `true` uses `DEFAULT_CHANNEL`.
   * Off by default.
   */
  channel?: boolean | string;
  /**
   * Forward everything to a relay started with `npx rerender-lens panel` (its URL), so the panel works for
   * any app on any origin. Also read from `window.__RERENDER_LENS_RELAY__` when set before the app loads.
   */
  relay?: string;
  /** `EventSource` implementation for the relay (tests, Node). Default: the global one. */
  eventSource?: EventSourceCtor;
}

/** The subset of `EventSource` the relay client needs. */
export interface EventSourceLike {
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

export interface InspectResult {
  component: string;
  instanceId: number | null;
  tracked: boolean;
  /** Why it is tracked or not, and what to change. Same decision as `tracked`, in words. */
  tracking: TrackingVerdict;
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
  /**
   * Why the component behind a DOM node (or an `instanceId`, which is all a panel on the
   * BroadcastChannel or the relay can send) is or is not tracked.
   */
  explain(target: unknown): TrackingVerdict | null;
  /**
   * The component function's own source text, exactly as it sits in the loaded script
   * (`Function.prototype.toString()` returns a slice of it), plus the name it currently has. A panel
   * looks the text up in the bundle to name a minified build through the bundle's source map.
   */
  functionSource(instanceId: number): FunctionSource | null;
  /**
   * Read a **same-origin** URL as text in the page (the page can always read its own bundle and `.map`;
   * a panel often cannot). Cross-origin URLs are refused, no credentials are sent, and anything over
   * `maxBytes` (default and hard cap `FETCH_TEXT_MAX_BYTES`) is dropped.
   *
   * The first call returns a promise and remembers the result; later calls for the same URL answer
   * synchronously (or throw the recorded failure), which is what lets a caller that cannot await —
   * `chrome.devtools.inspectedWindow.eval` — poll for it.
   */
  fetchText(url: string, maxBytes?: number): string | null | Promise<string | null>;
}

/** `functionSource()`: the text of the function the bundler compiled, and its current (minified) name. */
export interface FunctionSource {
  text: string;
  name: string;
  /** True when `text` is only the first `MAX_FUNCTION_SOURCE` characters. */
  truncated?: boolean;
}

declare global {
  interface Window {
    __RERENDER_LENS_DEVTOOLS__?: DevtoolsBridge;
  }
}

/** Characters of a component's source text `functionSource()` returns; a minified component is far smaller. */
export const MAX_FUNCTION_SOURCE = 20_000;
/** Hard cap for `fetchText()`; a bundle plus its map fits, a video does not. */
export const FETCH_TEXT_MAX_BYTES = 8_000_000;
/** Script URLs reported in `info().scripts`. */
export const MAX_SCRIPTS = 30;
/** Texts kept by `fetchText()`; they are megabytes, and a panel only needs the current bundle and its map. */
const TEXT_CACHE_MAX = 3;

/** Entries kept per array / object / Map / Set when serializing; the rest becomes one `…+N more` marker. */
export const SERIALIZE_MAX_ENTRIES = 100;
/** Objects visited per serialized report; beyond it values become `[…]`. */
export const SERIALIZE_MAX_NODES = 20_000;

/**
 * Convert a report into a structured-clone-safe value (functions, elements, cycles removed).
 * Depth, breadth and total size are bounded so a giant prop (a 100k-row list, an image buffer,
 * a scene graph) costs a bounded amount of time and memory per report.
 */
export function serialize(value: unknown, maxDepth = 4, seen: WeakSet<object> = new WeakSet(), depth = 0, budget: { nodes: number } = { nodes: SERIALIZE_MAX_NODES }): unknown {
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
  if (--budget.nodes < 0) return '[…]';
  const next = (v: unknown): unknown => serialize(v, maxDepth, seen, depth + 1, budget);
  seen.add(obj);
  try {
    if (isReactElement(obj)) {
      // Keep the props so the panel can diff element trees (children) leaf by leaf.
      const out: Record<string, unknown> = { $type: 'element', name: getDisplayName(obj.type) };
      if (obj.key !== null && obj.key !== undefined) out.key = String(obj.key);
      out.props = next(obj.props);
      return out;
    }
    if (obj instanceof Date) return { $type: 'Date', value: obj.toISOString() };
    if (obj instanceof RegExp) return { $type: 'RegExp', value: String(obj) };
    if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
      // Binary data: `Object.keys` of a typed array would enumerate every index.
      const bin = obj as { length?: number; byteLength: number; constructor?: { name?: string } };
      return { $type: bin.constructor?.name || 'ArrayBuffer', length: typeof bin.length === 'number' ? bin.length : bin.byteLength };
    }
    if (obj instanceof Promise) return '[Promise]';
    if (typeof Node !== 'undefined' && obj instanceof Node) return typeof Element !== 'undefined' && obj instanceof Element ? `<${obj.tagName.toLowerCase()}>` : `[${obj.nodeName}]`;
    if (obj === globalThis) return '[Window]';
    if (obj instanceof Map) {
      const entries: unknown[] = [];
      for (const [k, v] of obj) {
        if (entries.length >= SERIALIZE_MAX_ENTRIES) {
          entries.push(['…', `+${obj.size - SERIALIZE_MAX_ENTRIES} more`]);
          break;
        }
        entries.push([next(k), next(v)]);
      }
      return { $type: 'Map', entries };
    }
    if (obj instanceof Set) {
      const values: unknown[] = [];
      for (const v of obj) {
        if (values.length >= SERIALIZE_MAX_ENTRIES) {
          values.push(`…+${obj.size - SERIALIZE_MAX_ENTRIES} more`);
          break;
        }
        values.push(next(v));
      }
      return { $type: 'Set', values };
    }
    if (Array.isArray(obj)) {
      const out = obj.slice(0, SERIALIZE_MAX_ENTRIES).map(next);
      if (obj.length > SERIALIZE_MAX_ENTRIES) out.push(`…+${obj.length - SERIALIZE_MAX_ENTRIES} more`);
      return out;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const k of keys.slice(0, SERIALIZE_MAX_ENTRIES)) out[k] = next((obj as Record<string, unknown>)[k]);
    if (keys.length > SERIALIZE_MAX_ENTRIES) out['…'] = `+${keys.length - SERIALIZE_MAX_ENTRIES} more`;
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

/** Same-origin scripts the document loads: the candidates for "which bundle was this component compiled into?". */
function pageScripts(): string[] {
  if (typeof document === 'undefined' || typeof location === 'undefined') return [];
  const out: string[] = [];
  let nodes: ArrayLike<Element>;
  try {
    nodes = document.querySelectorAll('script[src], link[rel~="modulepreload"][href]');
  } catch {
    return out;
  }
  for (let i = 0; i < nodes.length && out.length < MAX_SCRIPTS; i++) {
    const raw = (nodes[i] as HTMLScriptElement).src || (nodes[i] as unknown as HTMLLinkElement).href;
    if (!raw) continue;
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) continue;
      if (!out.includes(url.href)) out.push(url.href);
    } catch {
      /* not a URL we can use */
    }
  }
  return out;
}

interface TextEntry {
  done: boolean;
  text?: string | null;
  error?: string;
  promise?: Promise<string | null>;
}
const textCache = new Map<string, TextEntry>();

/** See `DevtoolsBridge.fetchText`. Module-level so the cache survives a second `createDevtoolsNotifier`. */
function fetchTextImpl(rawUrl: string, maxBytes?: number): string | null | Promise<string | null> {
  const cap = typeof maxBytes === 'number' && maxBytes > 0 ? Math.min(maxBytes, FETCH_TEXT_MAX_BYTES) : FETCH_TEXT_MAX_BYTES;
  const here = typeof location !== 'undefined' ? location.href : undefined;
  let url: URL;
  try {
    url = new URL(String(rawUrl), here);
  } catch {
    throw new Error(`fetchText: not a URL: ${String(rawUrl)}`);
  }
  // Real same-origin check: the page reads its own files, nothing else.
  if (typeof location !== 'undefined' && url.origin !== location.origin) throw new Error(`fetchText: refused ${url.origin} (not same-origin as ${location.origin})`);
  const key = url.href;
  const hit = textCache.get(key);
  if (hit) {
    if (hit.error) throw new Error(hit.error);
    if (hit.done) return hit.text ?? null;
    return hit.promise ?? null;
  }
  if (typeof fetch !== 'function') throw new Error('fetchText: this page has no fetch()');
  const entry: TextEntry = { done: false };
  const settle = (text: string | null, error?: string): string | null => {
    entry.done = true;
    entry.text = text;
    if (error) entry.error = error;
    // Oldest first: Map keeps insertion order.
    for (const k of textCache.keys()) {
      if (textCache.size <= TEXT_CACHE_MAX) break;
      if (k !== key) textCache.delete(k);
    }
    return text;
  };
  // Failures resolve to null and are remembered: nobody may be awaiting this promise (the eval caller
  // only polls), so it must never reject. The next call for the same URL throws the reason instead.
  entry.promise = fetch(key, { credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > cap) throw new Error(`${len} bytes is over the ${cap} byte cap`);
      return res.text();
    })
    .then(
      (text) => settle(text.length > cap ? null : text, text.length > cap ? `fetchText ${key}: over the ${cap} byte cap` : undefined),
      (e: unknown) => settle(null, `fetchText ${key}: ${String((e as Error)?.message || e)}`),
    );
  textCache.set(key, entry);
  return entry.promise;
}

/** The Fetch standard's cap on a `keepalive` request body; beyond it the request fails outright. */
const KEEPALIVE_MAX_BYTES = 60_000;

const isThenable = <T,>(v: T | Promise<T>): v is Promise<T> => !!v && typeof (v as Promise<T>).then === 'function';

/**
 * A notifier that posts every report on `window` for a DevTools extension to pick up.
 * Also installs `window.__RERENDER_LENS_DEVTOOLS__` with `replay()` / `clear()` / `pull()` and friends.
 */
export function createDevtoolsNotifier(options: DevtoolsNotifierOptions = {}): Notifier {
  const bufferSize = options.bufferSize ?? 300;
  const maxDepth = options.maxDepth ?? 4;
  const target = options.target ?? (typeof window !== 'undefined' ? window : undefined);
  const buffer: Entry[] = [];
  let seq = 0;
  let flashOn = options.flashAvoidable ?? false;

  // Reports go on `window` only once the page side said it listens (the extension's content script posts
  // `__rerenderLensReady`, or something called `replay()`): a page without an open panel then pays no
  // structured clone per report and wakes none of the app's own `message` listeners. Targets without
  // `addEventListener` (tests, custom sinks) are treated as listening.
  let live = !target || typeof (target as Window).addEventListener !== 'function';
  if (!live) {
    (target as Window).addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { __rerenderLensReady?: boolean } | null;
      // jsdom leaves `source` null; the marker alone is specific enough for a flag that only opens the gate.
      if ((event.source === target || !event.source) && data && data.__rerenderLensReady === true) live = true;
    });
  }
  const post = (type: DevtoolsMessage['type'], payload?: unknown): void => {
    if (!target || (type === 'report' && !live)) return;
    const msg: DevtoolsMessage = { [DEVTOOLS_MARKER]: true, version: PROTOCOL_VERSION, type, payload };
    target.postMessage(msg, '*');
  };

  const source = options.source ?? 'page';
  const trackingSummary = (): TrackingSummary => {
    const s = getState();
    const o = s.options;
    return {
      mode: o.trackAllComponents ? 'all' : o.trackAllMemoized ? 'memoized' : 'marked',
      include: (o.include ?? []).map(matcherToString).filter((x): x is string => x !== null),
      exclude: (o.exclude ?? []).map(matcherToString).filter((x): x is string => x !== null),
      renderedCount: s.seen.size,
      trackedCount: s.seenTracked.size,
      overflow: s.seenOverflow,
    };
  };
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
    overhead: { totalMs: getState().overheadMs, maxCommitMs: getState().maxCommitMs },
    truncated: getState().truncated,
    tracking: trackingSummary(),
    scripts: pageScripts(),
  });

  const bridge: DevtoolsBridge = {
    replay: () => {
      live = true;
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
    explain: (target) => {
      const comp = typeof target === 'number' ? fiberById(target) : nearestComponent(fiberForNode(target));
      return comp ? explainTracking(fiberType(comp), getState().options) : null;
    },
    functionSource: (instanceId) => {
      const fiber = typeof instanceId === 'number' ? fiberById(instanceId) : null;
      if (!fiber) return null;
      // The bundler compiled the inner function; `memo(X)` / `forwardRef(X)` are objects created at runtime.
      const fn = unwrapComponent(fiberType(fiber));
      if (typeof fn !== 'function') return null;
      let text: string;
      try {
        text = Function.prototype.toString.call(fn);
      } catch {
        return null;
      }
      if (!text) return null;
      const truncated = text.length > MAX_FUNCTION_SOURCE;
      const out: FunctionSource = { text: truncated ? text.slice(0, MAX_FUNCTION_SOURCE) : text, name: (fn as { name?: string }).name || fiberName(fiber) };
      if (truncated) out.truncated = true;
      return out;
    },
    fetchText: (url, maxBytes) => fetchTextImpl(url, maxBytes),
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
        tracking: explainTracking(fiberType(comp), getState().options),
        path,
        reports: id === null ? [] : buffer.filter((e) => e.instanceId === id).slice(-20).map((e) => e.payload),
      };
    },
  };
  if (typeof window !== 'undefined') window.__RERENDER_LENS_DEVTOOLS__ = bridge;

  /**
   * Answer a panel command (BroadcastChannel or relay). Every command but `fetchText` answers
   * synchronously; that one may return a promise of the reply, so callers post whichever they get.
   */
  const runCommand = (data: ChannelCommand): ChannelReply | Promise<ChannelReply> => {
    const reply: ChannelReply = { __rerenderLensReply: true, id: data.id };
    try {
      switch (data.cmd) {
        case 'info':
          reply.result = info();
          break;
        case 'pull':
          reply.result = bridge.pull(typeof data.arg === 'number' ? data.arg : 0);
          break;
        case 'replay':
          bridge.replay();
          reply.result = true;
          break;
        case 'clear':
          bridge.clear();
          reply.result = true;
          break;
        case 'configure':
          reply.result = bridge.configure((data.arg ?? {}) as SerializableOptions);
          break;
        case 'highlight':
          reply.result = bridge.highlight(typeof data.arg === 'number' ? data.arg : null);
          break;
        case 'flash':
          bridge.flashAvoidable(!!data.arg);
          reply.result = true;
          break;
        case 'explain':
          // Over a channel there is no DOM node to pass, only an instance id from a report.
          reply.result = bridge.explain(data.arg);
          break;
        case 'functionSource':
          reply.result = bridge.functionSource(Number(data.arg));
          break;
        case 'fetchText': {
          const arg = data.arg;
          const url = typeof arg === 'string' ? arg : arg && typeof arg === 'object' ? String((arg as { url?: unknown }).url ?? '') : '';
          const max = arg && typeof arg === 'object' ? (arg as { maxBytes?: unknown }).maxBytes : undefined;
          const out = bridge.fetchText(url, typeof max === 'number' ? max : undefined);
          if (isThenable(out)) return out.then((text) => ({ ...reply, result: text }), (e: unknown) => ({ ...reply, error: String((e as Error)?.message || e) }));
          reply.result = out;
          break;
        }
        default:
          reply.error = `unknown command ${String((data as { cmd?: unknown }).cmd)}`;
      }
    } catch (e) {
      reply.error = String((e as Error).message || e);
    }
    return reply;
  };
  /** `{ __rerenderLensRelay: true, app }`: the relay telling this app which id it stamps messages with. */
  const isRelayGreeting = (data: unknown): data is { app: string } =>
    !!data && typeof data === 'object' && (data as { __rerenderLensRelay?: boolean }).__rerenderLensRelay === true && typeof (data as { app?: unknown }).app === 'string';
  const isCommand = (data: unknown): data is ChannelCommand => !!data && typeof data === 'object' && (data as ChannelCommand).__rerenderLensCmd === true && typeof (data as ChannelCommand).id === 'string';
  const envelope = (type: DevtoolsMessage['type'], payload?: unknown): DevtoolsMessage => ({ [DEVTOOLS_MARKER]: true, version: PROTOCOL_VERSION, type, payload });

  /** Extra places messages go (besides `window`): the BroadcastChannel and the relay. */
  const sinks: ((message: DevtoolsMessage | ChannelReply) => void)[] = [];

  // Optional cross-tab channel: same messages as `window`, plus a command/reply pair for panels.
  if (options.channel && typeof BroadcastChannel === 'function') {
    const name = typeof options.channel === 'string' ? options.channel : DEFAULT_CHANNEL;
    try {
      const channel = new BroadcastChannel(name);
      const answer = (reply: ChannelReply): void => {
        try {
          channel.postMessage(reply);
        } catch {
          /* not cloneable */
        }
      };
      channel.onmessage = (event: MessageEvent) => {
        if (!isCommand(event.data)) return;
        const reply = runCommand(event.data);
        if (isThenable(reply)) void reply.then(answer);
        else answer(reply);
      };
      sinks.push((message) => {
        try {
          channel.postMessage(message);
        } catch {
          /* payload not cloneable; the window path already carried it */
        }
      });
    } catch {
      /* no channel */
    }
  }

  // Optional relay (`npx rerender-lens panel`): SSE for commands in, batched POSTs for everything out.
  const relayUrl = options.relay ?? (typeof window !== 'undefined' ? window.__RERENDER_LENS_RELAY__ : undefined);
  const ES = options.eventSource ?? (typeof EventSource === 'function' ? (EventSource as unknown as EventSourceCtor) : null);
  if (relayUrl && ES && typeof fetch === 'function') {
    // The relay prints its URL with `?token=` when it is not on loopback; keep it out of the base.
    const [rawBase, relayQuery = ''] = relayUrl.split('?');
    const base = (rawBase ?? '').replace(/\/$/, '');
    const relayToken = new URLSearchParams(relayQuery).get('token');
    const auth = relayToken ? `token=${encodeURIComponent(relayToken)}` : '';
    let queue: unknown[] = [];
    let scheduled = false;
    // The relay hands out an id when the stream opens and stamps it on what this app posts, so a panel
    // watching several apps can tell them apart and address one of them. Unknown until the first message.
    let appId: string | null = null;
    const flush = (): void => {
      scheduled = false;
      const batch = queue;
      queue = [];
      const params = [appId ? `app=${encodeURIComponent(appId)}` : '', auth].filter(Boolean).join('&');
      const to = `${base}/message${params ? `?${params}` : ''}`;
      const body = JSON.stringify(batch);
      // `keepalive` keeps a last batch alive across an unload, but the Fetch standard caps such a
      // request body at 64 KB and fails the whole request over it. A big payload (a source map for
      // `fetchText`, or reports with large props) has to go as an ordinary request instead.
      fetch(to, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length <= KEEPALIVE_MAX_BYTES }).catch(() => {});
    };
    const relaySend = (message: unknown): void => {
      queue.push(message);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    };
    try {
      // The label is what the panel's app chooser shows; the page's own address is the useful default.
      const label = typeof location !== 'undefined' ? `${location.host}${location.pathname}`.slice(0, 120) : '';
      const stream = new ES(`${base}/events?role=app${label ? `&label=${encodeURIComponent(label)}` : ''}${auth ? `&${auth}` : ''}`);
      stream.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
          if (isRelayGreeting(m)) appId = m.app;
          else if (isCommand(m)) {
            const reply = runCommand(m);
            if (isThenable(reply)) void reply.then(relaySend);
            else relaySend(reply);
          }
        }
      };
      stream.onerror = () => {};
      sinks.push(relaySend);
    } catch {
      /* no relay */
    }
  }

  const postAll = (type: DevtoolsMessage['type'], payload?: unknown): void => {
    post(type, payload);
    if (sinks.length) {
      const message = envelope(type, payload);
      for (const sink of sinks) sink(message);
    }
  };
  if (sinks.length) {
    // Route replay/clear through the sinks too, so channel and relay panels see them.
    const replay = bridge.replay;
    const clear = bridge.clear;
    bridge.replay = () => {
      for (const sink of sinks) {
        sink(envelope('hello', info()));
        for (const e of buffer) sink(envelope('report', e.payload));
      }
      replay();
    };
    bridge.clear = () => {
      clear();
      for (const sink of sinks) sink(envelope('clear'));
    };
  }
  postAll('hello', info());

  return (report: RenderReport) => {
    const payload = serialize(report, maxDepth);
    buffer.push({ seq: ++seq, instanceId: report.instanceId, payload });
    if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
    postAll('report', payload);
    if (flashOn && report.avoidable && report.instanceId) {
      const fiber = fiberById(report.instanceId);
      if (fiber) flash({ nodes: hostNodesOf(fiber), label: report.component });
    }
  };
}
