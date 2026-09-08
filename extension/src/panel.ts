/* rerender-lens DevTools panel. TypeScript source; `npm run build` writes extension/panel.js
 * (committed, so the extension loads unpacked and the jsdom tests run without a build step).
 * Exposes window.RerenderLensPanel.createPanel(root, transport, options) for tests, demo mode and the
 * Elements sidebar. Everything under `analysis` is pure and unit-tested on its own. */

// ---------- types ----------
type ChangeKind = 'deep-equal' | 'function' | 'element' | 'different' | 'added' | 'removed';

export interface Change {
  path: string;
  kind: ChangeKind;
  prev: unknown;
  next: unknown;
  hook?: string;
  index?: number;
  /** useContext: who renders the Provider. */
  provider?: { component: string | null; path: string[] };
  changedKeys?: string[];
  totalKeys?: number;
  /** Custom hooks between the component and the primitive (resolveHookNames). */
  custom?: string[];
}

export type CommitPriority = 'immediate' | 'user-blocking' | 'normal' | 'low' | 'idle';

export interface SourceLocation {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface Report {
  component: string;
  instanceId: number;
  commitId: number;
  renderCount: number;
  trigger: string;
  avoidable: boolean;
  memoized?: boolean;
  props: { prev: Record<string, unknown>; next: Record<string, unknown> };
  propChanges: Change[];
  stateChanges: Change[];
  hookChanges: Change[];
  /** Current values (protocol 2 libraries with `includeState`). */
  hookState?: { path: string; hook: string; index: number; value: unknown; custom?: string[] }[];
  contexts?: { name: string; value: unknown }[];
  state?: Record<string, unknown>;
  updaters?: string[];
  commitCause?: 'effect-after-commit' | 'suspense-resolved';
  afterCommit?: number;
  key?: string | null;
  parent: { name: string; trigger: string } | null;
  owner: string | null;
  path: string[];
  reasons: string[];
  time: number;
  selfDuration?: number;
  treeDuration?: number;
  source?: SourceLocation;
  commitPriority?: CommitPriority;
  receivedAt: number;
}

/** A recorded stretch of reports; summaries survive reloads (per origin), reports stay in memory. */
export interface SessionSummary {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  total: number;
  avoidable: number;
  wasted: number;
  byComponent: Record<string, { total: number; avoidable: number; wasted: number }>;
  fixes: { key: string; label: string; count: number }[];
}

export interface Session extends SessionSummary {
  reports: Report[];
}

export interface CompareRow {
  component: string;
  before: number;
  after: number;
  delta: number;
}

export interface Comparison {
  before: SessionSummary;
  after: SessionSummary;
  rows: CompareRow[];
  total: { before: number; after: number; delta: number };
  avoidable: { before: number; after: number; delta: number };
  wasted: { before: number; after: number; delta: number };
  /** Fixes suggested in `before` that no longer appear in `after`. */
  resolvedFixes: { key: string; label: string; count: number }[];
  newFixes: { key: string; label: string; count: number }[];
}

export interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  reports: Report[];
  total: number;
  avoidable: number;
  wasted: number;
  expanded: boolean;
  path: string[];
  key: string;
  lastReport?: Report;
  flash?: boolean;
  flashAt?: number;
}

export interface Fix {
  kind: 'memo' | 'useCallback' | 'useMemo' | 'useMemoElement' | 'children' | 'contextValue' | 'splitContext' | 'storeSnapshot' | 'bailout';
  owner: string;
  target: string;
  prop: string | null;
  label: string;
  detail: string;
  snippet: string;
}

export interface RankedFix extends Fix {
  key: string;
  count: number;
  components: Map<string, number>;
  reports: Report[];
}

export interface RootCause {
  name: string;
  trigger: string;
  count: number;
  components: Map<string, number>;
}

export interface ContextStat {
  name: string;
  consumers: number;
  avoidable: number;
  components: Map<string, number>;
  commits: Set<number>;
  /** Components rendering the Provider (usually one). */
  providers: Map<string, number>;
  /** Keys that changed in object values, and the largest key count seen. */
  changedKeys: Set<string>;
  totalKeys: number;
}

export interface CommitAnalysis {
  id: number;
  receivedAt: number;
  total: number;
  avoidable: number;
  wasted: number;
  roots: RootCause[];
  /** Root cause name of every avoidable report (what `roots` was aggregated from). */
  rootByReport: Map<Report, string>;
  contexts: ContextStat[];
  fixes: RankedFix[];
  reports: Report[];
}

interface CascadeNode {
  name: string;
  children: Map<string, CascadeNode>;
  report: Report | null;
  count?: number;
  avoidable?: number;
}

export interface HelloPayload {
  library?: string;
  protocol: number;
  react?: { version?: string; bundleType?: number }[];
  production?: boolean;
  enabled?: boolean;
  options?: SerializableOptions;
  source?: 'page' | 'extension';
  injected?: boolean;
  commits?: number;
  overhead?: { totalMs: number; maxCommitMs: number };
  /** Reports the library skipped because a commit exceeded its per-commit cap or time budget. */
  truncated?: number;
}

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

export interface OriginStatus {
  origin: string;
  builtIn: boolean;
  permitted: boolean;
  enabled: boolean;
  inject: boolean;
  deferHook?: boolean;
}

export interface Message {
  type: string;
  payload?: unknown;
  version?: number;
  on?: boolean;
  /** `type: 'batch'`: messages coalesced by the content script, in arrival order. */
  items?: unknown[];
}

/** Only `subscribe` is required; the panel degrades gracefully without the rest. */
export interface Transport {
  subscribe(fn: (m: Message) => void): void;
  replay?(): void;
  clear?(): void;
  origin?: string | null;
  configure?(options: SerializableOptions): Promise<SerializableOptions | undefined>;
  highlight?(id: number | null): unknown;
  flashAvoidable?(on: boolean): unknown;
  openResource?(url: string, line?: number, col?: number): void;
  originStatus?(): Promise<OriginStatus | null>;
  setOrigin?(cfg: { enabled: boolean; inject: boolean; deferHook: boolean }): Promise<unknown>;
  requestPermission?(): Promise<boolean>;
  storage?: { get(key: string): Promise<unknown> | unknown; set(key: string, value: unknown): unknown };
  badge?(count: number): void;
  copy?(text: string): unknown;
  /** Show this panel outside DevTools: Chrome's side panel next to the page, or its own window. */
  undock?(mode: 'sidepanel' | 'window'): Promise<unknown>;
  /** Standalone mode: which tab the panel follows (shown as a chip in the toolbar). */
  tabLabel?: string | null;
  /** Text of a page resource (the module that created an element), for source context. */
  readSource?(url: string): Promise<string | null>;
  /** Stop timers and connections (the panel keeps its state). */
  dispose?(): void;
}

export interface PanelOptions {
  theme?: 'dark' | 'light';
}

interface PersistedState {
  filter?: string;
  avoidableOnly?: boolean;
  view?: View;
  tab?: Tab;
  streamCollapsed?: boolean;
  collapsed?: string[];
  treeWidth?: number;
  flashOn?: boolean;
  byInstance?: boolean;
}

type View = 'tree' | 'offenders' | 'commits' | 'fixes' | 'sessions';
type Tab = 'latest' | 'history' | 'fix' | 'commit' | 'fixlist' | 'root' | 'session';

export interface PanelState {
  tree: TreeNode;
  nodesByKey: Map<string, TreeNode>;
  reports: Report[];
  commits: Map<number, Report[]>;
  commitOrder: number[];
  selectedKey: string | null;
  selectedReport: Report | null;
  selectedCommit: number | null;
  selectedFix: string | null;
  selectedRoot: string | null;
  view: View;
  tab: Tab;
  paused: boolean;
  avoidableOnly: boolean;
  filter: string;
  relay: boolean;
  library: HelloPayload | null;
  polling: boolean;
  streamCollapsed: boolean;
  collapsed: Set<string>;
  sort: { key: OffenderKey; dir: 1 | -1 };
  flashOn: boolean;
  settingsOpen: boolean;
  origin: string | null;
  treeWidth?: number;
  tabLabel: string | null;
  compact: boolean;
  sessions: Session[];
  recording: Session | null;
  selectedSession: string | null;
  compareWith: string | null;
  byInstance: boolean;
}

export interface Panel {
  state: PanelState;
  handle(message: Message): void;
  flush(): void;
  clearAll(): void;
  importData(data: unknown): number;
  select(name: string): void;
  setView(view: View): void;
  openSettings(): void;
  startRecording(name?: string): Session;
  stopRecording(): Session | null;
}

type OffenderKey = 'component' | 'avoidable' | 'total' | 'wasted';

interface Offender {
  component: string;
  total: number;
  avoidable: number;
  wasted: number;
  paths: Set<string>;
  reports: Report[];
  fix: string;
}

declare global {
  interface Window {
    RerenderLensPanel: typeof api;
  }
}

// ---------- constants ----------
const PROTOCOL = 2;
const KIND_LABEL: Record<string, string> = {
  'deep-equal': 'equal by value',
  function: 'new function',
  element: 'equal element',
  different: 'changed',
  added: 'added',
  removed: 'removed',
};
const AVOIDABLE_KINDS = new Set<string>(['deep-equal', 'function', 'element']);
const FN_PREFIX = 'ƒ '; // "f " as emitted by the library's serialize()
const MAX_REPORTS = 2000;
const MAX_PER_NODE = 200;
const MAX_COMMITS = 500;
const MAX_PER_COMMIT = 500; // reports kept per commit (the first ones: ancestors come first, which is what root-cause analysis needs)
// While streaming with at least this many reports buffered, the expensive re-renders are throttled; below it everything is synchronous (tests).
const THROTTLE_MIN_REPORTS = 200;
const BEST_FIX_INTERVAL = 500; // ms between `rankFixes` over the whole buffer for the summary strip
const LEFT_RENDER_INTERVAL = 250; // ms between rebuilds of the Offenders / Commits / Fixes / Sessions lists
// Page handshake (`info`) retries: 500 ms doubling to 5 s, about 20 tries (~90 s).
const SYNC_RETRY_MIN = 500;
const SYNC_RETRY_MAX = 5000;
const SYNC_RETRIES = 20;
const NAVIGATION_SETTLE = 1200; // ms after a navigation before the first `info` (the old document may still answer)
const ROW_H = 22; // tree row height (px), must match panel.css
const ITEM_H = 20; // stream item height (px), must match panel.css
const OVERSCAN = 8;
const FALLBACK_VIEWPORT = 800; // when the container has no layout (jsdom)

// ---------- tiny DOM helpers ----------
type Child = Node | string | null | undefined;
type Attrs = Record<string, unknown>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, children?: Child | Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k.startsWith('on')) {
        if (typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
      } else if (v === true) node.setAttribute(k, '');
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, String(v));
    }
  }
  if (children) for (const c of ([] as Child[]).concat(children)) if (c != null) node.append(c);
  return node;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`;
}

const fmtMs = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(1)} ms` : '');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const componentList = (m: Map<string, number>): string => [...m].map(([c, n]) => `<${c}>${n > 1 ? ' ×' + n : ''}`).join(', ');

function changesOf(report: Report): Change[] {
  return ([] as Change[]).concat(report.propChanges || [], report.stateChanges || [], report.hookChanges || []);
}

function summarize(report: Report): string {
  const counts = new Map<string, number>();
  for (const c of changesOf(report)) counts.set(c.kind, (counts.get(c.kind) || 0) + 1);
  if (counts.size === 0) return 'no changes';
  return [...counts].map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(', ');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Make an incoming payload safe to render; null when it is not a report at all. */
function normalizeReport(p: unknown): Report | null {
  if (!isRecord(p) || typeof p.component !== 'string') return null;
  const arr = (x: unknown): Change[] => (Array.isArray(x) ? x.filter((c): c is Change => isRecord(c) && typeof c.path === 'string') : []);
  const props = isRecord(p.props) ? p.props : {};
  const parent = isRecord(p.parent) && typeof p.parent.name === 'string' ? { name: p.parent.name, trigger: typeof p.parent.trigger === 'string' ? p.parent.trigger : 'parent' } : null;
  const r: Report = {
    component: p.component,
    instanceId: typeof p.instanceId === 'number' ? p.instanceId : 0,
    commitId: typeof p.commitId === 'number' ? p.commitId : 0,
    renderCount: typeof p.renderCount === 'number' ? p.renderCount : 0,
    trigger: typeof p.trigger === 'string' ? p.trigger : 'parent',
    avoidable: !!p.avoidable,
    props: { prev: isRecord(props.prev) ? props.prev : {}, next: isRecord(props.next) ? props.next : {} },
    propChanges: arr(p.propChanges),
    stateChanges: arr(p.stateChanges),
    hookChanges: arr(p.hookChanges),
    parent,
    owner: typeof p.owner === 'string' ? p.owner : null,
    path: Array.isArray(p.path) ? p.path.filter((x): x is string => typeof x === 'string') : [],
    reasons: Array.isArray(p.reasons) ? p.reasons.filter((x): x is string => typeof x === 'string') : [],
    time: typeof p.time === 'number' ? p.time : 0,
    receivedAt: typeof p.receivedAt === 'number' ? p.receivedAt : 0,
  };
  if (typeof p.selfDuration === 'number') r.selfDuration = p.selfDuration;
  if (typeof p.treeDuration === 'number') r.treeDuration = p.treeDuration;
  if (typeof p.memoized === 'boolean') r.memoized = p.memoized;
  if (typeof p.commitPriority === 'string') r.commitPriority = p.commitPriority as CommitPriority;
  if (Array.isArray(p.hookState)) r.hookState = p.hookState.filter((h): h is Report['hookState'] extends (infer T)[] | undefined ? T : never => isRecord(h) && typeof h.path === 'string');
  if (Array.isArray(p.contexts)) r.contexts = p.contexts.filter((c): c is { name: string; value: unknown } => isRecord(c) && typeof c.name === 'string');
  if (isRecord(p.state)) r.state = p.state;
  if (Array.isArray(p.updaters)) r.updaters = p.updaters.filter((u): u is string => typeof u === 'string');
  if (p.commitCause === 'effect-after-commit' || p.commitCause === 'suspense-resolved') r.commitCause = p.commitCause;
  if (typeof p.afterCommit === 'number') r.afterCommit = p.afterCommit;
  if (typeof p.key === 'string') r.key = p.key;
  if (isRecord(p.source) && typeof p.source.fileName === 'string') r.source = p.source as unknown as SourceLocation;
  return r;
}

// ---------- value rendering ----------
function valueNode(v: unknown, depth = 0): HTMLElement {
  if (v === null || v === undefined) return el('span', { class: 'v nil', text: String(v) });
  const t = typeof v;
  if (typeof v === 'string') {
    if (v.startsWith(FN_PREFIX)) return el('span', { class: 'v fn', text: v });
    if (/^<[^>]+>$/.test(v)) return el('span', { class: 'v', text: v });
    return el('span', { class: 'v str', text: JSON.stringify(v) });
  }
  if (t === 'number' || t === 'bigint') return el('span', { class: 'v num', text: String(v) });
  if (t === 'boolean') return el('span', { class: 'v bool', text: String(v) });
  if (Array.isArray(v)) {
    const short = v.length <= 4 && v.every((x) => typeof x !== 'object' || x === null);
    if (short) {
      const s = el('span', { class: 'v' }, '[');
      v.forEach((x, i) => {
        if (i) s.append(', ');
        s.append(valueNode(x, depth + 1));
      });
      s.append(']');
      return s;
    }
    return objectDetails(`Array(${v.length})`, v);
  }
  const o = v as Record<string, unknown>;
  if (o.$type === 'element') {
    // Serialized React element: `<Name>` with its props behind a toggle (children diffs read through it).
    const props = isRecord(o.props) ? o.props : {};
    const label = `<${String(o.name)}${o.key !== undefined ? ` key=${JSON.stringify(o.key)}` : ''}>`;
    return Object.keys(props).length ? objectDetails(label, props) : el('span', { class: 'v', text: label });
  }
  if (o.$type === 'Date') return el('span', { class: 'v', text: `Date(${String(o.value)})` });
  if (o.$type === 'RegExp') return el('span', { class: 'v', text: String(o.value) });
  if (o.$type === 'Map' && Array.isArray(o.entries)) return objectDetails(`Map(${o.entries.length})`, o.entries);
  if (o.$type === 'Set' && Array.isArray(o.values)) return objectDetails(`Set(${o.values.length})`, o.values);
  const keys = Object.keys(o).filter((k) => k !== '$type');
  const label = `${o.$type ? String(o.$type) + ' ' : ''}{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
  return objectDetails(label, o);
}

function objectDetails(label: string, obj: unknown): HTMLElement {
  const d = el('details', { class: 'obj' }, [el('summary', { text: label })]);
  d.addEventListener(
    'toggle',
    () => {
      if (d.open && !d.querySelector('pre')) d.append(el('pre', { text: JSON.stringify(obj, null, 2) }));
    },
    { once: true },
  );
  return d;
}

// ---------- analysis (pure) ----------
/** First path at which two serialized values differ, e.g. "style.color" or "items[2].id"; null when equal. */
function firstDifferentPath(a: unknown, b: unknown, base = ''): string | null {
  if (a === b) return null;
  if (!isRecord(a) || !isRecord(b)) return base || '(value)';
  if (Array.isArray(a) !== Array.isArray(b)) return base || '(value)';
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return base ? `${base}.length` : 'length';
    for (let i = 0; i < a.length; i++) {
      const p = firstDifferentPath(a[i], b[i], `${base}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = firstDifferentPath(a[k], b[k], base ? `${base}.${k}` : k);
    if (p) return p;
  }
  return null;
}

export interface Leaf {
  path: string;
  prev: unknown;
  next: unknown;
}

