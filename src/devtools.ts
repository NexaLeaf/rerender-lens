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
  /** The library's own cost: total and worst-case time spent inspecting commits, in ms. */
  overhead: { totalMs: number; maxCommitMs: number };
  /** Reports skipped because a commit exceeded the per-commit cap or time budget. */
  truncated: number;
}

/** Command sent by a panel over the BroadcastChannel; answered with a `ChannelReply` of the same id. */
export interface ChannelCommand {
  __rerenderLensCmd: true;
  id: string;
  cmd: 'info' | 'pull' | 'replay' | 'clear' | 'configure' | 'highlight' | 'flash';
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

  /** Answer a panel command (BroadcastChannel or relay). */
  const runCommand = (data: ChannelCommand): ChannelReply => {
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
      channel.onmessage = (event: MessageEvent) => {
        if (isCommand(event.data)) channel.postMessage(runCommand(event.data));
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
    const base = relayUrl.replace(/\/$/, '');
    let queue: unknown[] = [];
    let scheduled = false;
    // The relay hands out an id when the stream opens and stamps it on what this app posts, so a panel
    // watching several apps can tell them apart and address one of them. Unknown until the first message.
    let appId: string | null = null;
    const flush = (): void => {
      scheduled = false;
      const batch = queue;
      queue = [];
      const to = `${base}/message${appId ? `?app=${encodeURIComponent(appId)}` : ''}`;
      fetch(to, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch), keepalive: true }).catch(() => {});
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
      const stream = new ES(`${base}/events?role=app${label ? `&label=${encodeURIComponent(label)}` : ''}`);
      stream.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
          if (isRelayGreeting(m)) appId = m.app;
          else if (isCommand(m)) relaySend(runCommand(m));
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