/** Every leaf at which two serialized values differ (bounded), for the diff view of `different` changes. */
function diffLeaves(a: unknown, b: unknown, limit = 20, base = '', out: Leaf[] = []): Leaf[] {
  if (out.length >= limit || a === b) return out;
  if (!isRecord(a) || !isRecord(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: base || '(value)', prev: a, next: b });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && out.length < limit; i++) diffLeaves(a[i], b[i], limit, `${base}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (out.length >= limit) break;
    diffLeaves(a[k], b[k], limit, base ? `${base}.${k}` : k, out);
  }
  return out;
}

function shortValue(v: unknown, max = 60): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

const identifier = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : 'value');

/** The concrete fixes one report suggests, each attributed to the file that must change. */
function fixesFor(r: Report): Fix[] {
  const out: Fix[] = [];
  const ownerName = r.owner || (r.parent && r.parent.name) || null;
  const changes = changesOf(r);
  const avoidableProps = (r.propChanges || []).filter((c) => AVOIDABLE_KINDS.has(c.kind));
  // Not memoized: props alone will never stop the re-render, so React.memo comes first (in addition to
  // any prop fixes below). Reports from protocol-1 libraries have no `memoized`; assume memoized then.
  if (r.avoidable && (changes.length === 0 || r.memoized === false)) {
    const identical = changes.length === 0;
    out.push({
      kind: 'memo',
      owner: r.component,
      target: r.component,
      prop: null,
      label: `Wrap <${r.component}> in React.memo`,
      detail: identical
        ? `<${r.component}> re-rendered with identical props because <${(r.parent && r.parent.name) || 'its parent'}> re-rendered.`
        : `<${r.component}> is not memoized: fixing its props alone will not stop the re-render.`,
      snippet: `// ${r.component}\nimport { memo } from 'react';\n\nexport const ${r.component} = memo(function ${r.component}(props) {\n  // ...\n});\n// class components: extend PureComponent instead`,
    });
  }
  for (const c of avoidableProps) {
    const owner = ownerName || '?';
    const root = c.path.split(/[.[]/)[0] || c.path;
    const id = identifier(root);
    if (root === 'children' && (c.kind === 'element' || c.kind === 'deep-equal')) {
      out.push({
        kind: 'children',
        owner,
        target: r.component,
        prop: 'children',
        label: `memoize children of <${r.component}> in <${owner}>`,
        detail: `<${owner}> re-creates the children of <${r.component}> on every render; they have the same types and props each time.`,
        snippet:
          `// ${owner}\nimport { useMemo } from 'react';\n\nconst children = useMemo(() => (\n  <>{/* the same elements */}</>\n), [/* deps */]);\n\n<${r.component}>{children}</${r.component}>\n\n` +
          `// static children: hoist them to module scope\nconst STATIC = <em>hi</em>;`,
      });
      continue;
    }
    if (c.kind === 'function') {
      out.push({
        kind: 'useCallback',
        owner,
        target: r.component,
        prop: root,
        label: `useCallback(${root}) in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new function on every render of <${owner}>.`,
        snippet: `// ${owner}\nimport { useCallback } from 'react';\n\nconst ${id} = useCallback((/* args */) => {\n  // ...\n}, [/* deps */]);\n\n<${r.component} ${root}={${id}} />`,
      });
    } else if (c.kind === 'element') {
      out.push({
        kind: 'useMemoElement',
        owner,
        target: r.component,
        prop: root,
        label: `memoize element prop ${root} in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new element with the same type and props on every render of <${owner}>.`,
        snippet: `// ${owner}\nimport { useMemo } from 'react';\n\nconst ${id} = useMemo(() => ${shortValue(c.next, 40)}, [/* deps */]);\n// or pass it as children from a component that does not re-render`,
      });
    } else {
      const isArray = Array.isArray(c.next);
      out.push({
        kind: 'useMemo',
        owner,
        target: r.component,
        prop: root,
        label: `useMemo(${root}) in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new ${isArray ? 'array' : 'object'} with the same contents on every render of <${owner}>.`,
        snippet:
          `// ${owner}\nimport { useMemo } from 'react';\n\nconst ${id} = useMemo(() => (${shortValue(c.next, 80)}), [/* deps */]);\n\n` +
          `// or, when it never changes, hoist it to module scope:\nconst ${id.toUpperCase()} = ${shortValue(c.next, 80)};`,
      });
    }
  }
  for (const c of ([] as Change[]).concat(r.stateChanges || [], r.hookChanges || [])) {
    const isContext = c.hook === 'useContext' || /^useContext/.test(c.path);
    const ctxName = isContext ? (/useContext\((.*)\)/.exec(c.path) || [])[1] || 'Context' : '';
    const providerOwner = isContext && c.provider && c.provider.component ? c.provider.component : null;
    // A genuine change of a few keys in an object context still re-renders every consumer.
    if (isContext && c.kind === 'different' && c.changedKeys && typeof c.totalKeys === 'number' && c.changedKeys.length > 0 && c.changedKeys.length < c.totalKeys) {
      out.push({
        kind: 'splitContext',
        owner: providerOwner || `${ctxName}.Provider`,
        target: r.component,
        prop: ctxName,
        label: `split ${ctxName}${providerOwner ? ` in <${providerOwner}>` : ''}: only ${c.changedKeys.join(', ')} changed`,
        detail: `${c.changedKeys.map((k) => `"${k}"`).join(', ')} of ${c.totalKeys} keys changed in ${ctxName}, yet every consumer (like <${r.component}>) re-rendered. Consumers that read the other keys re-render for nothing.`,
        snippet:
          `// ${providerOwner || 'Provider'}\n// one context per independently-changing slice\nconst ${identifier(ctxName)}Static = createContext(...);\nconst ${identifier(ctxName)}${c.changedKeys.map((k) => k[0]!.toUpperCase() + k.slice(1)).join('')} = createContext(...);\n\n` +
          `// or keep one context and let consumers select a slice:\nconst ${c.changedKeys[0]} = useContextSelector(${ctxName}, (v) => v.${c.changedKeys[0]});`,
      });
      continue;
    }
    if (!AVOIDABLE_KINDS.has(c.kind)) continue;
    if (isContext) {
      const name = ctxName;
      out.push({
        kind: 'contextValue',
        owner: providerOwner || `${name}.Provider`,
        target: r.component,
        prop: name,
        label: `memoize the ${name} provider value${providerOwner ? ` in <${providerOwner}>` : ''}`,
        detail: `<${r.component}> re-rendered because ${name} produced a new value that is deep-equal to the previous one${providerOwner ? ` (Provider rendered by <${providerOwner}>)` : ''}.`,
        snippet: `// ${providerOwner || `where <${name}.Provider> is rendered`}\nconst value = useMemo(() => ({ /* ... */ }), [/* deps */]);\n<${name}.Provider value={value}>`,
      });
    } else if (c.hook === 'useSyncExternalStore') {
      const chain = c.custom || [];
      const redux = chain.some((n) => /^use(App)?Selector$/.test(n));
      const zustand = !redux && chain.some((n) => /^use[A-Z]\w*Store$/.test(n) || n === 'useStore' || n === 'useBoundStore');
      const via = chain.length ? ` via ${chain.join(' › ')}` : '';
      out.push({
        kind: 'storeSnapshot',
        owner: r.component,
        target: r.component,
        prop: c.path,
        label: redux ? `memoize the selector in <${r.component}>` : zustand ? `useShallow in <${r.component}>` : `stable getSnapshot in <${r.component}>`,
        detail: redux
          ? `the selector${via} returns a new object on every call, so the component re-renders on every store change.`
          : zustand
            ? `the store selector${via} returns a new object on every call, so the component re-renders on every store change.`
            : `${c.path}${via} returned a new reference with the same contents; getSnapshot must return a cached value.`,
        snippet: redux
          ? `// ${r.component}\nimport { shallowEqual } from 'react-redux';\nconst slice = useSelector(selectSlice, shallowEqual);\n// or memoize: const selectSlice = createSelector([selectA, selectB], (a, b) => ({ a, b }));`
          : zustand
            ? `// ${r.component}\nimport { useShallow } from 'zustand/react/shallow';\nconst { a, b } = useStore(useShallow((s) => ({ a: s.a, b: s.b })));\n// or select a primitive: const a = useStore((s) => s.a);`
            : `// ${r.component}\n// getSnapshot must return the same reference while the data is unchanged\nconst snapshot = useSyncExternalStore(subscribe, store.getSnapshot /* cached */);`,
      });
    } else {
      out.push({
        kind: 'bailout',
        owner: r.component,
        target: r.component,
        prop: c.path,
        label: `bail out before setting ${c.path} in <${r.component}>`,
        detail: `${c.path} was set to a value deep-equal to the current one (new reference).`,
        snippet: `// ${r.component}\nsetState((prev) => (deepEqual(prev, next) ? prev : next));`,
      });
    }
  }
  return out;
}

const fixKey = (f: Fix): string => `${f.kind}|${f.owner}|${f.prop || f.target}`;

/** Aggregate fixes over many reports: how many avoidable renders each one removes. */
function rankFixes(reports: Report[]): RankedFix[] {
  const byKey = new Map<string, RankedFix>();
  for (const r of reports) {
    if (!r.avoidable) continue;
    for (const f of fixesFor(r)) {
      const k = fixKey(f);
      let agg = byKey.get(k);
      if (!agg) {
        agg = { ...f, key: k, count: 0, components: new Map(), reports: [] };
        byKey.set(k, agg);
      }
      agg.count++;
      agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
      if (agg.reports.length < 50) agg.reports.push(r);
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const isAncestorReport = (anc: Report, r: Report): boolean =>
  anc.path.length < r.path.length && r.path[anc.path.length] === anc.component && anc.path.every((p, i) => r.path[i] === p);

/** One commit's reports grouped by component name, so a parent lookup is O(same-named reports) instead of O(commit). */
function indexByComponent(reports: Report[]): Map<string, Report[]> {
  const index = new Map<string, Report[]>();
  for (const r of reports) {
    const list = index.get(r.component);
    if (list) list.push(r);
    else index.set(r.component, [r]);
  }
  return index;
}

/** Walk `parent` links inside one commit up to the component whose own change started the cascade. */
function rootCauseOf(r: Report, commitReports: Report[], index: Map<string, Report[]> = indexByComponent(commitReports)): { name: string; trigger: string; report: Report | null } | null {
  let cur = r;
  const seen = new Set<Report>([r]);
  while (cur.trigger === 'parent' && cur.parent) {
    const parent = cur.parent;
    const candidates = index.get(parent.name);
    const p = candidates && candidates.find((x) => isAncestorReport(x, cur));
    if (!p || seen.has(p)) return { name: parent.name, trigger: parent.trigger, report: null };
    seen.add(p);
    cur = p;
  }
  return cur === r ? null : { name: cur.component, trigger: cur.trigger, report: cur };
}

/** Group reports by commit and rank what started each cascade. */
function analyzeCommit(reports: Report[]): CommitAnalysis {
  const roots = new Map<string, RootCause>();
  const rootByReport = new Map<Report, string>();
  const index = indexByComponent(reports);
  let avoidable = 0;
  let wasted = 0;
  for (const r of reports) {
    if (!r.avoidable) continue;
    avoidable++;
    if (typeof r.selfDuration === 'number') wasted += r.selfDuration;
    const root = rootCauseOf(r, reports, index);
    const name = root ? root.name : (r.parent && r.parent.name) || '(unknown)';
    const trigger = root ? root.trigger : (r.parent && r.parent.trigger) || 'parent';
    rootByReport.set(r, name);
    let agg = roots.get(name);
    if (!agg) {
      agg = { name, trigger, count: 0, components: new Map() };
      roots.set(name, agg);
    }
    agg.count++;
    agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
  }
  const first = reports[0];
  return {
    id: first ? first.commitId : 0,
    receivedAt: first ? first.receivedAt : 0,
    total: reports.length,
    avoidable,
    wasted,
    roots: [...roots.values()].sort((a, b) => b.count - a.count),
    rootByReport,
    contexts: contextAttribution(reports),
    fixes: rankFixes(reports),
    reports,
  };
}

/** Which contexts changed and how many consumers re-rendered because of them. */
function contextAttribution(reports: Report[]): ContextStat[] {
  const byCtx = new Map<string, ContextStat>();
  for (const r of reports) {
    for (const c of r.hookChanges || []) {
      if (c.hook !== 'useContext' && !/^useContext/.test(c.path)) continue;
      const m = /useContext\((.*)\)/.exec(c.path);
      const name = m && m[1] ? m[1] : c.path;
      let agg = byCtx.get(name);
      if (!agg) {
        agg = { name, consumers: 0, avoidable: 0, components: new Map(), commits: new Set(), providers: new Map(), changedKeys: new Set(), totalKeys: 0 };
        byCtx.set(name, agg);
      }
      agg.consumers++;
      if (AVOIDABLE_KINDS.has(c.kind)) agg.avoidable++;
      agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
      agg.commits.add(r.commitId);
      if (c.provider && c.provider.component) agg.providers.set(c.provider.component, (agg.providers.get(c.provider.component) || 0) + 1);
      if (c.changedKeys) for (const k of c.changedKeys) agg.changedKeys.add(k);
      if (typeof c.totalKeys === 'number') agg.totalKeys = Math.max(agg.totalKeys, c.totalKeys);
    }
  }
  return [...byCtx.values()].sort((a, b) => b.consumers - a.consumers);
}

/** Nested cascade for one commit: every report placed under its ancestors (untracked ancestors appear as plain names). */
function cascadeTree(reports: Report[]): CascadeNode {
  const root: CascadeNode = { name: '', children: new Map(), report: null };
  for (const r of reports) {
    let node = root;
    for (const seg of r.path.concat([r.component])) {
      let next = node.children.get(seg);
      if (!next) {
        next = { name: seg, children: new Map(), report: null };
        node.children.set(seg, next);
      }
      node = next;
    }
    if (!node.report || r.avoidable) node.report = r;
    node.count = (node.count || 0) + 1;
    if (r.avoidable) node.avoidable = (node.avoidable || 0) + 1;
  }
  return root;
}

export interface RootSummary {
  name: string;
  trigger: string;
  commits: { key: number; analysis: CommitAnalysis; count: number; components: Map<string, number> }[];
  total: number;
  components: Map<string, number>;
  fixes: RankedFix[];
}

/**
 * Every commit a component started (as the root cause), across the whole session.
 * `analyze` lets the panel pass its per-commit memoized analysis.
 */
function rootCauseSummary(name: string, commits: Iterable<[number, Report[]]>, analyze: (key: number, reports: Report[]) => CommitAnalysis = (_, reports) => analyzeCommit(reports)): RootSummary {
  const out: RootSummary = { name, trigger: 'parent', commits: [], total: 0, components: new Map(), fixes: [] };
  const affected: Report[] = [];
  for (const [key, reports] of commits) {
    const analysis = analyze(key, reports);
    const root = analysis.roots.find((x) => x.name === name);
    if (!root) continue;
    out.trigger = root.trigger;
    out.commits.push({ key, analysis, count: root.count, components: root.components });
    out.total += root.count;
    for (const [c, n] of root.components) out.components.set(c, (out.components.get(c) || 0) + n);
    for (const r of reports) if (r.avoidable && analysis.rootByReport.get(r) === name) affected.push(r);
  }
  out.commits.reverse();
  out.fixes = rankFixes(affected);
  return out;
}

// ---------- sessions (pure) ----------
function summarizeSession(session: Pick<SessionSummary, 'id' | 'name' | 'startedAt' | 'endedAt'>, reports: Report[]): SessionSummary {
  const byComponent: SessionSummary['byComponent'] = {};
  let avoidable = 0;
  let wasted = 0;
  for (const r of reports) {
    const c = (byComponent[r.component] ||= { total: 0, avoidable: 0, wasted: 0 });
    c.total++;
    if (r.avoidable) {
      c.avoidable++;
      avoidable++;
      if (typeof r.selfDuration === 'number') {
        c.wasted += r.selfDuration;
        wasted += r.selfDuration;
      }
    }
  }
  return {
    id: session.id,
    name: session.name,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    total: reports.length,
    avoidable,
    wasted,
    byComponent,
    fixes: rankFixes(reports).map((f) => ({ key: f.key, label: f.label, count: f.count })),
  };
}

/** Before/after: avoidable re-renders per component, totals, and which fixes went away. */
function compareSessions(before: SessionSummary, after: SessionSummary): Comparison {
  const names = new Set([...Object.keys(before.byComponent), ...Object.keys(after.byComponent)]);
  const rows: CompareRow[] = [];
  for (const component of names) {
    const b = before.byComponent[component]?.avoidable || 0;
    const a = after.byComponent[component]?.avoidable || 0;
    if (b || a) rows.push({ component, before: b, after: a, delta: a - b });
  }
  rows.sort((x, y) => x.delta - y.delta || y.before - x.before || x.component.localeCompare(y.component));
  const afterKeys = new Set(after.fixes.map((f) => f.key));
  const beforeKeys = new Set(before.fixes.map((f) => f.key));
  return {
    before,
    after,
    rows,
    total: { before: before.total, after: after.total, delta: after.total - before.total },
    avoidable: { before: before.avoidable, after: after.avoidable, delta: after.avoidable - before.avoidable },
    wasted: { before: before.wasted, after: after.wasted, delta: after.wasted - before.wasted },
    resolvedFixes: before.fixes.filter((f) => !afterKeys.has(f.key)),
    newFixes: after.fixes.filter((f) => !beforeKeys.has(f.key)),
  };
}

const PRIORITY_LABEL: Record<string, string> = { immediate: 'discrete input', 'user-blocking': 'continuous input', normal: 'transition / async', low: 'low', idle: 'idle' };

/** Lines around a location in a module's source, for the "where the element was created" box. */
function sourceContext(text: string, line: number, around = 3): { n: number; text: string; hit: boolean }[] {
  const lines = text.split('\n');
  const from = Math.max(1, line - around);
  const to = Math.min(lines.length, line + around);
  const out: { n: number; text: string; hit: boolean }[] = [];
  for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1] ?? '', hit: n === line });
  return out;
}

function reportToMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`### <${r.component}> ${r.avoidable ? 'avoidable re-render' : `re-render (${r.trigger})`} #${r.renderCount}`);
  lines.push('');
  for (const x of r.reasons || []) lines.push(`- ${x}`);
  if (r.path && r.path.length) lines.push('', `**Path:** ${r.path.concat([r.component]).join(' > ')}`);
  if (r.parent) lines.push(`**Triggered by:** <${r.parent.name}> (${r.parent.trigger})`);
  if (r.owner) lines.push(`**Created by:** <${r.owner}>`);
  if (r.source) lines.push(`**Source:** ${r.source.fileName}${r.source.lineNumber ? ':' + r.source.lineNumber : ''}`);
  const changes = changesOf(r);
  if (changes.length) {
    lines.push('', '| path | kind | prev | next |', '| --- | --- | --- | --- |');
    for (const c of changes) lines.push(`| ${c.path} | ${KIND_LABEL[c.kind] || c.kind} | \`${shortValue(c.prev, 40)}\` | \`${shortValue(c.next, 40)}\` |`);
  }
  if (r.hookState && r.hookState.length) {
    lines.push('', '**Hooks**', '');
    for (const h of r.hookState) lines.push(`- ${h.path}: \`${shortValue(h.value, 60)}\``);
  }
  if (r.state && Object.keys(r.state).length) lines.push('', `**State:** \`${shortValue(r.state, 120)}\``);
  if (r.contexts && r.contexts.length) {
    lines.push('', '**Contexts**', '');
    for (const c of r.contexts) lines.push(`- ${c.name}: \`${shortValue(c.value, 60)}\``);
  }
  const fixes = fixesFor(r);
  if (fixes.length) {
    lines.push('', '**Fix**', '');
    for (const f of fixes) lines.push(`- ${f.label}`);
    lines.push('', '```jsx', fixes[0]!.snippet, '```');
  }
  return lines.join('\n');
}

// ---------- report view (shared with the Elements sidebar) ----------
function changeRow(label: string, c: Change, suffix = ''): HTMLTableRowElement {
  const tr = el('tr', { class: 'changed' + (AVOIDABLE_KINDS.has(c.kind) ? '' : ' real') });
  tr.append(el('td', { class: 'k', text: label }));
  const td = el('td');
  td.append(valueNode(c.prev), el('span', { class: 'arrow', text: '→' }));
  td.append(c.kind === 'removed' ? el('span', { class: 'v nil', text: '(removed)' }) : valueNode(c.next));
  let kind = (KIND_LABEL[c.kind] || c.kind) + suffix;
  const objectDiff = c.kind === 'different' && isRecord(c.prev) && isRecord(c.next);
  if (objectDiff) {
    const p = firstDifferentPath(c.prev, c.next, c.path);
    if (p) kind += ` at ${p}`;
  }
  td.append(el('span', { class: 'kind', text: kind }));
  if (objectDiff) {
    // Diff view: straight to the leaves that differ, without expanding the whole object.
    const leaves = diffLeaves(c.prev, c.next, 20, c.path);
    if (leaves.length) {
      const d = el('details', { class: 'diff' }, [el('summary', { text: `${leaves.length}${leaves.length >= 20 ? '+' : ''} differing ${leaves.length === 1 ? 'leaf' : 'leaves'}` })]);
      const table = el('table', { class: 'kv leaves' });
      for (const leaf of leaves) {
        const row = el('tr');
        row.append(el('td', { class: 'k', text: leaf.path }));
        const cell = el('td');
        cell.append(valueNode(leaf.prev), el('span', { class: 'arrow', text: '→' }), valueNode(leaf.next));
        row.append(cell);
        table.append(row);
      }
      d.append(table);
      td.append(d);
    }
  }
  tr.append(td);
  return tr;
}

function kvSection(title: string, next: Record<string, unknown>, changes: Change[]): HTMLElement {
  const byKey = new Map(changes.map((c) => [c.path.split(/[.[]/)[0], c] as const));
  const table = el('table', { class: 'kv' });
  for (const k of Object.keys(next || {})) {
    const c = byKey.get(k);
    if (c) {
      table.append(changeRow(k, c, c.path !== k ? ` at ${c.path}` : ''));
    } else {
      const tr = el('tr');
      tr.append(el('td', { class: 'k', text: k }));
      const td = el('td');
      td.append(valueNode(next[k]));
      tr.append(td);
      table.append(tr);
    }
  }
  for (const c of changes) if (c.kind === 'removed') table.append(changeRow(c.path, c));
  if (!table.children.length) table.append(el('tr', null, [el('td', { class: 'v nil', text: 'no props' })]));
  return el('div', { class: 'section' }, [el('h3', { text: title }), table]);
}

function sourceLabel(src: SourceLocation): string {
  const file = src.fileName.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
  return `${file}${src.lineNumber ? ':' + src.lineNumber : ''}`;
}

export interface ReportViewActions {
  openSource?: ((src: SourceLocation) => void) | null;
  highlight?: ((id: number) => void) | null;
  copy?: ((text: string) => void) | null;
  /** Source text of a module, for the context box under the actions. */
  readSource?: ((url: string) => Promise<string | null>) | null;
  compact?: boolean;
}

function reportView(r: Report, actions: ReportViewActions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  const duration =
    typeof r.selfDuration === 'number'
      ? ` · ${fmtMs(r.selfDuration)} self${typeof r.treeDuration === 'number' && r.treeDuration > r.selfDuration ? `, ${fmtMs(r.treeDuration)} with children` : ''}`
      : '';
  const head = el('div', { class: 'section' }, [
    el('h3', { text: 'Why did this render?' }),
    el('div', null, [
      el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'Avoidable re-render' : `Re-render (${r.trigger})` }),
      el('span', { class: 'meta', text: `  #${r.renderCount} · ${summarize(r)}${duration}` }),
    ]),
    el('ul', { class: 'reasons' }, (r.reasons || []).map((x) => el('li', { text: x }))),
  ]);
  if (!actions.compact) {
    const bar = el('div', { class: 'actions' });
    const src = r.source;
    if (src && actions.openSource) {
      const open = actions.openSource;
      bar.append(el('button', { title: src.fileName, onclick: () => open(src) }, `↗ ${sourceLabel(src)}`));
    } else if (src) bar.append(el('span', { class: 'meta', title: src.fileName, text: sourceLabel(src) }));
    if (actions.highlight && r.instanceId) {
      const highlight = actions.highlight;
      bar.append(el('button', { onclick: () => highlight(r.instanceId) }, '▣ Highlight'));
    }
    if (actions.copy) {
      const copy = actions.copy;
      bar.append(el('button', { onclick: () => copy(reportToMarkdown(r)) }, '⎘ Copy as Markdown'));
    }
    if (bar.children.length) head.append(bar);
    // Source context: the lines around where the element was created, loaded lazily.
    const loc = r.source;
    if (loc && loc.lineNumber && actions.readSource) {
      const box = el('pre', { class: 'source-context', text: 'loading source…' });
      head.append(box);
      const line = loc.lineNumber;
      void actions
        .readSource(loc.fileName)
        .then((text) => {
          box.textContent = '';
          if (!text) {
            box.textContent = 'source not available';
            return;
          }
          for (const l of sourceContext(text, line)) box.append(el('span', { class: 'line' + (l.hit ? ' hit' : '') }, [el('span', { class: 'ln', text: String(l.n).padStart(4) }), ' ', l.text, '\n']));
        })
        .catch(() => {
          box.textContent = 'source not available';
        });
    }
  }
  frag.append(head);
  const by = el('div', { class: 'section' }, [el('h3', { text: 'Rendered by' })]);
  const crumbs = el('div', { class: 'crumbs' });
  const parts = ([] as string[]).concat(r.path || []);
  parts.forEach((p, i) => {
    if (i) crumbs.append(' › ');
    crumbs.append(p);
  });
  if (parts.length) crumbs.append(' › ');
  crumbs.append(el('b', { text: r.component }));
  by.append(crumbs);
  if (r.parent) by.append(el('div', { text: `Triggered by <${r.parent.name}> (${r.parent.trigger})` }));
  else by.append(el('div', { text: 'Update started in this component' }));
  if (r.owner) by.append(el('div', { class: 'meta', text: `Created by <${r.owner}>` }));
  if (r.memoized === false) by.append(el('div', { class: 'meta', text: 'Not memoized (re-renders whenever its parent does)' }));
  else if (r.memoized === true) by.append(el('div', { class: 'meta', text: 'Memoized (React.memo / PureComponent)' }));
  if (r.updaters && r.updaters.length) by.append(el('div', { text: `Update scheduled by ${r.updaters.map((u) => `<${u}>`).join(', ')}` }));
  if (r.commitCause === 'effect-after-commit') by.append(el('div', { class: 'cause effect', text: `Effect loop: state set right after commit #${r.afterCommit ?? '?'}` }));
  else if (r.commitCause === 'suspense-resolved') by.append(el('div', { class: 'cause suspense', text: 'Suspense boundary resolved in this commit' }));
  if (r.commitId) by.append(el('div', { class: 'meta', text: `Commit #${r.commitId}${r.commitPriority ? ` · ${PRIORITY_LABEL[r.commitPriority] || r.commitPriority} priority` : ''}` }));
  frag.append(by);
  frag.append(kvSection('Props', r.props ? r.props.next : {}, r.propChanges || []));
  const hookChanges = new Map((r.hookChanges || []).map((c) => [c.path, c] as const));
  const stateChanges = r.stateChanges || [];
  if (r.hookState || r.contexts || r.state) {
    // Full snapshot: every hook / context / state key, changed ones as prev → next.
    if (r.hookState && r.hookState.length) {
      const table = el('table', { class: 'kv' });
      for (const h of r.hookState) {
        const c = hookChanges.get(h.path);
        const label = h.custom && h.custom.length ? `${h.custom.join(' › ')} › ${h.path}` : h.path;
        if (c) table.append(changeRow(label, c));
        else {
          const tr = el('tr');
          tr.append(el('td', { class: 'k', text: label }));
          const td = el('td');
          td.append(valueNode(h.value));
          tr.append(td);
          table.append(tr);
        }
      }
      frag.append(el('div', { class: 'section' }, [el('h3', { text: 'Hooks' }), table]));
    }
    if (r.state) frag.append(kvSection('State', r.state, stateChanges));
    if (r.contexts && r.contexts.length) {
      const table = el('table', { class: 'kv' });
      for (const ctx of r.contexts) {
        const c = hookChanges.get(`useContext(${ctx.name})`);
        if (c) table.append(changeRow(ctx.name, c));
        else {
          const tr = el('tr');
          tr.append(el('td', { class: 'k', text: ctx.name }));
          const td = el('td');
          td.append(valueNode(ctx.value));
          tr.append(td);
          table.append(tr);
        }
      }
      frag.append(el('div', { class: 'section' }, [el('h3', { text: 'Contexts' }), table]));
    }
    // store hooks etc. that changed but are not in the snapshot (older library shape)
    const leftover = [...hookChanges.values()].filter((c) => !(r.hookState || []).some((h) => h.path === c.path) && !(r.contexts || []).some((x) => `useContext(${x.name})` === c.path));
    if (leftover.length) {
      const table = el('table', { class: 'kv' });
      for (const c of leftover) table.append(changeRow(c.path, c));
      frag.append(el('div', { class: 'section' }, [el('h3', { text: 'Other hooks that changed' }), table]));
    }
    return frag;
  }
  const hooks = ([] as Change[]).concat(r.hookChanges || [], stateChanges);
  if (hooks.length) {
    const table = el('table', { class: 'kv' });
    for (const c of hooks) table.append(changeRow(c.custom && c.custom.length ? `${c.custom.join(' › ')} › ${c.path}` : c.path, c));
    frag.append(el('div', { class: 'section' }, [el('h3', { text: 'State & hooks that changed' }), table]));
  }
  return frag;
}

function fixView(fixes: (Fix | RankedFix)[], actions: { copy?: (text: string) => void } = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!fixes.length) {
    frag.append(el('div', { class: 'section' }, [el('h3', { text: 'Fix' }), el('div', { class: 'meta', text: 'Nothing to fix: this render was caused by a genuine change.' })]));
    return frag;
  }
  for (const f of fixes) {
    const ranked = 'count' in f ? f : null;
    const sec = el('div', { class: 'section fix' }, [
      el('h3', { text: f.label }),
      el('div', { text: f.detail }),
      ranked ? el('div', { class: 'meta', text: `removes ${plural(ranked.count, 'avoidable re-render')}: ${componentList(ranked.components)}` }) : null,
      el('pre', { class: 'snippet', text: f.snippet }),
    ]);
    if (actions.copy) {
      const copy = actions.copy;
      sec.append(el('button', { onclick: () => copy(f.snippet) }, '⎘ Copy snippet'));
    }
    frag.append(sec);
  }
  return frag;
}

// ---------- virtual list ----------
interface VirtualList<T> {
  container: HTMLElement;
  inner: HTMLElement;
  setItems(items: T[]): void;
  render(): void;
  scrollTo(index: number): void;
  readonly items: T[];
}

/**
 * Fixed-height windowed list: only the rows in view (plus overscan) exist in the DOM.
 * `rowFor(item, index)` returns a positioned element; the same element may be reused between renders.
 */
function virtualList<T>(container: HTMLElement, rowHeight: number, rowFor: (item: T, index: number) => HTMLElement, opts: { attach?: boolean; headerHeight?: () => number } = {}): VirtualList<T> {
  const inner = el('div', { class: 'virtual-inner', role: 'list' });
  if (opts.attach !== false) container.append(inner);
  let items: T[] = [];
  const mounted = new Map<HTMLElement, number>();
  let raf = 0;
  const render = (): void => {
    raf = 0;
    if (!inner.isConnected) return; // another view owns the container right now
    const height = container.clientHeight || FALLBACK_VIEWPORT;
    const top = container.scrollTop - (opts.headerHeight ? opts.headerHeight() : 0);
    const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const end = Math.min(items.length, Math.ceil((top + height) / rowHeight) + OVERSCAN);
    inner.style.height = `${items.length * rowHeight}px`;
    const keep = new Set<HTMLElement>();
    for (let i = start; i < end; i++) {
      const row = rowFor(items[i]!, i);
      row.style.top = `${i * rowHeight}px`;
      if (row.parentNode !== inner) inner.append(row);
      mounted.set(row, i);
      keep.add(row);
    }
    for (const row of [...mounted.keys()]) {
      if (!keep.has(row)) {
        row.remove();
        mounted.delete(row);
      }
    }
  };
  container.addEventListener('scroll', () => {
    if (!raf) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(render) : (setTimeout(render, 0) as unknown as number);
  });
  return {
    container,
    inner,
    get items() {
      return items;
    },
    setItems(next) {
      items = next;
      render();
    },
    render,
    scrollTo(index) {
      const height = container.clientHeight || FALLBACK_VIEWPORT;
      const top = index * rowHeight;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (top + rowHeight > container.scrollTop + height) container.scrollTop = top + rowHeight - height;
      render();
    },
  };
}

// ---------- panel ----------
function createPanel(root: HTMLElement, transport: Transport, options: PanelOptions = {}): Panel {
  const state: PanelState = {
    tree: { name: '', children: new Map(), reports: [], total: 0, avoidable: 0, wasted: 0, expanded: true, path: [], key: '' },
    nodesByKey: new Map(),
    reports: [],
    commits: new Map(),
    commitOrder: [],
    selectedKey: null,
    selectedReport: null,
    selectedCommit: null,
    selectedFix: null,
    selectedRoot: null,
    view: 'tree',
    tab: 'latest',
    paused: false,
    avoidableOnly: false,
    filter: '',
    relay: false,
    library: null,
    polling: false,
    streamCollapsed: false,
    collapsed: new Set(),
    sort: { key: 'avoidable', dir: -1 },
    flashOn: false,
    settingsOpen: false,
    origin: null,
    tabLabel: transport.tabLabel ?? null,
    compact: false,
    sessions: [],
    recording: null,
    selectedSession: null,
    compareWith: null,
    byInstance: false,
  };
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Report[] = [];
  let flushScheduled = false;

  const schedule = typeof requestAnimationFrame === 'function' ? (fn: () => void) => requestAnimationFrame(fn) : (fn: () => void) => setTimeout(fn, 0);
  const copyText = (text: string): void => {
    if (transport.copy) transport.copy(text);
    else if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast('Copied');
  };

  // ---------- DOM skeleton ----------
  root.textContent = '';
  const search = el('input', {
    type: 'search',
    placeholder: 'Search components (text or /regex/)',
    oninput: () => {
      state.filter = search.value;
      renderLeft();
      renderStream();
      persist();
    },
  });
  /** Toolbar button: glyph always visible, label hidden in compact layouts. */
  const iconButton = (glyph: string, label: string, title: string, onclick: () => void, extra: Attrs = {}): HTMLButtonElement =>
    el('button', { class: 'ib', title, onclick, 'aria-label': label, ...extra }, [el('span', { class: 'glyph', text: glyph }), el('span', { class: 'label', text: label })]);
  const pauseBtn = iconButton('⏸', 'Pause', 'Pause / resume (reports keep buffering in the page)', () => {
    state.paused = !state.paused;
    pauseBtn.classList.toggle('active', state.paused);
    pauseBtn.querySelector('.glyph')!.textContent = state.paused ? '▶' : '⏸';
    pauseBtn.querySelector('.label')!.textContent = state.paused ? 'Resume' : 'Pause';
  });
  const clearBtn = iconButton('⊘', 'Clear', 'Clear the panel and the page buffer', () => {
    clearAll();
    transport.clear?.();
    transport.badge?.(0);
  });
  const replayBtn = iconButton('↻', 'Replay', 'Replay buffered reports from the page', () => transport.replay?.());
  const recordBtn = iconButton('⏺', 'Record', 'Record a session to compare before and after a fix', () => {
    if (state.recording) stopRecording();
    else startRecording();
  });
  const exportBtn = iconButton('⤓', 'Export', 'Export reports as JSON', exportJson);
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file' });
  importInput.addEventListener('change', () => {
    const f = importInput.files && importInput.files[0];
    if (f) importFile(f);
    importInput.value = '';
  });
  const importBtn = iconButton('⤒', 'Import', 'Import a JSON export', () => importInput.click());
  const avoidCheck = el('input', {
    type: 'checkbox',
    onchange: () => {
      state.avoidableOnly = avoidCheck.checked;
      renderLeft();
      renderStream();
      persist();
    },
  });
  const settingsBtn = iconButton('⚙', 'Settings', 'Settings', () => toggleSettings());
  const status = el('span', { class: 'status', title: '' }, [el('span', { class: 'dot' }), el('span', { class: 'status-text', text: 'no page' })]);
  const tabChip = el('span', { class: 'tab-chip', hidden: true, title: 'The tab this panel follows' });
  const undock = transport.undock
    ? [
        el('span', { class: 'sep' }),
        iconButton('⫿', 'Side panel', 'Show this panel next to the page (Chrome side panel)', () => void transport.undock!('sidepanel').catch((e: Error) => toast(String(e.message || e)))),
        iconButton('⧉', 'Window', 'Show this panel in its own window', () => void transport.undock!('window').catch((e: Error) => toast(String(e.message || e)))),
      ]
    : [];
  const toolbar = el('div', { class: 'toolbar' }, [
    search,
    el('span', { class: 'sep' }),
    pauseBtn,
    clearBtn,
    replayBtn,
    recordBtn,
    el('span', { class: 'sep' }),
    exportBtn,
    importBtn,
    importInput,
    el('span', { class: 'sep' }),
    el('label', { class: 'check' }, [avoidCheck, el('span', { class: 'label', text: 'Avoidable only' })]),
    ...undock,
    el('span', { class: 'spacer' }),
    tabChip,
    status,
    settingsBtn,
  ]);
  const summary = el('div', { class: 'summary' });
  const banner = el('div', { class: 'banner', hidden: true });
  const viewsBar = el('div', { class: 'views' });
  const VIEWS: [View, string][] = [
    ['tree', 'Tree'],
    ['offenders', 'Offenders'],
    ['commits', 'Commits'],
    ['fixes', 'Fixes'],
    ['sessions', 'Sessions'],
  ];
  const viewButtons = new Map<View, HTMLButtonElement>();
  for (const [id, label] of VIEWS) {
    const b = el('button', { 'data-view': id, onclick: () => setView(id) }, label);
    viewButtons.set(id, b);
    viewsBar.append(b);
  }
  const instancesBtn = el(
    'button',
    {
      class: 'instances',
      title: 'Group the tree by instance (key or id) instead of by component name',
      onclick: () => {
        state.byInstance = !state.byInstance;
        instancesBtn.classList.toggle('active', state.byInstance);
        rebuildTree();
        persist();
      },
    },
    '⁝ Instances',
  );
  viewsBar.append(el('span', { class: 'spacer' }), instancesBtn);
  const tree = el('div', { class: 'tree', tabindex: '0', onkeydown: onTreeKey, role: 'tree' });
  const table = el('div', { class: 'table-wrap', hidden: true });
  const left = el('div', { class: 'left' }, [viewsBar, tree, table]);
  const resizer = el('div', { class: 'resizer', title: 'Drag to resize' });
  const details = el('div', { class: 'details' });
  const settings = el('div', { class: 'drawer', hidden: true });
  const main = el('div', { class: 'main' }, [left, resizer, details, settings]);
  const streamList = el('div', { class: 'stream-list' });
  const streamCount = el('span', { class: 'count', text: '0 reports' });
  const stream = el('div', { class: 'stream' }, [
    el(
      'div',
      {
        class: 'stream-header',
        onclick: () => {
          state.streamCollapsed = !state.streamCollapsed;
          stream.classList.toggle('collapsed', state.streamCollapsed);
          persist();
        },
      },
      [el('span', { text: '▾ Live stream' }), streamCount],
    ),
    streamList,
  ]);
  const toastEl = el('div', { class: 'toast', hidden: true, role: 'status', 'aria-live': 'polite' });
  root.classList.add('rl');
  search.setAttribute('aria-label', 'Search components; prefix with ~ to search values');
  search.placeholder = 'Search components (text, /regex/, ~value)';
  streamList.setAttribute('aria-label', 'Live stream of reports');
  details.setAttribute('role', 'region');
  details.setAttribute('aria-label', 'Details');
  settings.setAttribute('role', 'dialog');
  settings.setAttribute('aria-label', 'Settings');
  root.append(toolbar, summary, banner, main, stream, toastEl);
  root.addEventListener('keydown', onGlobalKey);

  // Narrow hosts (the side panel) stack the tree above the details and hide button labels.
  function setCompact(on: boolean): void {
    if (state.compact === on) return;
    state.compact = on;
    root.classList.toggle('compact', on);
    treeList.render();
    streamItems.render();
  }
  const measure = (): void => setCompact(root.clientWidth > 0 && root.clientWidth < 720);
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(root);
  else window.addEventListener('resize', measure);

  // Summary counters, maintained in `ingest` / `evict` so the strip never rescans the buffer.
  const totals = { avoidable: 0, wasted: 0, perComponent: new Map<string, number>() };
  let bestFix: RankedFix | undefined;
  let bestFixAt = 0;
  let bestFixGen = -1; // `dataGen` the ranking was computed for
  let bestFixTimer: ReturnType<typeof setTimeout> | null = null;
  const throttled = (): boolean => state.reports.length >= THROTTLE_MIN_REPORTS;

  /** The "best fix" stat: `rankFixes` over the whole buffer, at most every 500 ms while a large buffer is streaming. */
  function refreshBestFix(): void {
    if (!totals.avoidable) {
      bestFix = undefined;
      bestFixGen = dataGen;
      return;
    }
    if (bestFixGen === dataGen) return; // nothing changed since the last ranking
    const now = Date.now();
    if (throttled() && now - bestFixAt < BEST_FIX_INTERVAL) {
      if (!bestFixTimer) {
        bestFixTimer = setTimeout(() => {
          bestFixTimer = null;
          renderSummary();
        }, BEST_FIX_INTERVAL - (now - bestFixAt));
      }
      return;
    }
    bestFixAt = now;
    bestFixGen = dataGen;
    bestFix = rankFixes(state.reports)[0];
  }

  function renderSummary(): void {
    summary.textContent = '';
    const total = state.reports.length;
    if (!total) {
      summary.hidden = true;
      return;
    }
    summary.hidden = false;
    const { avoidable, wasted } = totals;
    let top: [string, number] | undefined;
    for (const entry of totals.perComponent) if (!top || entry[1] > top[1]) top = entry;
    refreshBestFix();
    const fix = bestFix;
    const stat = (value: string, label: string, cls = ''): HTMLElement => el('span', { class: 'stat ' + cls }, [el('b', { text: value }), el('span', { class: 'label', text: label })]);
    summary.append(stat(String(total), plural(total, 'render').replace(/^\d+ /, '')), stat(String(avoidable), 'avoidable', avoidable ? 'bad' : 'good'));
    if (wasted) summary.append(stat(fmtMs(wasted), 'wasted', 'bad'));
    if (top) {
      summary.append(
        el('button', { class: 'stat link', title: 'Select the component with the most avoidable re-renders', onclick: () => panelApi.select(top[0]) }, [
          el('span', { class: 'label', text: 'top' }),
          el('b', { class: 'mono', text: `<${top[0]}>` }),
          el('span', { class: 'label', text: `×${top[1]}` }),
        ]),
      );
    }
    if (fix) {
      summary.append(
        el(
          'button',
          {
            class: 'stat link',
            title: 'Open the Fixes view',
            onclick: () => {
              state.selectedFix = fix.key;
              state.tab = 'fixlist';
              setView('fixes');
            },
          },
          [el('span', { class: 'label', text: 'best fix' }), el('b', { class: 'mono', text: fix.label }), el('span', { class: 'label', text: `−${fix.count}` })],
        ),
      );
    }
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 1200);
  }

  // resizer
  let drag: { x: number; w: number } | null = null;
  resizer.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, w: left.getBoundingClientRect().width };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const w = Math.max(180, Math.min(drag.w + e.clientX - drag.x, root.clientWidth - 240));
    left.style.width = w + 'px';
    state.treeWidth = w;
  });
  window.addEventListener('mouseup', () => {
    if (drag) persist();
    drag = null;
  });

  // ---------- persistence (per origin) ----------
  function persist(): void {
    if (!transport.storage) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const saved: PersistedState = {
        filter: state.filter,
        avoidableOnly: state.avoidableOnly,
        view: state.view,
        tab: state.tab === 'history' || state.tab === 'fix' ? state.tab : 'latest',
        streamCollapsed: state.streamCollapsed,
        collapsed: [...state.collapsed],
        treeWidth: state.treeWidth,
        flashOn: state.flashOn,
        byInstance: state.byInstance,
      };
      transport.storage!.set('panel', saved);
    }, 150);
  }

  /** Session summaries from storage or an export (no reports); merged by id. */
  function restoreSessions(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const s of raw) {
      if (!isRecord(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || !isRecord(s.byComponent)) continue;
      if (state.sessions.some((x) => x.id === s.id)) continue;
      state.sessions.push({
        id: s.id,
        name: s.name,
        startedAt: typeof s.startedAt === 'number' ? s.startedAt : 0,
        endedAt: typeof s.endedAt === 'number' ? s.endedAt : 0,
        total: typeof s.total === 'number' ? s.total : 0,
        avoidable: typeof s.avoidable === 'number' ? s.avoidable : 0,
        wasted: typeof s.wasted === 'number' ? s.wasted : 0,
        byComponent: s.byComponent as SessionSummary['byComponent'],
        fixes: Array.isArray(s.fixes) ? (s.fixes as SessionSummary['fixes']) : [],
        reports: [],
      });
    }
    state.sessions.sort((a, b) => a.startedAt - b.startedAt);
    if (state.view === 'sessions') renderLeft();
  }

  function restore(raw: unknown): void {
    if (!isRecord(raw)) return;
    const saved = raw as PersistedState;
    if (typeof saved.filter === 'string') {
      state.filter = saved.filter;
      search.value = saved.filter;
    }
    if (typeof saved.avoidableOnly === 'boolean') {
      state.avoidableOnly = saved.avoidableOnly;
      avoidCheck.checked = saved.avoidableOnly;
    }
    if (Array.isArray(saved.collapsed)) state.collapsed = new Set(saved.collapsed.filter((x): x is string => typeof x === 'string'));
    if (typeof saved.streamCollapsed === 'boolean') {
      state.streamCollapsed = saved.streamCollapsed;
      stream.classList.toggle('collapsed', state.streamCollapsed);
    }
    if (typeof saved.treeWidth === 'number' && saved.treeWidth > 100) {
      state.treeWidth = saved.treeWidth;
      left.style.width = saved.treeWidth + 'px';
    }
    if (typeof saved.flashOn === 'boolean') state.flashOn = saved.flashOn;
    if (typeof saved.byInstance === 'boolean' && saved.byInstance !== state.byInstance) {
      state.byInstance = saved.byInstance;
      instancesBtn.classList.toggle('active', state.byInstance);
      rebuildTree();
    }
    if (saved.tab === 'history' || saved.tab === 'fix') state.tab = saved.tab;
    if (saved.view && viewButtons.has(saved.view)) state.view = saved.view;
    for (const n of state.nodesByKey.values()) n.expanded = !state.collapsed.has(n.key);
    setView(state.view);
    renderStream();
  }

  // ---------- model ----------
  const keyOf = (path: string[]): string => path.join(' ');

  function nodeFor(path: string[]): TreeNode {
    const key = keyOf(path);
    const found = state.nodesByKey.get(key);
    if (found) return found;
    let parent = state.tree;
    for (let i = 0; i < path.length; i++) {
      const name = path[i]!;
      const k = keyOf(path.slice(0, i + 1));
      let n = state.nodesByKey.get(k);
      if (!n) {
        n = { name, children: new Map(), reports: [], total: 0, avoidable: 0, wasted: 0, expanded: !state.collapsed.has(k), path: path.slice(0, i + 1), key: k };
        state.nodesByKey.set(k, n);
        parent.children.set(name, n);
      }
      parent = n;
    }
    return parent;
  }

  /** Tree placement: by component name, or per instance (`<Row key="a">`, `<Row #12>`) when `byInstance` is on. */
  const instanceLabel = (r: Report): string => (r.key ? `${r.component} key=${JSON.stringify(r.key)}` : `${r.component} #${r.instanceId}`);
  const nodeOfReport = (r: Report): TreeNode => nodeFor(r.path.concat([state.byInstance ? instanceLabel(r) : r.component]));

  /** Rebuild the tree from the buffered reports (after switching grouping). */
  function rebuildTree(): void {
    state.tree.children.clear();
    state.nodesByKey.clear();
    rowEls.clear();
    state.selectedKey = null;
    for (const r of state.reports) {
      const node = nodeOfReport(r);
      node.reports.push(r);
      node.total++;
      if (r.avoidable) {
        node.avoidable++;
        if (typeof r.selfDuration === 'number') node.wasted += r.selfDuration;
      }
      node.lastReport = r;
    }
    for (const node of state.nodesByKey.values()) trimNode(node);
    renderLeft();
    renderDetails();
  }

  /** Keep the newest MAX_PER_NODE reports of a node (one splice per flush instead of a shift per report). */
  function trimNode(node: TreeNode): void {
    const excess = node.reports.length - MAX_PER_NODE;
    if (excess > 0) node.reports.splice(0, excess);
  }

  // Per-commit analysis, reused while the commit's report count is unchanged.
  const commitAnalyses = new Map<number, { len: number; analysis: CommitAnalysis }>();
  function analysisFor(key: number, reports: Report[]): CommitAnalysis {
    const cached = commitAnalyses.get(key);
    if (cached && cached.len === reports.length) return cached.analysis;
    const analysis = analyzeCommit(reports);
    commitAnalyses.set(key, { len: reports.length, analysis });
    return analysis;
  }
  const commitMember = new WeakSet<Report>(); // reports kept in their commit's list (the first MAX_PER_COMMIT of it)

  function forgetCommit(key: number): void {
    state.commits.delete(key);
    commitAnalyses.delete(key);
  }

  function ingest(report: Report): TreeNode {
    if (!report.receivedAt) report.receivedAt = Date.now();
    state.reports.push(report);
    const node = nodeOfReport(report);
    node.reports.push(report);
    node.total++;
    if (report.avoidable) {
      node.avoidable++;
      totals.avoidable++;
      totals.perComponent.set(report.component, (totals.perComponent.get(report.component) || 0) + 1);
      if (typeof report.selfDuration === 'number') {
        node.wasted += report.selfDuration;
        totals.wasted += report.selfDuration;
      }
    }
    node.lastReport = report;
    node.flash = true;
    node.flashAt = Date.now();
    const ck = report.commitId;
    let list = state.commits.get(ck);
    if (!list) {
      list = [];
      state.commits.set(ck, list);
      state.commitOrder.push(ck);
      if (state.commitOrder.length > MAX_COMMITS) forgetCommit(state.commitOrder.shift()!);
    }
    if (list.length < MAX_PER_COMMIT) {
      list.push(report);
      commitMember.add(report);
    }
    return node;
  }

  /** Drop the oldest reports beyond MAX_REPORTS: counters, commit lists and (when emptied) the commit itself follow. */
  function evict(): void {
    const excess = state.reports.length - MAX_REPORTS;
    if (excess <= 0) return;
    for (const r of state.reports.splice(0, excess)) {
      if (r.avoidable) {
        totals.avoidable--;
        const n = (totals.perComponent.get(r.component) || 0) - 1;
        if (n > 0) totals.perComponent.set(r.component, n);
        else totals.perComponent.delete(r.component);
        if (typeof r.selfDuration === 'number') totals.wasted -= r.selfDuration;
      }
      if (!commitMember.has(r)) continue;
      // Both lists are in arrival order, so an evicted member is at the front of its commit.
      const list = state.commits.get(r.commitId);
      if (!list || list[0] !== r) continue;
      list.shift();
      if (!list.length) {
        forgetCommit(r.commitId);
        const i = state.commitOrder.indexOf(r.commitId);
        if (i >= 0) state.commitOrder.splice(i, 1);
      }
    }
    if (totals.wasted < 0) totals.wasted = 0; // float drift
  }

  /** Drain the queue: one tree render per batch. */
  function flush(): void {
    flushScheduled = false;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    let touchedSelected = false;
    let avoidableCount = 0;
    const touched = new Set<TreeNode>();
    for (const r of batch) {
      const node = ingest(r);
      touched.add(node);
      if (state.recording && state.recording.reports.length < MAX_REPORTS) state.recording.reports.push(r);
      if (r.avoidable) avoidableCount++;
      if (state.selectedKey === node.key) {
        touchedSelected = true;
        if (state.tab === 'latest') state.selectedReport = r;
      }
    }
    for (const node of touched) trimNode(node);
    evict();
    dataGen++;
    renderStream(batch);
    renderSummary();
    // The tree is incremental and cheap; the other views and the analysis-backed details rebuild from scratch, so they are throttled on large buffers.
    const heavy = state.view === 'commits' || state.view === 'fixes' || state.tab === 'root' || !!(state.recording && state.tab === 'session');
    if (state.view === 'tree') {
      renderTree();
      if (touchedSelected && !heavy) renderDetails();
    }
    scheduleHeavy(heavy || (touchedSelected && state.view !== 'tree'));
    if (state.polling && avoidableCount) transport.badge?.(totals.avoidable);
  }

  let heavyAt = 0;
  let heavyTimer: ReturnType<typeof setTimeout> | null = null;
  let heavyDetailsPending = false;
  function renderHeavy(details: boolean): void {
    heavyAt = Date.now();
    if (state.view !== 'tree') renderLeft();
    if (details) renderDetails();
  }
  /** Rebuild the non-tree left pane (and the details when asked) now, or within LEFT_RENDER_INTERVAL while a large buffer streams. */
  function scheduleHeavy(details: boolean): void {
    const wait = throttled() ? LEFT_RENDER_INTERVAL - (Date.now() - heavyAt) : 0;
    if (wait <= 0) {
      if (heavyTimer) clearTimeout(heavyTimer);
      heavyTimer = null;
      heavyDetailsPending = false;
      renderHeavy(details);
      return;
    }
    heavyDetailsPending = heavyDetailsPending || details;
    if (!heavyTimer) {
      heavyTimer = setTimeout(() => {
        heavyTimer = null;
        const d = heavyDetailsPending;
        heavyDetailsPending = false;
        renderHeavy(d);
      }, wait);
    }
  }

  function enqueue(report: Report): void {
    queue.push(report);
    if (!flushScheduled) {
      flushScheduled = true;
      schedule(flush);
    }
  }

  function clearAll(): void {
    state.tree.children.clear();
    state.nodesByKey.clear();
    state.reports = [];
    state.commits.clear();
    state.commitOrder = [];
    commitAnalyses.clear();
    totals.avoidable = 0;
    totals.wasted = 0;
    totals.perComponent.clear();
    bestFix = undefined;
    bestFixAt = 0;
    dataGen++;
    state.selectedKey = null;
    state.selectedReport = null;
    state.selectedCommit = null;
    state.selectedFix = null;
    state.selectedRoot = null;
    if (state.tab === 'commit' || state.tab === 'fixlist' || state.tab === 'root') state.tab = 'latest';
    queue = [];
    renderLeft();
    renderDetails();
    renderStream();
    renderSummary();
  }

  // The parsed filter, recomputed only when `state.filter` changes (`matchesFilter` runs once per tree node and report).
  let filterCache: { filter: string; value: string | null; regex: RegExp | null; text: string } = { filter: '', value: null, regex: null, text: '' };
  function parsedFilter(): typeof filterCache {
    if (filterCache.filter === state.filter) return filterCache;
    const f = state.filter.trim();
    const value = f.startsWith('~') ? f.slice(1).toLowerCase() : null;
    let regex: RegExp | null = null;
    const m = value === null ? /^\/(.+)\/([a-z]*)$/.exec(f) : null;
    if (m && m[1] !== undefined) {
      try {
        regex = new RegExp(m[1], (m[2] || '').replace(/[gy]/g, '')); // a cached global/sticky regex would carry `lastIndex` between tests
      } catch {
        /* invalid regex: fall through to text */
      }
    }
    filterCache = { filter: state.filter, value, regex, text: f.toLowerCase() };
    return filterCache;
  }

  /** `~text` searches prop, hook and context values instead of component names. */
  const valueQuery = (): string | null => parsedFilter().value;

  function matchesFilter(name: string): boolean {
    const f = parsedFilter();
    if (!f.filter || f.value !== null) return true;
    if (f.regex) return f.regex.test(name);
    return name.toLowerCase().includes(f.text);
  }

  const valueCache = new WeakMap<Report, string>();
  function matchesValues(r: Report): boolean {
    const q = valueQuery();
    if (q === null) return true;
    if (!q) return true;
    let text = valueCache.get(r);
    if (text === undefined) {
      try {
        text = JSON.stringify({ p: r.props.next, h: (r.hookState || []).map((x) => x.value), c: (r.contexts || []).map((x) => x.value), s: r.state ?? null }).toLowerCase();
      } catch {
        text = '';
      }
      valueCache.set(r, text);
    }
    return text.includes(q);
  }

  /** A node is shown if it or any descendant matches the filter (and has avoidable reports when that filter is on). */
  function visible(node: TreeNode): boolean {
    const own = (!state.avoidableOnly || node.avoidable > 0) && matchesFilter(node.name) && node.total > 0 && (valueQuery() === null || node.reports.some(matchesValues));
    if (own) return true;
    for (const c of node.children.values()) if (visible(c)) return true;
    return false;
  }

  const passes = (r: Report): boolean => (!state.avoidableOnly || r.avoidable) && matchesFilter(r.component) && matchesValues(r);

  // The filtered buffer and its ranked fixes, shared by every render of one flush (or of one user action) that needs them.
  let dataGen = 0; // bumped whenever `state.reports` changes
  let filtered: { key: string; reports: Report[]; fixes: RankedFix[] | null } = { key: '', reports: [], fixes: null };
  function filteredReports(): Report[] {
    const key = `${dataGen}|${state.avoidableOnly}|${state.filter}`;
    if (filtered.key !== key) filtered = { key, reports: state.reports.filter(passes), fixes: null };
    return filtered.reports;
  }
  function filteredFixes(): RankedFix[] {
    const reports = filteredReports();
    if (!filtered.fixes) filtered.fixes = rankFixes(reports);
    return filtered.fixes;
  }

  // ---------- left pane ----------
  function setView(view: View): void {
    state.view = view;
    for (const [id, b] of viewButtons) b.classList.toggle('active', id === view);
    tree.hidden = view !== 'tree';
    table.hidden = view === 'tree';
    renderLeft();
    renderDetails();
    persist();
  }

  function renderLeft(): void {
    if (state.view === 'tree') renderTree();
    else if (state.view === 'offenders') renderOffenders();
    else if (state.view === 'commits') renderCommits();
    else if (state.view === 'sessions') renderSessions();
    else renderFixes();
  }

  // ---------- tree (virtualized) ----------
  interface FlatRow {
    node: TreeNode;
    depth: number;
  }
  const rowEls = new Map<string, HTMLElement>();
  const treeList = virtualList<FlatRow>(tree, ROW_H, ({ node, depth }) => rowFor(node, depth));
  const emptyEl = el('div', { class: 'empty' }, [
    el('div', { text: 'No re-renders reported yet.' }),
    el('div', null, ['Call ', el('code', { text: 'init({ notifier: createDevtoolsNotifier() })' }), ' in the page, or enable injection in Settings, then interact with it.']),
  ]);

  function renderTree(): void {
    const flat: FlatRow[] = [];
    const walk = (node: TreeNode, depth: number): void => {
      for (const child of node.children.values()) {
        if (!visible(child)) continue;
        flat.push({ node: child, depth });
        if (child.expanded) walk(child, depth + 1);
      }
    };
    walk(state.tree, 0);
    if (flat.length === 0) {
      if (!emptyEl.parentNode) tree.append(emptyEl);
    } else emptyEl.remove();
    // drop cached rows for nodes that are gone
    if (rowEls.size > flat.length * 2 + 64) {
      const live = new Set(flat.map((f) => f.node.key));
      for (const key of [...rowEls.keys()]) if (!live.has(key)) rowEls.delete(key);
    }
    treeList.setItems(flat);
  }

  function hoverHighlight(node: TreeNode, on: boolean): void {
    const r = node.lastReport;
    if (!r || !r.instanceId) return;
    transport.highlight?.(on ? r.instanceId : null);
  }

  function rowFor(node: TreeNode, depth: number): HTMLElement {
    let row = rowEls.get(node.key);
    if (!row) {
      const created = el('div', {
        class: 'row',
        'data-key': node.key,
        role: 'treeitem',
        onclick: () => select(node),
        onmouseenter: () => hoverHighlight(node, true),
        onmouseleave: () => hoverHighlight(node, false),
        onanimationend: () => created.classList.remove('flash'),
      });
      created.append(el('span', { class: 'indent' }));
      created.append(
        el('span', {
          class: 'chevron',
          onclick: (e: Event) => {
            e.stopPropagation();
            toggleExpanded(node);
          },
        }),
      );
      created.append(
        el('span', { class: 'tag' }, [el('span', { class: 'bracket', text: '<' }), el('span', { class: 'name', text: node.name }), el('span', { class: 'bracket', text: '>' })]),
      );
      created.append(el('span', { class: 'badges' }));
      rowEls.set(node.key, created);
      row = created;
    }
    row.classList.toggle('selected', state.selectedKey === node.key);
    row.setAttribute('aria-selected', state.selectedKey === node.key ? 'true' : 'false');
    row.setAttribute('aria-level', String(depth + 1));
    const indent = row.querySelector('.indent') as HTMLElement;
    if (indent.childElementCount !== depth) {
      indent.textContent = '';
      for (let i = 0; i < depth; i++) indent.append(el('span', { class: 'guide' }));
    }
    const hasChildren = [...node.children.values()].some(visible);
    const chevron = row.querySelector('.chevron') as HTMLElement;
    chevron.classList.toggle('leaf', !hasChildren);
    chevron.textContent = node.expanded ? '▾' : '▸';
    const badges = row.querySelector('.badges') as HTMLElement;
    badges.textContent = '';
    if (node.avoidable) badges.append(el('span', { class: 'badge avoid', title: 'avoidable re-renders', text: String(node.avoidable) }));
    if (node.total) badges.append(el('span', { class: 'badge', title: 're-renders', text: String(node.total) }));
    if (node.flash) {
      node.flash = false;
      // Rows scrolled into view long after the report arrived should not flash.
      if (Date.now() - (node.flashAt || 0) < 1000) {
        row.classList.remove('flash');
        void row.offsetWidth; // restart the animation
        row.classList.add('flash');
      }
    }
    return row;
  }

  function toggleExpanded(node: TreeNode, value?: boolean): void {
    node.expanded = value === undefined ? !node.expanded : value;
    if (node.expanded) state.collapsed.delete(node.key);
    else state.collapsed.add(node.key);
    renderTree();
    persist();
  }

  function select(node: TreeNode, report?: Report): void {
    state.selectedKey = node.key;
    state.selectedReport = report || node.lastReport || null;
    // Picking a specific report shows it, unless the caller asked for the Fix tab.
    if (report && state.tab !== 'fix') state.tab = 'latest';
    if (state.tab === 'commit' || state.tab === 'fixlist' || state.tab === 'root') state.tab = 'latest';
    renderLeft();
    renderDetails();
    if (state.view === 'tree') {
      const idx = treeList.items.findIndex((f) => f.node.key === node.key);
      if (idx >= 0) treeList.scrollTo(idx);
    }
  }

  function onTreeKey(e: KeyboardEvent): void {
    const rows = treeList.items;
    if (!rows.length) return;
    const idx = rows.findIndex((f) => f.node.key === state.selectedKey);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(rows[Math.min(rows.length - 1, idx + 1)]!.node);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(rows[Math.max(0, idx - 1)]!.node);
    } else if (e.key === 'ArrowRight' && idx >= 0) {
      toggleExpanded(rows[idx]!.node, true);
    } else if (e.key === 'ArrowLeft' && idx >= 0) {
      toggleExpanded(rows[idx]!.node, false);
    }
  }

  /** Panel-wide shortcuts: `/` search, `f` fix tab, `Esc` clear highlight / leave the search box. */
  function onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (e.key === 'Escape') {
      transport.highlight?.(null);
      if (state.settingsOpen && settings.contains(target)) {
        toggleSettings(false);
        return;
      }
      if (inField) target!.blur();
      return;
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === 'f' && state.selectedKey) {
      e.preventDefault();
      state.tab = 'fix';
      renderDetails();
      persist();
    }
  }

  // ---------- offenders ----------
  function sortableHeader(label: string, key: OffenderKey, numeric = false): HTMLElement {
    const active = state.sort.key === key;
    return el(
      'th',
      {
        class: (active ? 'sorted ' : '') + (numeric ? 'num' : ''),
        onclick: () => {
          state.sort = { key, dir: active ? ((-state.sort.dir) as 1 | -1) : numeric ? -1 : 1 };
          renderLeft();
        },
      },
      label + (active ? (state.sort.dir < 0 ? ' ▾' : ' ▴') : ''),
    );
  }

  function offenderRows(): Offender[] {
    const byName = new Map<string, Offender>();
    for (const r of filteredReports()) {
      let o = byName.get(r.component);
      if (!o) {
        o = { component: r.component, total: 0, avoidable: 0, wasted: 0, paths: new Set(), reports: [], fix: '' };
        byName.set(r.component, o);
      }
      o.total++;
      if (r.avoidable) {
        o.avoidable++;
        if (typeof r.selfDuration === 'number') o.wasted += r.selfDuration;
      }
      o.paths.add(keyOf(r.path));
      o.reports.push(r);
    }
    const rows = [...byName.values()];
    for (const o of rows) {
      const fixes = o.avoidable ? rankFixes(o.reports) : [];
      o.fix = fixes.length ? fixes[0]!.label : '';
    }
    const { key, dir } = state.sort;
    rows.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return c * dir || b.avoidable - a.avoidable;
    });
    return rows;
  }

  function offenderRow(o: Offender): HTMLElement {
    return el(
      'tr',
      {
        class: o.avoidable ? 'has-avoid' : '',
        onclick: () => {
          const last = o.reports[o.reports.length - 1]!;
          state.tab = 'fix';
          select(nodeOfReport(last), last);
        },
      },
      [
        el('td', { class: 'c' }, [el('span', { class: 'name', text: o.component }), o.paths.size > 1 ? el('span', { class: 'meta', text: ` ×${o.paths.size} places` }) : null]),
        el('td', { class: 'num' }, o.avoidable ? el('span', { class: 'badge avoid', text: String(o.avoidable) }) : '0'),
        el('td', { class: 'num', text: String(o.total) }),
        el('td', { class: 'num', text: o.wasted ? fmtMs(o.wasted) : '' }),
        el('td', { class: 'fix', text: o.fix }),
      ],
    );
  }

  function renderOffenders(): void {
    table.textContent = '';
    const rows = offenderRows();
    if (!rows.length) {
      table.append(el('div', { class: 'empty', text: 'No re-renders reported yet.' }));
      return;
    }
    const t = el('table', { class: 'grid' });
    t.append(el('thead', null, el('tr', null, [sortableHeader('Component', 'component'), sortableHeader('Avoidable', 'avoidable', true), sortableHeader('Total', 'total', true), sortableHeader('Wasted', 'wasted', true), el('th', { text: 'Top fix' })])));
    const body = el('tbody');
    for (const o of rows) body.append(offenderRow(o));
    t.append(body);
    table.append(t);
  }

  // ---------- commits ----------
  function commitSummaries(): { key: number; analysis: CommitAnalysis }[] {
    const out: { key: number; analysis: CommitAnalysis }[] = [];
    for (let i = state.commitOrder.length - 1; i >= 0; i--) {
      const key = state.commitOrder[i]!;
      const reports = state.commits.get(key);
      if (!reports || !reports.some(passes)) continue;
      out.push({ key, analysis: analysisFor(key, reports) });
    }
    return out;
  }

  function showCommit(key: number): void {
    state.selectedCommit = key;
    state.tab = 'commit';
    renderLeft();
    renderDetails();
  }

  function showRoot(name: string): void {
    state.selectedRoot = name;
    state.tab = 'root';
    renderDetails();
  }

  function renderCommits(): void {
    table.textContent = '';
    const items = commitSummaries();
    if (!items.length) {
      table.append(el('div', { class: 'empty', text: 'No commits yet.' }));
      return;
    }
    const list = el('ul', { class: 'commits' });
    for (const { key, analysis } of items) {
      const root = analysis.roots[0];
      list.append(
        el('li', { class: (state.selectedCommit === key && state.tab === 'commit' ? 'selected ' : '') + (analysis.avoidable ? 'has-avoid' : ''), onclick: () => showCommit(key) }, [
          el('span', { class: 'id', text: `#${key}` }),
          el('span', { class: 't', text: fmtTime(analysis.receivedAt) }),
          el('span', { class: 'n', text: plural(analysis.total, 'render') }),
          analysis.avoidable ? el('span', { class: 'badge avoid', text: `${analysis.avoidable} avoidable` }) : el('span', { class: 'badge', text: 'ok' }),
          analysis.reports[0]?.commitPriority ? el('span', { class: 'prio ' + analysis.reports[0].commitPriority, title: 'commit priority', text: PRIORITY_LABEL[analysis.reports[0].commitPriority] || analysis.reports[0].commitPriority }) : null,
          analysis.reports[0]?.commitCause === 'effect-after-commit'
            ? el('span', { class: 'cause effect', title: 'state set right after the previous commit (effect → setState)', text: `effect loop ← #${analysis.reports[0].afterCommit ?? '?'}` })
            : analysis.reports[0]?.commitCause === 'suspense-resolved'
              ? el('span', { class: 'cause suspense', text: 'suspense resolved' })
              : null,
          el('span', {
            class: 'root',
            text: root ? `← <${root.name}> (${root.trigger})` : analysis.reports[0]?.updaters?.length ? `← set by ${analysis.reports[0].updaters.map((u) => `<${u}>`).join(', ')}` : '',
          }),
        ]),
      );
    }
    table.append(list);
  }

  // ---------- fixes ----------
  function fixItem(f: RankedFix): HTMLElement {
    const selected = state.selectedFix === f.key && state.tab === 'fixlist';
    return el(
      'li',
      {
        class: selected ? 'selected' : '',
        'aria-selected': selected ? 'true' : null,
        onclick: () => {
          state.selectedFix = f.key;
          state.tab = 'fixlist';
          renderLeft();
          renderDetails();
        },
      },
      [
        el('span', { class: 'badge avoid', title: 'avoidable re-renders removed', text: String(f.count) }),
        el('span', { class: 'label', text: f.label }),
        el('span', { class: 'meta', text: componentList(f.components) }),
      ],
    );
  }

  function renderFixes(): void {
    table.textContent = '';
    const reports = filteredReports();
    const fixes = filteredFixes();
    const contexts = contextAttribution(reports);
    if (!fixes.length && !contexts.length) {
      table.append(el('div', { class: 'empty', text: 'No avoidable re-renders, nothing to fix.' }));
      return;
    }
    if (fixes.length) {
      const list = el('ol', { class: 'fixes', role: 'list' });
      for (const f of fixes) list.append(fixItem(f));
      table.append(el('div', { class: 'section-title', text: 'Ranked by avoidable re-renders removed' }), list);
    }
    if (contexts.length) {
      const list = el('ul', { class: 'contexts' });
      for (const c of contexts) {
        const partial = c.changedKeys.size > 0 && c.totalKeys > c.changedKeys.size;
        list.append(
          el('li', null, [
            el('span', { class: 'name', text: c.name }),
            c.providers.size ? el('span', { class: 'meta', text: ` (provided by ${componentList(c.providers)})` }) : null,
            el('span', {
              class: 'meta',
              text: ` changed in ${plural(c.commits.size, 'commit')}, ${plural(c.consumers, 'consumer re-render')}${c.avoidable ? `, ${c.avoidable} with an equal value` : ''}: ${componentList(c.components)}`,
            }),
            partial ? el('div', { class: 'meta hint', text: `only ${[...c.changedKeys].join(', ')} of ${c.totalKeys} keys changed: consumers of the other keys re-render for nothing. Split the context or select slices.` }) : null,
          ]),
        );
      }
      table.append(el('div', { class: 'section-title', text: 'Contexts' }), list);
    }
  }

  // ---------- details ----------
  function renderDetails(): void {
    const openLabels = new Set([...details.querySelectorAll('details.obj[open] > summary')].map((x) => x.textContent));
    details.textContent = '';
    if (state.tab === 'commit' && state.selectedCommit !== null) renderCommitDetails();
    else if (state.tab === 'fixlist' && state.selectedFix) renderFixDetails();
    else if (state.tab === 'root' && state.selectedRoot) renderRootDetails();
    else if (state.tab === 'session' && state.selectedSession) renderSessionDetails();
    else renderNodeDetails(state.selectedKey ? state.nodesByKey.get(state.selectedKey) ?? null : null);
    if (openLabels.size) {
      for (const d of details.querySelectorAll<HTMLDetailsElement>('details.obj')) {
        if (openLabels.has(d.querySelector('summary')!.textContent)) d.open = true;
      }
    }
  }

  const reportActions = (): ReportViewActions => ({
    openSource: transport.openResource ? (src) => transport.openResource!(src.fileName, src.lineNumber, src.columnNumber) : null,
    highlight: transport.highlight ? (id) => transport.highlight!(id) : null,
    copy: copyText,
    readSource: transport.readSource ? (url) => transport.readSource!(url) : null,
  });

  const tabButton = (id: Tab, label: string, onclick: () => void): HTMLButtonElement => el('button', { class: state.tab === id ? 'active' : '', onclick }, label);

  function renderNodeDetails(node: TreeNode | null): void {
    if (!node) {
      details.append(el('div', { class: 'empty', text: 'Select a component to see why it re-rendered.' }));
      return;
    }
    const header = el('div', { class: 'details-header' }, [
      el('span', { class: 'title' }, [el('span', { class: 'bracket', text: '<' }), el('span', { class: 'name', text: node.name }), el('span', { class: 'bracket', text: '>' })]),
      el('span', { class: 'meta', text: `${plural(node.total, 're-render')}, ${node.avoidable} avoidable${node.wasted ? ', ' + fmtMs(node.wasted) + ' wasted' : ''}` }),
      el('span', { class: 'tabs' }, [
        tabButton('latest', 'Report', () => {
          state.tab = 'latest';
          state.selectedReport = node.lastReport ?? null;
          renderDetails();
          persist();
        }),
        tabButton('history', `History (${node.reports.length})`, () => {
          state.tab = 'history';
          renderDetails();
          persist();
        }),
        tabButton('fix', 'Fix', () => {
          state.tab = 'fix';
          renderDetails();
          persist();
        }),
      ]),
    ]);
    details.append(header);
    const body = el('div', { class: 'details-body' });
    details.append(body);
    if (state.tab === 'history') {
      const list = el('ul', { class: 'history' });
      for (const r of [...node.reports].reverse()) {
        list.append(
          el(
            'li',
            {
              class: state.selectedReport === r ? 'selected' : '',
              onclick: () => {
                state.selectedReport = r;
                state.tab = 'latest';
                renderDetails();
              },
            },
            [
              el('span', { class: 't', text: fmtTime(r.receivedAt) }),
              el('span', { class: 'n', text: '#' + r.renderCount }),
              el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }),
              el('span', { class: 'sum', text: summarize(r) }),
            ],
          ),
        );
      }
      body.append(list);
      return;
    }
    if (state.tab === 'fix') {
      body.append(fixView(rankFixes(node.reports), { copy: copyText }));
      return;
    }
    const r = state.selectedReport || node.lastReport;
    if (!r) return;
    body.append(reportView(r, reportActions()));
  }

  function rootsList(roots: RootCause[]): HTMLElement {
    return el(
      'ul',
      { class: 'roots' },
      roots.map((root) =>
        el('li', null, [
          el('a', { class: 'root-link', href: '#', title: 'Every commit this component started', onclick: (e: Event) => (e.preventDefault(), showRoot(root.name)) }, `<${root.name}>`),
          ` (${root.trigger}) → ${plural(root.count, 'avoidable re-render')}: `,
          el('span', { class: 'meta', text: componentList(root.components) }),
        ]),
      ),
    );
  }

  function renderCommitDetails(): void {
    const key = state.selectedCommit!;
    const reports = state.commits.get(key);
    if (!reports) {
      details.append(el('div', { class: 'empty', text: 'This commit is no longer buffered.' }));
      return;
    }
    const a = analysisFor(key, reports);
    details.append(
      el('div', { class: 'details-header' }, [
        el('span', { class: 'title', text: `Commit #${key}` }),
        el('span', { class: 'meta', text: `${plural(a.total, 'render')}, ${a.avoidable} avoidable${a.wasted ? ', ' + fmtMs(a.wasted) + ' wasted' : ''} · ${fmtTime(a.receivedAt)}` }),
      ]),
    );
    const body = el('div', { class: 'details-body' });
    details.append(body);
    if (a.roots.length) body.append(el('div', { class: 'section' }, [el('h3', { text: 'Root causes' }), rootsList(a.roots)]));
    if (a.contexts.length) {
      body.append(
        el('div', { class: 'section' }, [
          el('h3', { text: 'Contexts that changed' }),
          el('ul', { class: 'roots' }, a.contexts.map((c) => el('li', null, [el('b', { text: c.name }), ` → ${plural(c.consumers, 'consumer')} re-rendered${c.avoidable ? ` (${c.avoidable} with an equal value)` : ''}`]))),
        ]),
      );
    }
    const cascade = el('div', { class: 'cascade' });
    const walk = (node: CascadeNode, depth: number): void => {
      for (const child of node.children.values()) {
        const r = child.report;
        const line = el(
          'div',
          {
            class: 'cascade-row' + (r ? (r.avoidable ? ' avoid' : ' ok') : ' untracked'),
            style: `padding-left:${depth * 14}px`,
            onclick: r ? () => select(nodeOfReport(r), r) : null,
          },
          [
            el('span', { class: 'tag' }, [el('span', { class: 'bracket', text: '<' }), el('span', { class: 'name', text: child.name }), el('span', { class: 'bracket', text: '>' })]),
            r ? el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }) : el('span', { class: 'meta', text: 'did not render or untracked' }),
            child.count && child.count > 1 ? el('span', { class: 'meta', text: ` ×${child.count}` }) : null,
            r && r.avoidable ? el('span', { class: 'meta', text: ' ' + summarize(r) }) : null,
          ],
        );
        cascade.append(line);
        walk(child, depth + 1);
      }
    };
    walk(cascadeTree(reports), 0);
    body.append(el('div', { class: 'section' }, [el('h3', { text: 'Render cascade' }), cascade]));
    if (a.fixes.length) {
      body.append(el('div', { class: 'section-title', text: 'Fixes for this commit' }));
      body.append(fixView(a.fixes, { copy: copyText }));
    }
  }

  function affectedList(reports: Report[]): HTMLElement {
    const list = el('ul', { class: 'history' });
    for (const r of reports.slice().reverse()) {
      list.append(
        el('li', { onclick: () => select(nodeOfReport(r), r) }, [
          el('span', { class: 't', text: fmtTime(r.receivedAt) }),
          el('span', { class: 'comp', text: `<${r.component}>` }),
          el('span', { class: 'sum', text: summarize(r) }),
        ]),
      );
    }
    return list;
  }

  function renderFixDetails(): void {
    const fix = filteredFixes().find((f) => f.key === state.selectedFix);
    if (!fix) {
      details.append(el('div', { class: 'empty', text: 'Select a fix.' }));
      return;
    }
    details.append(el('div', { class: 'details-header' }, [el('span', { class: 'title', text: fix.label }), el('span', { class: 'meta', text: `removes ${plural(fix.count, 'avoidable re-render')}` })]));
    const body = el('div', { class: 'details-body' });
    details.append(body);
    body.append(fixView([fix], { copy: copyText }));
    body.append(el('div', { class: 'section' }, [el('h3', { text: 'Affected re-renders' }), affectedList(fix.reports)]));
  }

  /** One root cause across every commit it started. */
  function renderRootDetails(): void {
    const name = state.selectedRoot!;
    const s = rootCauseSummary(name, state.commits, analysisFor);
    details.append(
      el('div', { class: 'details-header' }, [
        el('span', { class: 'title' }, ['Root cause ', el('span', { class: 'name', text: `<${name}>` })]),
        el('span', { class: 'meta', text: s.commits.length ? `started ${plural(s.commits.length, 'commit')} with ${plural(s.total, 'avoidable re-render')} (${s.trigger})` : 'no commits in the buffer' }),
      ]),
    );
    const body = el('div', { class: 'details-body' });
    details.append(body);
    if (!s.commits.length) return;
    body.append(el('div', { class: 'section' }, [el('h3', { text: 'Components that re-rendered avoidably because of it' }), el('div', { class: 'meta', text: componentList(s.components) })]));
    const list = el('ul', { class: 'commits root-commits' });
    for (const c of s.commits) {
      list.append(
        el('li', { onclick: () => showCommit(c.key) }, [
          el('span', { class: 'id', text: `#${c.key}` }),
          el('span', { class: 't', text: fmtTime(c.analysis.receivedAt) }),
          el('span', { class: 'badge avoid', text: `${c.count} avoidable` }),
          el('span', { class: 'root', text: componentList(c.components) }),
        ]),
      );
    }
    body.append(el('div', { class: 'section' }, [el('h3', { text: 'Commits' }), list]));
    if (s.fixes.length) {
      body.append(el('div', { class: 'section-title', text: 'Fixes' }));
      body.append(fixView(s.fixes, { copy: copyText }));
    }
  }

  // ---------- sessions ----------
  const sessionSummary = (s: Session): SessionSummary => summarizeSession(s, s.reports);

  function persistSessions(): void {
    if (!transport.storage) return;
    const summaries = state.sessions.filter((s) => s.endedAt).slice(-20).map(sessionSummary);
    transport.storage.set('sessions', summaries);
  }

  function startRecording(name?: string): Session {
    if (state.recording) stopRecording();
    const startedAt = Date.now();
    const session: Session = {
      id: `s${startedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name || `Session ${state.sessions.length + 1}`,
      startedAt,
      endedAt: null,
      total: 0,
      avoidable: 0,
      wasted: 0,
      byComponent: {},
      fixes: [],
      reports: [],
    };
    state.sessions.push(session);
    state.recording = session;
    recordBtn.classList.add('active', 'rec');
    recordBtn.querySelector('.glyph')!.textContent = '⏹';
    recordBtn.querySelector('.label')!.textContent = 'Stop';
    state.selectedSession = session.id;
    state.tab = 'session';
    if (state.view === 'sessions') renderLeft();
    renderDetails();
    toast(`Recording ${session.name}`);
    return session;
  }

  function stopRecording(): Session | null {
    const session = state.recording;
    if (!session) return null;
    session.endedAt = Date.now();
    Object.assign(session, sessionSummary(session), { reports: session.reports });
    state.recording = null;
    recordBtn.classList.remove('active', 'rec');
    recordBtn.querySelector('.glyph')!.textContent = '⏺';
    recordBtn.querySelector('.label')!.textContent = 'Record';
    persistSessions();
    if (state.view === 'sessions') renderLeft();
    if (state.tab === 'session') renderDetails();
    toast(`${session.name}: ${plural(session.avoidable, 'avoidable re-render')}`);
    return session;
  }

  const fmtDuration = (s: SessionSummary): string => {
    const ms = (s.endedAt || Date.now()) - s.startedAt;
    return ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.round(ms / 60_000)} min`;
  };

  function renderSessions(): void {
    table.textContent = '';
    if (!state.sessions.length) {
      table.append(
        el('div', { class: 'empty' }, [
          el('div', { text: 'No sessions yet.' }),
          el('div', null, ['Press ', el('code', { text: 'Record' }), ', use the app, press ', el('code', { text: 'Stop' }), '. Apply a fix, record again, and compare the two.']),
        ]),
      );
      return;
    }
    const list = el('ul', { class: 'sessions' });
    for (const s of [...state.sessions].reverse()) {
      const live = s === state.recording;
      const summary = live ? sessionSummary(s) : s;
      list.append(
        el(
          'li',
          {
            class: (state.selectedSession === s.id && state.tab === 'session' ? 'selected ' : '') + (live ? 'live' : ''),
            onclick: () => {
              state.selectedSession = s.id;
              state.tab = 'session';
              renderLeft();
              renderDetails();
            },
          },
          [
            el('span', { class: 'name', text: s.name }),
            live ? el('span', { class: 'badge rec', text: 'recording' }) : el('span', { class: 't', text: fmtDuration(summary) }),
            el('span', { class: 'n', text: plural(summary.total, 'render') }),
            summary.avoidable ? el('span', { class: 'badge avoid', text: `${summary.avoidable} avoidable` }) : el('span', { class: 'badge', text: 'clean' }),
            summary.wasted ? el('span', { class: 'meta', text: fmtMs(summary.wasted) }) : null,
          ],
        ),
      );
    }
    table.append(list);
  }

  function deltaCell(n: number, suffix = '', decimals?: number): HTMLElement {
    const cls = n < 0 ? 'good' : n > 0 ? 'bad' : '';
    const value = decimals !== undefined ? n.toFixed(decimals) : Number.isInteger(n) ? String(n) : n.toFixed(1);
    return el('td', { class: 'num delta ' + cls, text: n === 0 ? '±0' : `${n > 0 ? '+' : ''}${value}${suffix}` });
  }

  function renderSessionDetails(): void {
    const session = state.sessions.find((s) => s.id === state.selectedSession);
    if (!session) {
      details.append(el('div', { class: 'empty', text: 'Select a session.' }));
      return;
    }
    const live = session === state.recording;
    const summary = live ? sessionSummary(session) : session;
    const nameInput = el('input', { type: 'text', class: 'session-name', value: session.name, title: 'Rename' });
    nameInput.addEventListener('change', () => {
      session.name = nameInput.value.trim() || session.name;
      nameInput.value = session.name;
      persistSessions();
      if (state.view === 'sessions') renderLeft();
    });
    details.append(
      el('div', { class: 'details-header' }, [
        nameInput,
        el('span', { class: 'meta', text: `${live ? 'recording · ' : ''}${fmtDuration(summary)} · ${plural(summary.total, 'render')}, ${summary.avoidable} avoidable${summary.wasted ? ', ' + fmtMs(summary.wasted) + ' wasted' : ''}` }),
        live ? el('button', { class: 'ib', onclick: () => stopRecording() }, '⏹ Stop') : null,
      ]),
    );
    const body = el('div', { class: 'details-body' });
    details.append(body);

    // compare
    const others = state.sessions.filter((s) => s !== session && s.endedAt);
    const compareSec = el('div', { class: 'section compare' }, [el('h3', { text: 'Compare' })]);
    if (!others.length) {
      compareSec.append(el('div', { class: 'meta', text: 'Record a second session (after a fix) to compare against this one.' }));
    } else {
      const select = el('select', { class: 'compare-select' });
      select.append(el('option', { value: '', text: 'Compare with…' }));
      for (const o of others) select.append(el('option', { value: o.id, text: o.name }));
      const baseline = state.compareWith && others.some((o) => o.id === state.compareWith) ? state.compareWith : others[others.length - 1]!.id;
      select.value = baseline;
      select.addEventListener('change', () => {
        state.compareWith = select.value || null;
        renderDetails();
      });
      compareSec.append(el('div', { class: 'meta' }, ['Baseline: ', select, ' → this session']));
      const before = others.find((o) => o.id === baseline)!;
      const cmp = compareSessions(before, summary);
      const t = el('table', { class: 'grid compare-grid' });
      t.append(el('thead', null, el('tr', null, [el('th', { text: 'Avoidable re-renders' }), el('th', { class: 'num', text: before.name }), el('th', { class: 'num', text: summary.name }), el('th', { class: 'num', text: 'Δ' })])));
      const tb = el('tbody');
      const totalRow = el('tr', { class: 'total' }, [el('td', { text: 'All components' }), el('td', { class: 'num', text: String(cmp.avoidable.before) }), el('td', { class: 'num', text: String(cmp.avoidable.after) })]);
      totalRow.append(deltaCell(cmp.avoidable.delta));
      tb.append(totalRow);
      if (cmp.wasted.before || cmp.wasted.after) {
        const w = el('tr', { class: 'total' }, [el('td', { text: 'Wasted time' }), el('td', { class: 'num', text: fmtMs(cmp.wasted.before) }), el('td', { class: 'num', text: fmtMs(cmp.wasted.after) })]);
        w.append(deltaCell(cmp.wasted.delta, ' ms', 1));
        tb.append(w);
      }
      for (const row of cmp.rows) {
        const tr = el('tr', null, [el('td', { class: 'c' }, el('span', { class: 'name', text: row.component })), el('td', { class: 'num', text: String(row.before) }), el('td', { class: 'num', text: String(row.after) })]);
        tr.append(deltaCell(row.delta));
        tb.append(tr);
      }
      t.append(tb);
      compareSec.append(t);
      if (cmp.resolvedFixes.length) compareSec.append(el('div', { class: 'meta' }, [el('b', { text: 'No longer needed: ' }), cmp.resolvedFixes.map((f) => f.label).join(' · ')]));
      if (cmp.newFixes.length) compareSec.append(el('div', { class: 'meta' }, [el('b', { text: 'New: ' }), cmp.newFixes.map((f) => f.label).join(' · ')]));
    }
    body.append(compareSec);

    // offenders of this session
    const comps = Object.entries(summary.byComponent).sort((a, b) => b[1].avoidable - a[1].avoidable || b[1].total - a[1].total);
    if (comps.length) {
      const t = el('table', { class: 'grid' });
      t.append(el('thead', null, el('tr', null, [el('th', { text: 'Component' }), el('th', { class: 'num', text: 'Avoidable' }), el('th', { class: 'num', text: 'Total' }), el('th', { class: 'num', text: 'Wasted' })])));
      const tb = el('tbody');
      for (const [name, c] of comps.slice(0, 50)) {
        tb.append(
          el('tr', { onclick: () => panelApi.select(name) }, [
            el('td', { class: 'c' }, el('span', { class: 'name', text: name })),
            el('td', { class: 'num' }, c.avoidable ? el('span', { class: 'badge avoid', text: String(c.avoidable) }) : '0'),
            el('td', { class: 'num', text: String(c.total) }),
            el('td', { class: 'num', text: c.wasted ? fmtMs(c.wasted) : '' }),
          ]),
        );
      }
      t.append(tb);
      body.append(el('div', { class: 'section' }, [el('h3', { text: 'Components in this session' }), t]));
    }
    if (summary.fixes.length) {
      body.append(el('div', { class: 'section' }, [el('h3', { text: 'Fixes suggested' }), el('ol', { class: 'fix-list' }, summary.fixes.slice(0, 10).map((f) => el('li', null, [el('span', { class: 'badge avoid', text: String(f.count) }), ' ', el('span', { class: 'mono', text: f.label })])))]));
    }
  }

  // ---------- stream (virtualized) ----------
  const itemEls = new WeakMap<Report, HTMLElement>();
  const streamItems = virtualList<Report>(streamList, ITEM_H, (r) => {
    let li = itemEls.get(r);
    if (!li) {
      li = el('div', { class: 'stream-item', onclick: () => select(nodeOfReport(r), r) }, [
        el('span', { class: 't', text: fmtTime(r.receivedAt) }),
        el('span', { class: 'c', text: r.component }),
        el('span', { class: 'v ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }),
        el('span', { class: 's', text: summarize(r) }),
      ]);
      itemEls.set(r, li);
    }
    return li;
  });
  let streamShown: Report[] = []; // newest first

  /** Rebuild from state (filters, clear) or prepend a batch (live). */
  function renderStream(batch?: Report[]): void {
    if (batch) {
      const fresh = batch.filter(passes).reverse();
      if (fresh.length) streamShown = fresh.concat(streamShown);
      if (streamShown.length > MAX_REPORTS) streamShown.length = MAX_REPORTS;
    } else {
      streamShown = filteredReports().reverse();
    }
    streamCount.textContent = plural(streamShown.length, 'report');
    streamItems.setItems(streamShown);
  }

  // ---------- export / import ----------
  function exportJson(): void {
    const data = {
      rerenderLens: true,
      version: PROTOCOL,
      exportedAt: new Date().toISOString(),
      origin: state.origin,
      reports: state.reports,
      sessions: state.sessions.filter((s) => s.endedAt).map(sessionSummary),
    };
    const text = JSON.stringify(data, null, 2);
    const name = `rerender-lens-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      copyText(text);
    }
  }

  function importData(data: unknown): number {
    const reports = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.reports) ? data.reports : null;
    if (!reports) throw new Error('not a rerender-lens export');
    clearAll();
    if (isRecord(data) && Array.isArray(data.sessions)) restoreSessions(data.sessions);
    let n = 0;
    for (const p of reports) {
      const r = normalizeReport(p);
      if (r) {
        enqueue(r);
        n++;
      }
    }
    flush();
    toast(`Imported ${plural(n, 'report')}`);
    return n;
  }

  function importFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(JSON.parse(String(reader.result)));
      } catch (e) {
        toast(`Import failed: ${(e as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  // ---------- status / settings ----------
  function renderStatus(): void {
    const lib = state.library;
    let text: string;
    let cls = 'none';
    let title = '';
    if (lib) {
      const react = lib.react && lib.react[0];
      text = `connected · lib ${lib.library || '?'}${react && react.version ? ` · React ${react.version}` : ''}${lib.production ? ' (prod)' : ''}`;
      cls = 'connected';
      title = state.relay ? 'live via content script' : 'polling the page';
      if (lib.overhead) title += ` · library overhead ${lib.overhead.totalMs.toFixed(1)} ms over ${plural(lib.commits ?? 0, 'commit')}, worst ${lib.overhead.maxCommitMs.toFixed(1)} ms`;
      if (lib.truncated) title += ` · ${plural(lib.truncated, 'report')} skipped by the per-commit cap`;
    } else if (state.relay || state.polling) {
      text = 'no library in page';
      cls = 'partial';
      title = 'rerender-lens is not running in this page';
    } else {
      text = 'no page';
    }
    status.className = 'status ' + cls;
    status.title = title;
    status.querySelector('.status-text')!.textContent = text;
    tabChip.hidden = !state.tabLabel;
    tabChip.textContent = state.tabLabel || '';
    banner.textContent = '';
    const warnings: string[] = [];
    if (lib && typeof lib.protocol === 'number' && lib.protocol > PROTOCOL) warnings.push(`The page runs a newer rerender-lens (protocol ${lib.protocol}) than this panel (${PROTOCOL}). Update the extension.`);
    if (lib && lib.production) warnings.push('Production React build detected: component names may be minified and hooks are unlabeled. Use a development build.');
    if (lib && lib.injected && lib.source === 'page')
      warnings.push(`The page runs its own rerender-lens ${lib.library || ''}; the copy injected by the extension stepped aside. Turn injection off for this origin in Settings to avoid loading the library twice.`);
    if (lib && lib.enabled === false) warnings.push('rerender-lens is present but disabled in this page.');
    if (lib && lib.truncated) warnings.push(`${plural(lib.truncated, 'report')} skipped: a commit re-rendered more tracked components than the per-commit cap (200) or took over its time budget. Narrow "include" in Settings, or fix the top offenders first.`);
    banner.hidden = warnings.length === 0;
    for (const w of warnings) banner.append(el('div', { text: w }));
  }

  function setRelay(on: boolean): void {
    state.relay = on;
    if (!on) state.library = null;
    renderStatus();
  }

  function setLibrary(info: HelloPayload): void {
    state.library = info;
    renderStatus();
    if (state.settingsOpen) void renderSettings();
    if (state.flashOn) transport.flashAvoidable?.(true);
  }

  function toggleSettings(open?: boolean): void {
    state.settingsOpen = open === undefined ? !state.settingsOpen : open;
    settings.hidden = !state.settingsOpen;
    settingsBtn.classList.toggle('active', state.settingsOpen);
    settingsBtn.setAttribute('aria-expanded', String(state.settingsOpen));
    if (state.settingsOpen) void renderSettings().then(() => (settings.querySelector('input, button') as HTMLElement | null)?.focus());
    else settingsBtn.focus();
  }

  function optionRow(label: string, key: keyof SerializableOptions, current: SerializableOptions, onchange: (patch: SerializableOptions) => void): HTMLElement {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!current[key];
    input.addEventListener('change', () => onchange({ [key]: input.checked }));
    return el('label', { class: 'opt' }, [input, label]);
  }

  async function renderSettings(): Promise<void> {
    settings.textContent = '';
    settings.append(el('div', { class: 'drawer-header' }, [el('b', { text: 'Settings' }), el('button', { onclick: () => toggleSettings(false) }, '✕')]));
    const body = el('div', { class: 'drawer-body' });
    settings.append(body);

    // --- site ---
    if (transport.originStatus) {
      const site = el('div', { class: 'section' }, [el('h3', { text: 'This site' }), el('div', { class: 'meta', text: state.origin || '' })]);
      body.append(site);
      try {
        const st = await transport.originStatus();
        if (st) {
          const enabled = el('input', { type: 'checkbox' });
          enabled.checked = st.enabled;
          enabled.disabled = st.builtIn;
          const inject = el('input', { type: 'checkbox' });
          inject.checked = st.inject;
          inject.disabled = !st.enabled;
          const defer = el('input', { type: 'checkbox' });
          defer.checked = !!st.deferHook;
          defer.disabled = !st.inject;
          const msg = el('div', { class: 'meta' });
          const apply = async (): Promise<void> => {
            try {
              if (enabled.checked && !st.permitted && transport.requestPermission) {
                const ok = await transport.requestPermission();
                if (!ok) {
                  msg.textContent = 'Permission not granted. You can also enable the site from the toolbar icon.';
                  enabled.checked = false;
                  return;
                }
              }
              await transport.setOrigin?.({ enabled: enabled.checked, inject: enabled.checked && inject.checked, deferHook: inject.checked && defer.checked });
              void renderSettings();
            } catch (e) {
              msg.textContent = String((e as Error).message || e);
            }
          };
          enabled.addEventListener('change', () => {
            if (!enabled.checked) inject.checked = false;
            void apply();
          });
          inject.addEventListener('change', () => void apply());
          defer.addEventListener('change', () => void apply());
          site.append(
            el('label', { class: 'opt' }, [enabled, st.builtIn ? 'Enabled (local development host)' : 'Enable on this site']),
            el('label', { class: 'opt' }, [inject, 'Inject the library into the page (no app code needed)']),
            el('label', { class: 'opt', title: 'Only needed when React DevTools is installed and its Components tab comes up empty' }, [defer, 'Let React DevTools create the hook (if both are installed)']),
            el('div', { class: 'meta', text: st.inject ? 'Injection is on. Reload the page after changing it.' : 'Without injection the page must call init({ notifier: createDevtoolsNotifier() }).' }),
            msg,
          );
        }
      } catch (e) {
        site.append(el('div', { class: 'meta', text: String((e as Error).message || e) }));
      }
    }

    // --- panel ---
    const flash = el('input', { type: 'checkbox' });
    flash.checked = state.flashOn;
    flash.addEventListener('change', () => {
      state.flashOn = flash.checked;
      transport.flashAvoidable?.(state.flashOn);
      persist();
    });
    body.append(
      el('div', { class: 'section' }, [
        el('h3', { text: 'Panel' }),
        el('label', { class: 'opt' }, [flash, 'Flash avoidable re-renders in the page']),
        el('div', { class: 'meta', text: 'Shortcuts: / search, f fix tab, Esc clear highlight, arrows in the tree.' }),
      ]),
    );

    // --- library options ---
    const lib = state.library;
    const sec = el('div', { class: 'section' }, [el('h3', { text: 'Library options' })]);
    body.append(sec);
    if (!lib || !transport.configure) {
      sec.append(el('div', { class: 'meta', text: 'Connect to a page running rerender-lens to change its options.' }));
      return;
    }
    const current: SerializableOptions = Object.assign({}, lib.options || {});
    const applyOptions = async (patch: SerializableOptions): Promise<void> => {
      Object.assign(current, patch);
      try {
        const applied = await transport.configure!(patch);
        if (applied && state.library) state.library.options = applied;
        if (transport.storage && state.library) transport.storage.set('settings', Object.assign({}, state.library.options));
        toast('Applied');
      } catch (e) {
        toast(`Failed: ${(e as Error).message}`);
      }
    };
    sec.append(
      optionRow('Track every React.memo / PureComponent', 'trackAllMemoized', current, applyOptions),
      optionRow('Track every component (noisy)', 'trackAllComponents', current, applyOptions),
      optionRow('Diff hook state and contexts', 'trackHooks', { trackHooks: current.trackHooks !== false }, applyOptions),
      optionRow('Include current hooks, state and contexts in every report', 'includeState', { includeState: current.includeState !== false }, applyOptions),
      optionRow('Resolve custom hook names (re-runs each component type once)', 'resolveHookNames', current, applyOptions),
      optionRow('Ignore Fast Refresh commits', 'ignoreHotReload', { ignoreHotReload: current.ignoreHotReload !== false }, applyOptions),
      optionRow('Print to the page console', 'silent', { silent: !current.silent }, (p) => applyOptions({ silent: !p.silent })),
      optionRow('Print genuine re-renders too (logAll)', 'logAll', current, applyOptions),
    );
    const listInput = (label: string, key: 'include' | 'exclude'): HTMLElement => {
      const input = el('input', { type: 'text', placeholder: 'Name, /regex/, ...', value: (current[key] || []).join(', ') });
      input.addEventListener('change', () => void applyOptions({ [key]: input.value.split(',').map((s) => s.trim()).filter(Boolean) }));
      return el('label', { class: 'opt col' }, [label, input]);
    };
    sec.append(listInput('Include (display names)', 'include'), listInput('Exclude', 'exclude'));
    const max = el('input', { type: 'number', min: '0', value: String(current.maxReportsPerComponent || 0) });
    max.addEventListener('change', () => void applyOptions({ maxReportsPerComponent: Math.max(0, Number(max.value) || 0) }));
    sec.append(el('label', { class: 'opt col' }, ['Stop printing a component after N reports (0 = never)', max]));
  }

  // ---------- transport ----------
  function handle(message: Message): void {
    if (!isRecord(message)) return;
    // Relay transports learn the origin asynchronously; pick it up with the first message.
    if (transport.origin && transport.origin !== state.origin) state.origin = transport.origin;
    switch (message.type) {
      case 'connected':
        setRelay(true);
        break;
      case 'disconnected':
        setRelay(false);
        break;
      case 'polling':
        state.polling = !!message.on;
        renderStatus();
        break;
      case 'tab-label':
        state.tabLabel = typeof message.payload === 'string' ? message.payload : null;
        renderStatus();
        break;
      case 'tab':
        // Standalone mode switched to another tab: start over for it.
        state.tabLabel = typeof message.payload === 'string' ? message.payload : null;
        state.origin = transport.origin || null;
        clearAll();
        state.library = null;
        renderStatus();
        break;
      case 'hello':
        if (isRecord(message.payload)) setLibrary(message.payload as unknown as HelloPayload);
        break;
      case 'clear':
      case 'navigated':
        clearAll();
        if (message.type === 'navigated') {
          state.library = null;
          renderStatus();
        }
        break;
      case 'report': {
        if (state.paused) break;
        const r = normalizeReport(message.payload);
        if (r) enqueue(r);
        break;
      }
      case 'batch':
        // The content script coalesces one macrotask of page messages; each item is handled in order.
        if (Array.isArray(message.items)) for (const item of message.items) handle(item as Message);
        break;
    }
  }

  const panelApi: Panel = {
    state,
    handle,
    flush,
    clearAll,
    importData,
    select: (name: string) => {
      for (const n of state.nodesByKey.values()) if (n.name === name) return select(n);
    },
    setView,
    openSettings: () => toggleSettings(true),
    startRecording,
    stopRecording,
  };

  if (options.theme === 'dark') document.documentElement.classList.add('theme-dark');
  state.origin = transport.origin || null;
  setView(state.view);
  renderDetails();
  renderStream();
  renderSummary();
  renderStatus();
  measure();
  if (transport.storage) {
    Promise.resolve(transport.storage.get('panel')).then(restore, () => {});
    Promise.resolve(transport.storage.get('sessions')).then(restoreSessions, () => {});
  }
  transport.subscribe(handle);
  return panelApi;
}

// ---------- transport helpers ----------
const systemTheme = (): 'dark' | 'light' => (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** Module source over HTTP (dev servers serve it as-is); null when unreachable. */
const fetchSource = (url: string): Promise<string | null> => fetch(url).then((res) => (res.ok ? res.text() : null)).catch(() => null);

/** Panel storage in `localStorage`, keys prefixed per transport. */
function localStorageAdapter(prefix: string): NonNullable<Transport['storage']> {
  const mem = (key: string): string => `${prefix}:${key}`;
  return {
    get: (key) => {
      try {
        const raw = localStorage.getItem(mem(key));
        return raw ? JSON.parse(raw) : undefined;
      } catch {
        return undefined;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(mem(key), JSON.stringify(value));
      } catch {
        /* quota or private mode */
      }
    },
  };
}

/**
 * Request/response over a message stream: `bridge(cmd, arg)` sends a `__rerenderLensCmd` message and resolves with
 * the matching `__rerenderLensReply` (null after `timeoutMs` when nobody answers); `reply(m)` feeds incoming messages
 * and returns true when it consumed one.
 */
function commandBridge(send: (message: { __rerenderLensCmd: true; id: string; cmd: string; arg: unknown }) => unknown, timeoutMs: number) {
  const pending = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const bridge = <T = unknown,>(cmd: string, arg?: unknown): Promise<T | null> =>
    new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const fail = (): void => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(null);
      };
      const timer = setTimeout(fail, timeoutMs);
      pending.set(id, { resolve: (v) => (v instanceof Error ? reject(v) : resolve(v as T)), timer });
      try {
        void Promise.resolve(send({ __rerenderLensCmd: true, id, cmd, arg })).catch(fail);
      } catch {
        fail();
      }
    });
  const reply = (m: Record<string, unknown>): boolean => {
    if (m.__rerenderLensReply !== true || typeof m.id !== 'string') return false;
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(typeof m.error === 'string' ? new Error(m.error) : m.result);
    }
    return true;
  };
  return { bridge, reply };
}

// ---------- boot: extension ----------
/** Calls into the page bridge, expressed as commands so both adapters (eval / scripting) can run them. */
export type BridgeCommand = 'info' | 'pull' | 'replay' | 'clear' | 'configure' | 'highlight' | 'flash';

/** What a host (DevTools panel, side panel, window) must provide for the shared relay transport. */
export interface TransportIO {
  tabId(): number | null;
  /** Origin of the inspected page, or null when unknown (no access). */
  origin(): Promise<string | null>;
  bridge<T = unknown>(cmd: BridgeCommand, arg?: unknown): Promise<T | null>;
  /** Fires after the inspected page navigated (top frame). */
  onNavigated(cb: () => void): void;
  /** Standalone only: the followed tab changed (label for the chip). */
  onTabChange?(cb: (label: string | null) => void): void;
  openResource?(url: string, line?: number, col?: number): void;
  undock?(mode: 'sidepanel' | 'window'): Promise<unknown>;
  tabLabel?: string | null;
  readSource?(url: string): Promise<string | null>;
}

interface PullResult {
  seq: number;
  reports: unknown[];
  dropped: boolean;
}

/** Background-relay transport with a polling fallback; identical for every host. */
function createRelayTransport(io: TransportIO): Transport {
  let listener: ((m: Message) => void) | null = null;
  let relayConnected = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let since = 0;
  let origin: string | null = null;
  let panelPort: chrome.runtime.Port | null = null;
  let currentTab: number | null = io.tabId();
  const emit = (m: Message): void => {
    if (listener) listener(m);
  };
  const send = <T = unknown>(message: unknown): Promise<T> =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(message, (res: { ok?: boolean; result?: T; error?: string } | undefined) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error((res && res.error) || 'no response'));
        else resolve(res.result as T);
      }),
    );

  async function resolveOrigin(): Promise<void> {
    origin = await io.origin().catch(() => null);
    transport.origin = origin;
  }

  async function syncWithPage(): Promise<boolean> {
    try {
      const info = await io.bridge<HelloPayload>('info');
      if (info) {
        emit({ type: 'hello', version: info.protocol, payload: info });
        return true;
      }
    } catch {
      /* page not ready */
    }
    return false;
  }

  // Handshake retries: a page answers `info` only once the library has loaded, which can be well after the
  // navigation event (or after the panel opened). Backoff 500 ms doubling to 5 s, at most SYNC_RETRIES tries;
  // a navigation, a tab switch, a successful attach or `dispose` cancels whatever is pending.
  let syncGen = 0;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  function cancelSync(): void {
    syncGen++;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
  }
  /** `syncWithPage` until it succeeds (then `onReady`), with backoff; supersedes any earlier attempt. */
  function syncWithRetry(onReady: () => void, initialDelay = 0): void {
    cancelSync();
    const gen = syncGen;
    let delay = SYNC_RETRY_MIN;
    let tries = 0;
    const attempt = async (): Promise<void> => {
      syncTimer = null;
      if (gen !== syncGen || disposed) return;
      const ok = await syncWithPage();
      if (gen !== syncGen || disposed) return; // superseded while `info` was in flight
      if (ok) {
        onReady();
        return;
      }
      if (++tries >= SYNC_RETRIES) return;
      syncTimer = setTimeout(() => void attempt(), delay);
      delay = Math.min(delay * 2, SYNC_RETRY_MAX);
    };
    if (initialDelay > 0) syncTimer = setTimeout(() => void attempt(), initialDelay);
    else void attempt();
  }

  let droppedSeen = false; // `pull` reported a gap since the last `since` reset: clear once, not on every poll
  function resetSince(): void {
    since = 0;
    droppedSeen = false;
  }

  async function pollOnce(): Promise<void> {
    try {
      const res = await io.bridge<PullResult>('pull', since);
      if (!res) return;
      if (res.dropped && !droppedSeen) {
        droppedSeen = true;
        emit({ type: 'clear' });
      }
      for (const p of res.reports) emit({ type: 'report', payload: p });
      since = res.seq;
    } catch {
      /* ignore */
    }
  }

  function setPolling(on: boolean): void {
    if (on && !pollTimer) {
      pollTimer = setInterval(() => void pollOnce(), 500);
      emit({ type: 'polling', on: true });
    } else if (!on && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      emit({ type: 'polling', on: false });
    }
  }

  /** First contact with a page (retried until it answers): replay through the relay, or pull everything and start polling. */
  function attachToPage(initialDelay = 0): void {
    syncWithRetry(() => {
      if (relayConnected) io.bridge('replay').catch(() => {});
      else {
        const gen = syncGen;
        void io.bridge<PullResult>('pull', 0)
          .catch(() => null)
          .then((res) => {
            if (gen !== syncGen || disposed) return;
            if (res) {
              for (const p of res.reports) emit({ type: 'report', payload: p });
              since = res.seq;
            } else io.bridge('replay').catch(() => {});
            setPolling(true);
          });
      }
    }, initialDelay);
  }

  function connect(): void {
    if (panelPort) {
      try {
        panelPort.disconnect();
      } catch {
        /* already gone */
      }
      panelPort = null;
    }
    if (currentTab === null) return;
    const port = chrome.runtime.connect({ name: 'rerender-lens-panel' });
    panelPort = port;
    port.postMessage({ type: 'init', tabId: currentTab });
    port.onMessage.addListener((m: Message) => {
      if (!m || panelPort !== port) return;
      if (m.type === 'connected') {
        relayConnected = true;
        setPolling(false);
      } else if (m.type === 'disconnected') {
        relayConnected = false;
        // The content script went away (page unloading, or the relay was disabled): fall back to polling once the page answers.
        syncWithRetry(() => setPolling(true));
      }
      emit(m);
    });
    port.onDisconnect.addListener(() => {
      if (panelPort !== port) return;
      panelPort = null;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!disposed) connect();
      }, 1000);
    });
  }
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const transport: Transport = {
    origin,
    tabLabel: io.tabLabel ?? null,
    subscribe(fn) {
      listener = fn;
      connect();
      io.onNavigated(() => {
        if (disposed) return;
        // The old page is gone: stop evaluating into it until the new one answers `info` (attachToPage restarts polling).
        resetSince();
        setPolling(false);
        cancelSync();
        fn({ type: 'navigated' });
        void resolveOrigin().then(() => {
          if (!disposed) attachToPage(NAVIGATION_SETTLE);
        });
      });
      io.onTabChange?.((label) => {
        if (disposed) return;
        transport.tabLabel = label;
        const next = io.tabId();
        if (next === currentTab) {
          fn({ type: 'tab-label', payload: label }); // same tab, new title or URL
          return;
        }
        resetSince();
        relayConnected = false;
        setPolling(false);
        cancelSync();
        currentTab = next;
        void resolveOrigin().then(() => {
          if (disposed) return;
          fn({ type: 'tab', payload: label });
          connect();
          attachToPage();
        });
      });
      void resolveOrigin().then(() => {
        if (!disposed) attachToPage();
      });
    },
    replay() {
      if (relayConnected) io.bridge('replay').catch(() => {});
      else {
        resetSince();
        emit({ type: 'clear' });
        void syncWithPage().then(() => pollOnce());
      }
    },
    clear() {
      io.bridge('clear').catch(() => {});
      resetSince();
    },
    dispose() {
      disposed = true;
      cancelSync();
      setPolling(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (panelPort) {
        try {
          panelPort.disconnect();
        } catch {
          /* already gone */
        }
        panelPort = null;
      }
      listener = null;
    },
    configure: (options) => io.bridge<SerializableOptions>('configure', options).then((r) => r ?? undefined),
    highlight: (id) => io.bridge('highlight', id).catch(() => {}),
    flashAvoidable: (on) => io.bridge('flash', !!on).catch(() => {}),
    originStatus: () => (origin ? send<OriginStatus>({ type: 'origin:status', origin }) : Promise.resolve(null)),
    setOrigin: (cfg) => send({ type: 'origin:set', origin, enabled: cfg.enabled, inject: cfg.inject, deferHook: cfg.deferHook }),
    requestPermission: () => chrome.permissions.request({ origins: [origin + '/*'] }),
    storage: {
      get: (key) => new Promise((resolve) => chrome.storage.local.get(`${key}:${origin}`, (got) => resolve(got ? got[`${key}:${origin}`] : undefined))),
      set: (key, value) => new Promise<void>((resolve) => chrome.storage.local.set({ [`${key}:${origin}`]: value }, resolve)),
    },
    badge(count) {
      if (panelPort) panelPort.postMessage({ type: 'badge', count });
    },
    copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
  };
  if (io.openResource) transport.openResource = io.openResource;
  if (io.undock) transport.undock = io.undock;
  if (io.readSource) transport.readSource = io.readSource;
  return transport;
}

interface EvalError {
  isException?: boolean;
  isError?: boolean;
  value?: string;
  description?: string;
}

/** Adapter for the DevTools panel: `chrome.devtools.inspectedWindow.eval` (no host permission needed). */
function devtoolsIO(): TransportIO {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  const evalIn = <T = unknown>(code: string): Promise<T> =>
    new Promise((resolve, reject) =>
      chrome.devtools.inspectedWindow.eval(code, (result: unknown, err?: EvalError) => {
        if (err && (err.isException || err.isError)) reject(new Error(err.value || err.description || 'eval failed'));
        else resolve(result as T);
      }),
    );
  const expressions: Record<BridgeCommand, (arg: unknown) => string> = {
    info: () => 'b.info()',
    pull: (since) => `b.pull?b.pull(${Number(since) || 0}):null`,
    replay: () => 'b.replay()',
    clear: () => 'b.clear()',
    configure: (o) => `b.configure(${JSON.stringify(o ?? {})})`,
    highlight: (id) => `b.highlight(${id === null || id === undefined ? 'null' : Number(id)})`,
    flash: (on) => `b.flashAvoidable(${!!on})`,
  };
  return {
    tabId: () => tabId,
    origin: () => evalIn<string>('location.origin'),
    bridge: <T,>(cmd: BridgeCommand, arg?: unknown) =>
      evalIn<T | null | { __error: string }>(`(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;if(!b)return null;try{return (${expressions[cmd](arg)});}catch(e){return {__error:String(e)}}})()`).then((r) => {
        if (isRecord(r) && typeof r.__error === 'string') throw new Error(r.__error);
        return r as T | null;
      }),
    onNavigated: (cb) => chrome.devtools.network.onNavigated.addListener(cb),
    openResource(url, line, col) {
      if (chrome.devtools.panels.openResource) chrome.devtools.panels.openResource(url, Math.max(0, (line || 1) - 1), Math.max(0, (col || 1) - 1), () => {});
    },
    undock: (mode) => openOutside(mode, tabId),
    readSource: (url) =>
      new Promise((resolve) => {
        const bare = url.replace(/\?.*$/, '');
        chrome.devtools.inspectedWindow.getResources((resources) => {
          const res = resources.find((x) => x.url === url) || resources.find((x) => x.url.replace(/\?.*$/, '') === bare);
          if (!res) return resolve(null);
          res.getContent((content) => resolve(typeof content === 'string' ? content : null));
        });
      }),
  };
}

/** Runs inside the inspected page (MAIN world) via chrome.scripting; must not close over anything. */
function pageBridgeCommand(cmd: string, arg: unknown): unknown {
  const b = (window as unknown as { __RERENDER_LENS_DEVTOOLS__?: Record<string, (...a: unknown[]) => unknown> }).__RERENDER_LENS_DEVTOOLS__;
  if (!b) return null;
  try {
    switch (cmd) {
      case 'info':
        return b.info!();
      case 'pull':
        return b.pull ? b.pull(arg) : null;
      case 'replay':
        b.replay?.();
        return true;
      case 'clear':
        b.clear?.();
        return true;
      case 'configure':
        return b.configure ? b.configure(arg) : null;
      case 'highlight':
        return b.highlight ? b.highlight(arg) : false;
      case 'flash':
        b.flashAvoidable?.(arg);
        return true;
    }
  } catch (e) {
    return { __error: String(e) };
  }
  return null;
}

/** Open the panel outside DevTools. Works from any extension page (popup, DevTools panel). */
async function openOutside(mode: 'sidepanel' | 'window', tabId: number): Promise<unknown> {
  if (mode === 'sidepanel') {
    const sp = (chrome as unknown as { sidePanel?: { setOptions(o: unknown): Promise<void>; open(o: unknown): Promise<void> } }).sidePanel;
    if (!sp) throw new Error('This browser has no side panel API; use "Window" instead.');
    await sp.setOptions({ tabId, path: 'sidepanel.html?tabId=' + encodeURIComponent(String(tabId)), enabled: true });
    await sp.open({ tabId });
    return true;
  }
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage({ type: 'window:open', tabId }, (res: { ok?: boolean; error?: string } | undefined) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!res || !res.ok) reject(new Error((res && res.error) || 'could not open a window'));
      else resolve(true);
    }),
  );
}

export interface StandaloneOptions {
  /** Pin to this tab; otherwise follow the active tab of the current window. */
  tabId?: number | null;
}

/** Adapter for the side panel / own window: background relay + `chrome.scripting.executeScript`. */
function standaloneIO(opts: StandaloneOptions = {}): TransportIO {
  let tabId: number | null = typeof opts.tabId === 'number' ? opts.tabId : null;
  const pinned = tabId !== null;
  let label: string | null = null;
  const labelOf = (tab: { title?: string; url?: string } | undefined): string | null => {
    if (!tab) return null;
    const o = tab.url ? tab.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
    return tab.title ? `${tab.title}${o ? ' · ' + o : ''}` : o || null;
  };
  const exec = <T,>(target: number, world: 'MAIN' | 'ISOLATED', func: (...a: never[]) => unknown, args: unknown[] = []): Promise<T> =>
    chrome.scripting
      .executeScript({ target: { tabId: target }, world, func: func as () => unknown, args } as chrome.scripting.ScriptInjection<unknown[], unknown>)
      .then((results) => (results && results[0] ? (results[0].result as T) : (null as T)));
  const io: TransportIO = {
    tabId: () => tabId,
    tabLabel: label,
    async origin() {
      if (tabId === null) return null;
      try {
        return await exec<string>(tabId, 'ISOLATED', () => location.origin);
      } catch {
        try {
          const tab = await chrome.tabs.get(tabId);
          return tab && tab.url ? new URL(tab.url).origin : null;
        } catch {
          return null;
        }
      }
    },
    bridge: <T,>(cmd: BridgeCommand, arg?: unknown) => {
      if (tabId === null) return Promise.resolve(null);
      return exec<T | null | { __error: string }>(tabId, 'MAIN', pageBridgeCommand as (...a: never[]) => unknown, [cmd, arg ?? null]).then((r) => {
        if (isRecord(r) && typeof r.__error === 'string') throw new Error(r.__error);
        return r as T | null;
      });
    },
    onNavigated(cb) {
      chrome.tabs.onUpdated.addListener((id, info) => {
        if (id === tabId && info.status === 'loading') cb();
      });
    },
    onTabChange(cb) {
      const announce = async (): Promise<void> => {
        try {
          const tab = tabId === null ? undefined : await chrome.tabs.get(tabId);
          label = labelOf(tab);
        } catch {
          label = null;
        }
        cb(label);
      };
      if (pinned) {
        chrome.tabs.onUpdated.addListener((id, info) => {
          if (id === tabId && (info.title || info.url)) void announce();
        });
        void announce();
        return;
      }
      chrome.tabs.onActivated.addListener(({ tabId: active }) => {
        tabId = active;
        void announce();
      });
      void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const t = tabs && tabs[0];
        if (t && typeof t.id === 'number') {
          tabId = t.id;
          void announce();
        }
      });
    },
    openResource: (url) => void chrome.tabs.create({ url }),
    undock: (mode) => (tabId === null ? Promise.reject(new Error('no tab')) : openOutside(mode, tabId)),
    // Host permission for the origin is required to fetch the module source (and present when the panel works at all).
    readSource: fetchSource,
  };
  return io;
}

function bootExtension(): void {
  const theme = chrome.devtools.panels.themeName === 'dark' ? 'dark' : systemTheme();
  createPanel(document.getElementById('root')!, createRelayTransport(devtoolsIO()), { theme });
}

function bootStandalone(opts: StandaloneOptions = {}): Panel {
  return createPanel(document.getElementById('root')!, createRelayTransport(standaloneIO(opts)), { theme: systemTheme() });
}

// ---------- boot: demo ----------
function sampleReports(): Record<string, unknown>[] {
  const fn = (name: string): string => FN_PREFIX + name;
  return [
    {
      component: 'ProductRow', path: ['App', 'ProductPage', 'ProductList'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 4, commitId: 1, memoized: true, commitPriority: 'immediate',
      owner: 'ProductList', parent: { name: 'ProductPage', trigger: 'state' }, selfDuration: 0.8, treeDuration: 1.1,
      source: { fileName: 'http://localhost:5199/src/ProductList.tsx', lineNumber: 14, columnNumber: 7 },
      props: {
        prev: { product: { id: 1, name: 'Keyboard', price: 49 }, style: { color: 'red' }, onSelect: fn('onSelect'), selected: false },
        next: { product: { id: 1, name: 'Keyboard', price: 49 }, style: { color: 'red' }, onSelect: fn('onSelect'), selected: false },
      },
      propChanges: [
        { path: 'style', kind: 'deep-equal', prev: { color: 'red' }, next: { color: 'red' } },
        { path: 'onSelect', kind: 'function', prev: fn('onSelect'), next: fn('onSelect') },
      ],
      stateChanges: [], hookChanges: [],
      reasons: [
        'caused by <ProductPage> re-rendering (its state changed).',
        'prop "style" is a new reference but deep-equal to the previous value: memoize the object with useMemo, or hoist it to module scope if it is constant.',
        'prop "onSelect" is a new function instance on every render: wrap it in useCallback (or hoist it out of the parent\'s render).',
      ],
    },
    {
      component: 'Toolbar', path: ['App', 'ProductPage'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 2, commitId: 1, memoized: false, commitPriority: 'immediate',
      owner: 'ProductPage', parent: { name: 'ProductPage', trigger: 'state' }, selfDuration: 0.3,
      props: { prev: { title: 'Products', count: 3 }, next: { title: 'Products', count: 3 } }, propChanges: [], stateChanges: [], hookChanges: [],
      reasons: ['re-rendered with identical props because <ProductPage> re-rendered (its state changed). Wrap "Toolbar" in React.memo (or extend PureComponent).'],
    },
    {
      component: 'ProductPage', path: ['App'], trigger: 'state', avoidable: false, renderCount: 1, instanceId: 3, commitId: 1, memoized: false,
      owner: 'App', parent: null,
      props: { prev: { placeholder: 'Search', filters: { sort: 'asc', page: 1 } }, next: { placeholder: 'Search', filters: { sort: 'asc', page: 2 } } },
      propChanges: [{ path: 'filters', kind: 'different', prev: { sort: 'asc', page: 1 }, next: { sort: 'asc', page: 2 } }], stateChanges: [],
      hookChanges: [{ path: 'useState#0', hook: 'useState', index: 0, kind: 'different', prev: 'ab', next: 'abc' }], reasons: ['useState #0 changed.'],
      hookState: [
        { path: 'useState#0', hook: 'useState', index: 0, value: 'abc' },
        { path: 'useState#1', hook: 'useState', index: 1, value: 3 },
        { path: 'useReducer#3', hook: 'useReducer', index: 3, value: { cart: [1, 2], open: false } },
      ],
      contexts: [{ name: 'Theme', value: { mode: 'light', user: 'ann' } }],
    },
    {
      component: 'Sidebar', path: ['App'], trigger: 'hooks', avoidable: false, renderCount: 1, instanceId: 5, owner: 'App', parent: null, commitId: 2, memoized: true, commitPriority: 'normal',
      props: { prev: {}, next: {} }, propChanges: [], stateChanges: [],
      hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: { mode: 'light', user: 'ann' }, next: { mode: 'dark', user: 'ann' }, provider: { component: 'App', path: ['App'] }, changedKeys: ['mode'], totalKeys: 2 }],
      reasons: ['useContext(Theme) changed (provided by <App>): only "mode" of 2 keys changed, yet every consumer re-renders. Split the context or memoize the slices consumers read.'],
    },
  ];
}

/** `?demo&flood=N`: N synthetic reports over ~N/10 components in a deep tree, for scale testing. */
function floodReports(n: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const components = Math.max(10, Math.floor(n / 10));
  for (let i = 0; i < n; i++) {
    const id = i % components;
    const depth = 1 + (id % 6);
    const path = ['App'];
    for (let d = 1; d < depth; d++) path.push(`Section${(id * 7 + d) % 40}`);
    const avoidable = id % 3 !== 0;
    out.push({
      component: `Item${id}`, path, trigger: avoidable ? 'parent' : 'props', avoidable, renderCount: Math.floor(i / components) + 1, instanceId: id + 1, commitId: Math.floor(i / 50) + 1,
      memoized: id % 2 === 0, owner: path[path.length - 1], parent: { name: path[path.length - 1], trigger: 'state' }, selfDuration: (id % 7) / 10,
      props: { prev: { style: { w: id }, n: i }, next: { style: { w: id }, n: i + (avoidable ? 0 : 1) } },
      propChanges: avoidable ? [{ path: 'style', kind: 'deep-equal', prev: { w: id }, next: { w: id } }] : [{ path: 'n', kind: 'different', prev: i, next: i + 1 }],
      stateChanges: [], hookChanges: [], reasons: [avoidable ? 'prop "style" is a new reference but deep-equal to the previous value.' : 'prop "n" changed.'],
    });
  }
  return out;
}

// ---------- boot: BroadcastChannel (panel served by the Vite plugin, no extension) ----------
/**
 * Same-origin transport over a `BroadcastChannel`: the app's `createDevtoolsNotifier({ channel })`
 * publishes reports on it and answers commands. Storage is `localStorage`, the origin is ours.
 */
function createBroadcastTransport(name: string): Transport {
  let listener: ((m: Message) => void) | null = null;
  let channel: BroadcastChannel | null = null;
  const emit = (m: Message): void => {
    if (listener) listener(m);
  };
  const open = (): BroadcastChannel => {
    if (channel) return channel;
    channel = new BroadcastChannel(name);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || reply(data)) return;
      if (data.__rerenderLens === true && typeof data.type === 'string') emit({ type: data.type, version: typeof data.version === 'number' ? data.version : undefined, payload: data.payload });
    };
    return channel;
  };
  // 1.5 s without an answer: no app tab with the library on this channel.
  const { bridge, reply } = commandBridge((message) => open().postMessage(message), 1500);
  const transport: Transport = {
    origin: location.origin,
    tabLabel: `channel "${name}"`,
    subscribe(fn) {
      listener = fn;
      open();
      fn({ type: 'connected' });
      void bridge<HelloPayload>('info').then(async (info) => {
        if (!info) {
          fn({ type: 'disconnected' });
          return;
        }
        fn({ type: 'hello', version: info.protocol, payload: info });
        const res = await bridge<{ reports: unknown[] }>('pull', 0);
        if (res) for (const p of res.reports) fn({ type: 'report', payload: p });
      });
    },
    replay: () => void bridge('replay'),
    clear: () => void bridge('clear'),
    configure: (options) => bridge<SerializableOptions>('configure', options).then((r) => r ?? undefined),
    highlight: (id) => bridge('highlight', id).catch(() => {}),
    flashAvoidable: (on) => bridge('flash', !!on).catch(() => {}),
    storage: localStorageAdapter(`rerender-lens:${name}`),
    readSource: fetchSource,
    copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
  };
  return transport;
}

// ---------- boot: relay server (npx rerender-lens panel; any app, any origin) ----------
interface EventSourceLike {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  close(): void;
}
type EventSourceCtor = new (url: string) => EventSourceLike;

/** Transport over the relay: reports arrive on an SSE stream, commands go out as POSTs and are answered on the stream. */
function createRelayClientTransport(relayUrl: string, ES: EventSourceCtor = EventSource as unknown as EventSourceCtor): Transport {
  const base = relayUrl.replace(/\/$/, '');
  let listener: ((m: Message) => void) | null = null;
  let stream: EventSourceLike | null = null;
  let appsOnline: number | null = null;
  const emit = (m: Message): void => {
    if (listener) listener(m);
  };
  const post = (message: unknown): Promise<void> => fetch(`${base}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) }).then(() => undefined);
  const { bridge, reply } = commandBridge(post, 2000);
  const handleData = (data: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!isRecord(m) || reply(m)) continue;
      if (m.__rerenderLens === true && m.type === 'relay') {
        const apps = isRecord(m.payload) && typeof m.payload.apps === 'number' ? m.payload.apps : 0;
        const wasOnline = appsOnline;
        appsOnline = apps;
        if (apps > 0 && wasOnline !== null && wasOnline === 0) void attach();
        else if (apps === 0) emit({ type: 'disconnected' });
      } else if (m.__rerenderLens === true && typeof m.type === 'string') emit({ type: m.type, version: typeof m.version === 'number' ? m.version : undefined, payload: m.payload });
    }
  };
  async function attach(): Promise<void> {
    const info = await bridge<HelloPayload>('info');
    if (!info) {
      emit({ type: 'disconnected' });
      return;
    }
    emit({ type: 'connected' });
    emit({ type: 'hello', version: info.protocol, payload: info });
    const res = await bridge<{ reports: unknown[] }>('pull', 0);
    if (res) for (const p of res.reports) emit({ type: 'report', payload: p });
  }
  const transport: Transport = {
    origin: base,
    tabLabel: `relay ${base.replace(/^https?:\/\//, '')}`,
    subscribe(fn) {
      listener = fn;
      const open = (): void => {
        stream = new ES(`${base}/events?role=panel`);
        stream.onmessage = (e) => handleData(e.data);
        stream.onerror = () => {
          emit({ type: 'disconnected' });
        };
      };
      open();
      void attach();
    },
    replay: () => void bridge('replay'),
    clear: () => void bridge('clear'),
    configure: (options) => bridge<SerializableOptions>('configure', options).then((r) => r ?? undefined),
    highlight: (id) => bridge('highlight', id).catch(() => {}),
    flashAvoidable: (on) => bridge('flash', !!on).catch(() => {}),
    storage: localStorageAdapter(`rerender-lens:relay:${base}`),
    readSource: fetchSource,
    copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
  };
  return transport;
}

function bootRelay(relayUrl: string): Panel {
  return createPanel(document.getElementById('root')!, createRelayClientTransport(relayUrl), { theme: systemTheme() });
}

function bootBroadcast(name: string): Panel {
  return createPanel(document.getElementById('root')!, createBroadcastTransport(name), { theme: systemTheme() });
}

function bootDemo(): void {
  const params = new URLSearchParams(location.search);
  const flood = Number(params.get('flood') || 0);
  const sample = sampleReports();
  let i = 0;
  let commit = 0;
  const mem: Record<string, unknown> = {};
  const transport: Transport = {
    origin: 'http://localhost:5199',
    subscribe(fn) {
      fn({ type: 'connected' });
      fn({ type: 'hello', version: PROTOCOL, payload: { library: 'demo', protocol: PROTOCOL, react: [{ version: '19.2.0', bundleType: 1 }], production: false, enabled: true, options: { trackAllMemoized: true, silent: true }, source: 'page', injected: false } });
      if (flood > 0) {
        const t0 = performance.now();
        for (const r of floodReports(flood)) fn({ type: 'report', payload: r });
        requestAnimationFrame(() => console.log(`[rerender-lens demo] ${flood} reports ingested and rendered in ${(performance.now() - t0).toFixed(0)} ms`));
        return;
      }
      const tick = (): void => {
        const r = JSON.parse(JSON.stringify(sample[i % sample.length])) as Record<string, unknown>;
        r.renderCount = Math.floor(i / sample.length) + 1;
        if (i % sample.length === 0) commit++;
        r.commitId = commit + (r.commitId === 2 ? 100 : 0);
        fn({ type: 'report', payload: r });
        i++;
        if (i < 14) setTimeout(tick, i < 4 ? 50 : 900);
      };
      tick();
    },
    replay() {},
    clear() {},
    configure: (o) => Promise.resolve(o),
    highlight() {},
    flashAvoidable() {},
    originStatus: () => Promise.resolve({ origin: 'http://localhost:5199', builtIn: true, permitted: true, enabled: true, inject: false, deferHook: false }),
    setOrigin: () => Promise.resolve(),
    storage: { get: (k) => Promise.resolve(mem[k]), set: (k, v) => Promise.resolve((mem[k] = v)) },
    readSource: () => Promise.resolve("import { memo } from 'react';\n\nexport const ProductList = memo(function ProductList(props) {\n  const [selected, setSelected] = useState(null);\n  return (\n    <ul>\n      {props.products.map((p) => (\n        <ProductRow key={p.id} product={p} style={{ color: 'red' }} onSelect={(id) => props.onSelect(id)} />\n      ))}\n    </ul>\n  );\n});\n"),
  };
  createPanel(document.getElementById('root')!, transport, { theme: /theme=dark/.test(location.search) ? 'dark' : systemTheme() });
}

const api = {
  PROTOCOL,
  createPanel,
  summarize,
  valueNode,
  reportView,
  fixView,
  normalizeReport,
  reportToMarkdown,
  sampleReports,
  floodReports,
  bootStandalone,
  bootBroadcast,
  bootRelay,
  createRelayTransport,
  createBroadcastTransport,
  createRelayClientTransport,
  sourceContext,
  analysis: { firstDifferentPath, diffLeaves, fixesFor, rankFixes, rootCauseOf, analyzeCommit, contextAttribution, cascadeTree, rootCauseSummary, summarizeSession, compareSessions },
};
window.RerenderLensPanel = api;

const hasChrome = typeof chrome !== 'undefined' && !!chrome && !!chrome.runtime && !!chrome.runtime.id;
const hasDevtools = hasChrome && !!chrome.devtools && !!chrome.devtools.inspectedWindow;
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const pathname = typeof location !== 'undefined' ? String(location.pathname) : '';
if (params.has('relay') && typeof EventSource === 'function') bootRelay(params.get('relay') || location.origin);
else if (params.has('channel') && typeof BroadcastChannel === 'function') bootBroadcast(params.get('channel') || 'rerender-lens');
else if (hasDevtools && /panel\.html/.test(pathname) && !params.has('tabId')) bootExtension();
else if (hasChrome && (/sidepanel\.html/.test(pathname) || params.has('tabId'))) bootStandalone({ tabId: params.has('tabId') ? Number(params.get('tabId')) : null });
else if (params.has('demo')) bootDemo();
