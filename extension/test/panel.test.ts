import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'panel.js'), 'utf8');

interface Transport {
  subscribe(fn: (m: unknown) => void): void;
  replay(): void;
  clear(): void;
  cleared: number;
  replayed: number;
  [k: string]: unknown;
}

function makeTransport(extra: Record<string, unknown> = {}): Transport {
  return {
    subscribe() {},
    replay() {
      this.replayed++;
    },
    clear() {
      this.cleared++;
    },
    cleared: 0,
    replayed: 0,
    ...extra,
  };
}

const report = (over: Record<string, unknown> = {}) => ({
  component: 'Row', path: ['App', 'List'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 1, commitId: 1,
  owner: 'List', parent: { name: 'App', trigger: 'state' },
  props: { prev: { style: { a: 1 }, n: 1 }, next: { style: { a: 1 }, n: 1 } },
  propChanges: [{ path: 'style', kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 } }],
  stateChanges: [], hookChanges: [], reasons: ['caused by <App> re-rendering (its state changed).', 'prop "style" ...'],
  ...over,
});

interface Panel {
  state: { reports: unknown[]; selectedKey: string | null; paused: boolean; view: string; tab: string; library: unknown; relay: boolean; flashOn: boolean; recording: unknown; sessions: { name: string }[]; sort: { key: string; dir: number }; columns: string[]; notes: Record<string, { note?: string; muted?: boolean }> };
  handle(m: unknown): void;
  flush(): void;
  select(name: string): void;
  clearAll(): void;
  setView(v: string): void;
  importData(d: unknown): number;
  openSettings(): void;
  startRecording(name?: string): { id: string; name: string };
  stopRecording(): { id: string; name: string; avoidable: number; fixes: { label: string }[] } | null;
  setNote(component: string, note: { note?: string; muted?: boolean }): void;
}
interface Fix { kind: string; owner: string; prop: string | null; label: string; detail: string; snippet: string; count?: number; key?: string }
interface Factory {
  PROTOCOL: number;
  createPanel(root: HTMLElement, t: Transport, o?: object): Panel;
  valueNode(v: unknown): HTMLElement;
  normalizeReport(p: unknown): Record<string, unknown> | null;
  reportToMarkdown(r: unknown): string;
  sampleReports(): Record<string, unknown>[];
  floodReports(n: number): Record<string, unknown>[];
  encodeShare(r: unknown): Promise<string>;
  decodeShare(code: string): Promise<unknown>;
  sourceContext(text: string, line: number, around?: number): { n: number; text: string; hit: boolean }[];
  analysis: {
    firstDifferentPath(a: unknown, b: unknown): string | null;
    diffLeaves(a: unknown, b: unknown, limit?: number): { path: string; prev: unknown; next: unknown }[];
    rootCauseSummary(name: string, commits: Iterable<[number, unknown[]]>): { total: number; commits: { key: number }[]; trigger: string };
    fixesFor(r: unknown): Fix[];
    rankFixes(rs: unknown[]): Fix[];
    rootCauseOf(r: unknown, rs: unknown[]): { name: string; trigger: string } | null;
    analyzeCommit(rs: unknown[]): { avoidable: number; roots: { name: string; trigger: string; count: number }[]; contexts: { name: string; consumers: number }[] };
    contextAttribution(rs: unknown[]): { name: string; consumers: number; avoidable: number }[];
  };
}

/** Visible tree names in visual order (virtual rows are absolutely positioned and reused, so DOM order is not visual order). */
const names = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.row')]
    .sort((a, b) => parseInt(a.style.top || '0', 10) - parseInt(b.style.top || '0', 10))
    .map((n) => n.querySelector('.name')!.textContent);
const buttons = (root: HTMLElement, sel: string) => [...root.querySelectorAll(sel)] as HTMLButtonElement[];
const button = (root: HTMLElement, sel: string, text: string) => buttons(root, sel).find((b) => b.textContent!.includes(text))!;

describe('devtools panel', () => {
  let factory: Factory;
  let root: HTMLElement;
  let panel: Panel;
  let transport: Transport;
  const send = (m: unknown) => {
    panel.handle(m);
    panel.flush();
  };
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.className = '';
    root = document.getElementById('root')!;
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
    transport = makeTransport();
    panel = factory.createPanel(root, transport);
  });

  it('renders an empty state and the three connection states', () => {
    expect(root.querySelector('.tree .empty')!.textContent).toMatch(/No re-renders/);
    expect(root.querySelector('.status-text')!.textContent).toBe('no page');
    panel.handle({ type: 'connected' });
    expect(root.querySelector('.status-text')!.textContent).toBe('no library in page');
    expect(root.querySelector('.status')!.classList.contains('partial')).toBe(true);
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [{ version: '19.2.0', bundleType: 1 }], production: false, enabled: true, options: {} } });
    expect(root.querySelector('.status-text')!.textContent).toBe('connected · lib 0.2.0 · React 19.2.0');
    expect(root.querySelector('.status')!.classList.contains('connected')).toBe(true);
    expect((root.querySelector('.banner') as HTMLElement).hidden).toBe(true);
    panel.handle({ type: 'disconnected' });
    expect(root.querySelector('.status-text')!.textContent).toBe('no page');
  });

  it('warns about protocol mismatch and production builds', () => {
    panel.handle({ type: 'connected' });
    panel.handle({ type: 'hello', version: 1, payload: { count: 0 } });
    const banner = root.querySelector('.banner') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toMatch(/protocol 1.*expects protocol 2/);
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [{ version: '18.3.1', bundleType: 0 }], production: true, enabled: true, options: {} } });
    expect(banner.textContent).toMatch(/Production React build/);
    expect(root.querySelector('.status-text')!.textContent).toContain('(prod)');
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [], production: false, enabled: true, options: {}, source: 'page', injected: true } });
    expect(banner.textContent).toMatch(/runs its own rerender-lens.*stepped aside/);
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [], production: false, enabled: true, options: {}, source: 'extension', injected: true } });
    expect(banner.hidden).toBe(true);
  });

  it('summary strip shows totals, the top offender and the best fix, and links to them', () => {
    expect((root.querySelector('.summary') as HTMLElement).hidden).toBe(true);
    send({ type: 'report', payload: report({ selfDuration: 1.25 }) });
    send({ type: 'report', payload: report({ renderCount: 2, selfDuration: 0.75 }) });
    send({ type: 'report', payload: report({ component: 'Other', path: ['App'], avoidable: false, trigger: 'props', propChanges: [] }) });
    const summary = root.querySelector('.summary') as HTMLElement;
    expect(summary.hidden).toBe(false);
    const stats = [...summary.querySelectorAll('.stat')].map((s) => s.textContent);
    expect(stats).toEqual(['3renders', '2avoidable', '2.0 mswasted', 'top<Row>×2', 'best fixuseMemo(style) in <List>−2']);
    (summary.querySelectorAll('button.stat')[0] as HTMLElement).click();
    expect(root.querySelector('.details-header .name')!.textContent).toBe('Row');
    (summary.querySelectorAll('button.stat')[1] as HTMLElement).click();
    expect(panel.state.view).toBe('fixes');
    expect(root.querySelector('.details-header .title')!.textContent).toBe('useMemo(style) in <List>');
    panel.clearAll();
    expect(summary.hidden).toBe(true);
  });

  it('toolbar buttons keep their labels; undock buttons appear only with a transport that supports it', () => {
    expect([...root.querySelectorAll('.toolbar .ib .label')].map((l) => l.textContent)).toEqual(['Pause', 'Clear', 'Replay', 'Record', 'Export', 'Import', 'Settings']);
    const calls: unknown[] = [];
    panel = factory.createPanel(root, makeTransport({ undock: (mode: string) => (calls.push(mode), Promise.resolve()) }));
    const labels = [...root.querySelectorAll('.toolbar .ib .label')].map((l) => l.textContent);
    expect(labels).toContain('Side panel');
    expect(labels).toContain('Window');
    button(root, '.toolbar .ib', 'Side panel').click();
    button(root, '.toolbar .ib', 'Window').click();
    expect(calls).toEqual(['sidepanel', 'window']);
  });

  it('shows memoization and self/tree time on a report', () => {
    send({ type: 'report', payload: report({ memoized: false, selfDuration: 0.4, treeDuration: 2.5 }) });
    panel.select('Row');
    expect(root.textContent).toContain('Not memoized');
    expect(root.textContent).toContain('0.4 ms self, 2.5 ms with children');
  });

  it('builds a tree from report paths with avoidable badges and selects the latest report', () => {
    send({ type: 'report', payload: report() });
    send({ type: 'report', payload: report({ renderCount: 2 }) });
    send({
      type: 'report',
      payload: report({ component: 'Other', path: ['App'], avoidable: false, trigger: 'props', propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }] }),
    });
    expect(names(root)).toEqual(['App', 'List', 'Row', 'Other']);
    const rowRow = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.name')!.textContent === 'Row')!;
    expect(rowRow.querySelector('.badge.avoid')!.textContent).toBe('2');
    (rowRow as HTMLElement).click();
    expect(root.querySelector('.details-header .name')!.textContent).toBe('Row');
    expect(root.querySelector('.details-header .meta')!.textContent).toBe('2 re-renders, 2 avoidable');
    expect(root.querySelector('.verdict')!.textContent).toBe('Avoidable re-render');
    expect(root.textContent).toContain('Triggered by <App> (state)');
    expect(root.textContent).toContain('Created by <List>');
    expect(root.querySelector('.kv tr.changed td.k')!.textContent).toBe('style');
    expect(root.querySelector('.kv tr.changed .kind')!.textContent).toBe('equal by value');
    // a live update while selected keeps showing the newest report
    send({ type: 'report', payload: report({ renderCount: 3, propChanges: [], reasons: ['identical props'] }) });
    expect(root.querySelector('.details-header .meta')!.textContent).toBe('3 re-renders, 3 avoidable');
    expect(root.textContent).toContain('identical props');
  });

  it('batches reports until flush and ignores malformed payloads', () => {
    panel.handle({ type: 'report', payload: report() });
    panel.handle({ type: 'report', payload: { nope: true } });
    panel.handle({ type: 'report', payload: null });
    panel.handle({ type: 'report' });
    panel.handle({ type: 'report', payload: report({ component: 'B', propChanges: 'garbage', path: 'not-an-array', reasons: [1, 'ok'] }) });
    expect(panel.state.reports).toHaveLength(0);
    expect(names(root)).toEqual([]);
    panel.flush();
    expect(panel.state.reports).toHaveLength(2);
    expect(names(root)).toEqual(['App', 'List', 'Row', 'B']);
    const b = panel.state.reports[1] as { propChanges: unknown[]; path: string[]; reasons: string[] };
    expect(b.propChanges).toEqual([]);
    expect(b.path).toEqual([]);
    expect(b.reasons).toEqual(['ok']);
  });

  it('filters by text and regex, and by avoidable only', () => {
    send({ type: 'report', payload: report() });
    send({ type: 'report', payload: report({ component: 'Other', path: ['App'], avoidable: false, trigger: 'props' }) });
    const search = root.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'oth';
    search.dispatchEvent(new Event('input'));
    expect(names(root)).toEqual(['App', 'Other']);
    search.value = '/^r/i';
    search.dispatchEvent(new Event('input'));
    expect(names(root)).toEqual(['App', 'List', 'Row']);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const check = root.querySelector('.toolbar input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(names(root)).toEqual(['App', 'List', 'Row']);
    expect(root.querySelector('.stream .count')!.textContent).toBe('1 report');
  });

  it('pauses, clears (also asking the page) and shows history', () => {
    send({ type: 'report', payload: report() });
    button(root, '.toolbar button', 'Pause').click();
    send({ type: 'report', payload: report({ renderCount: 2 }) });
    expect(panel.state.reports).toHaveLength(1);
    button(root, '.toolbar button', 'Resume').click();
    send({ type: 'report', payload: report({ renderCount: 2 }) });
    expect(panel.state.reports).toHaveLength(2);
    panel.select('Row');
    button(root, '.tabs button', 'History').click();
    expect(root.querySelectorAll('.history li')).toHaveLength(2);
    (root.querySelector('.history li:last-child') as HTMLElement).click();
    expect(root.textContent).toContain('#1');
    button(root, '.toolbar button', 'Clear').click();
    expect(transport.cleared).toBe(1);
    expect(panel.state.reports).toHaveLength(0);
    expect(root.querySelector('.tree .empty')).not.toBeNull();
  });

  it('renders serialized values with types', () => {
    expect(factory.valueNode('ƒ onClick').className).toBe('v fn');
    expect(factory.valueNode('<Icon>').textContent).toBe('<Icon>');
    expect(factory.valueNode('x').textContent).toBe('"x"');
    expect(factory.valueNode(3).className).toBe('v num');
    expect(factory.valueNode(null).textContent).toBe('null');
    expect(factory.valueNode([1, 2]).textContent).toBe('[1, 2]');
    expect(factory.valueNode({ $type: 'Map', entries: [['a', 1]] }).querySelector('summary')!.textContent).toBe('Map(1)');
    expect(factory.valueNode({ a: 1, b: 2 }).querySelector('summary')!.textContent).toBe('{a, b}');
  });

  it('shows the fix tab with a snippet, source link, highlight and markdown copy', () => {
    const calls: unknown[] = [];
    transport = makeTransport({
      openResource: (...a: unknown[]) => calls.push(['open', ...a]),
      highlight: (id: unknown) => calls.push(['highlight', id]),
      copy: (text: string) => calls.push(['copy', text]),
    });
    panel = factory.createPanel(root, transport);
    send({ type: 'report', payload: report({ source: { fileName: 'http://localhost:5199/src/List.tsx?t=1', lineNumber: 12, columnNumber: 5 }, propChanges: [{ path: 'onSelect', kind: 'function', prev: 'ƒ onSelect', next: 'ƒ onSelect' }] }) });
    panel.select('Row');
    button(root, '.actions button', 'List.tsx:12').click();
    expect(calls[0]).toEqual(['open', 'http://localhost:5199/src/List.tsx?t=1', 12, 5]);
    button(root, '.actions button', 'Highlight').click();
    expect(calls[1]).toEqual(['highlight', 1]);
    button(root, '.actions button', 'Markdown').click();
    expect((calls[2] as string[])[1]).toContain('### <Row> avoidable re-render #1');
    expect((calls[2] as string[])[1]).toContain('| onSelect | new function |');
    // hovering a tree row highlights the instance in the page; leaving clears it
    const row = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.name')!.textContent === 'Row') as HTMLElement;
    row.dispatchEvent(new Event('mouseenter'));
    row.dispatchEvent(new Event('mouseleave'));
    expect(calls.slice(3)).toEqual([
      ['highlight', 1],
      ['highlight', null],
    ]);
    button(root, '.tabs button', 'Fix').click();
    expect(root.querySelector('.section.fix h3')!.textContent).toBe('useCallback(onSelect) in <List>');
    expect(root.querySelector('.snippet')!.textContent).toContain('const onSelect = useCallback(');
  });

  it('offenders view aggregates by component and sorts', () => {
    send({ type: 'report', payload: report() });
    send({ type: 'report', payload: report({ renderCount: 2, selfDuration: 1.5 }) });
    send({ type: 'report', payload: report({ component: 'Big', path: ['App'], avoidable: false, trigger: 'props', propChanges: [] }) });
    send({ type: 'report', payload: report({ component: 'Big', path: ['App', 'Other'], avoidable: false, trigger: 'props', propChanges: [] }) });
    send({ type: 'report', payload: report({ component: 'Big', path: ['App', 'Other'], avoidable: false, trigger: 'props', propChanges: [], renderCount: 2 }) });
    panel.setView('offenders');
    const cells = (col: number) => [...root.querySelectorAll('.grid tbody tr')].map((tr) => tr.children[col]!.textContent);
    expect(cells(0)).toEqual(['Row', 'Big ×2 places']);
    expect(cells(1)).toEqual(['2', '0']);
    expect(cells(2)).toEqual(['2', '3']);
    expect(cells(3)[0]).toBe('1.5 ms');
    expect(cells(4)[0]).toBe('useMemo(style) in <List>');
    button(root, '.grid th', 'Total').click();
    expect(cells(0)).toEqual(['Big ×2 places', 'Row']);
    button(root, '.grid th', 'Total').click();
    expect(cells(0)).toEqual(['Row', 'Big ×2 places']);
    (root.querySelector('.grid tbody tr') as HTMLElement).click();
    expect(root.querySelector('.details-header .name')!.textContent).toBe('Row');
    expect(panel.state.tab).toBe('fix');
  });

  it('commits view groups by commitId, finds root causes and draws the cascade', () => {
    const page = report({ component: 'Page', path: ['App'], trigger: 'state', avoidable: false, parent: null, owner: 'App', propChanges: [], hookChanges: [{ path: 'useState#0', hook: 'useState', index: 0, kind: 'different', prev: 1, next: 2 }] });
    const list = report({ component: 'List', path: ['App', 'Page'], parent: { name: 'Page', trigger: 'state' }, owner: 'Page', propChanges: [] });
    const row = report({ path: ['App', 'Page', 'List'], parent: { name: 'List', trigger: 'parent' }, owner: 'List' });
    send({ type: 'report', payload: page });
    send({ type: 'report', payload: list });
    send({ type: 'report', payload: row });
    send({ type: 'report', payload: report({ ...row, commitId: 2, renderCount: 2 }) });
    panel.setView('commits');
    const items = [...root.querySelectorAll('.commits li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('.id')!.textContent).toBe('#2');
    expect(items[1]!.textContent).toContain('3 renders');
    expect(items[1]!.textContent).toContain('2 avoidable');
    expect(items[1]!.querySelector('.root')!.textContent).toBe('← <Page> (state)');
    (items[1] as HTMLElement).click();
    expect(root.querySelector('.details-header .title')!.textContent).toBe('Commit #1');
    expect(root.querySelector('.roots li')!.textContent).toContain('<Page> (state) → 2 avoidable re-renders');
    const cascade = [...root.querySelectorAll('.cascade-row')].map((r) => r.className.replace('cascade-row ', '') + ':' + r.querySelector('.name')!.textContent);
    expect(cascade).toEqual(['untracked:App', 'ok:Page', 'avoid:List', 'avoid:Row']);
    (root.querySelectorAll('.cascade-row')[3] as HTMLElement).click();
    expect(root.querySelector('.details-header .name')!.textContent).toBe('Row');
  });

  it('fixes view ranks fixes by renders removed and attributes context changes', () => {
    send({ type: 'report', payload: report() });
    send({ type: 'report', payload: report({ renderCount: 2 }) });
    send({ type: 'report', payload: report({ component: 'Toolbar', path: ['App'], owner: 'App', propChanges: [], reasons: [] }) });
    send({ type: 'report', payload: report({ component: 'Themed', path: ['App'], avoidable: false, trigger: 'hooks', propChanges: [], hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: 'a', next: 'b' }] }) });
    send({ type: 'report', payload: report({ component: 'Themed2', path: ['App'], trigger: 'parent', propChanges: [], hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 } }] }) });
    panel.setView('fixes');
    const fixes = [...root.querySelectorAll('.fixes li .label')].map((n) => n.textContent);
    // ties (1 render each) sort by label
    expect(fixes).toEqual(['useMemo(style) in <List>', 'memoize the Theme provider value', 'Wrap <Toolbar> in React.memo']);
    expect(root.querySelector('.fixes li .badge')!.textContent).toBe('2');
    expect(root.querySelector('.contexts li')!.textContent).toContain('Theme changed in 1 commit, 2 consumer re-renders, 1 with an equal value');
    (root.querySelector('.fixes li') as HTMLElement).click();
    expect(root.querySelector('.details-header .title')!.textContent).toBe('useMemo(style) in <List>');
    expect(root.querySelectorAll('.history li')).toHaveLength(2);
  });

  it('imports an export and restores persisted panel state', async () => {
    const store: Record<string, unknown> = { panel: { filter: 'Row', avoidableOnly: true, view: 'offenders', streamCollapsed: true, collapsed: ['App'], flashOn: true } };
    const flashes: unknown[] = [];
    transport = makeTransport({
      storage: { get: (k: string) => Promise.resolve(store[k]), set: (k: string, v: unknown) => Promise.resolve((store[k] = v)) },
      flashAvoidable: (on: boolean) => flashes.push(on),
    });
    panel = factory.createPanel(root, transport);
    await Promise.resolve();
    await Promise.resolve();
    expect((root.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('Row');
    expect(panel.state.view).toBe('offenders');
    expect(panel.state.flashOn).toBe(true);
    expect(root.querySelector('.stream')!.classList.contains('collapsed')).toBe(true);
    const n = panel.importData({ rerenderLens: true, reports: [report(), { junk: 1 }, report({ component: 'Other', path: ['App'] })] });
    expect(n).toBe(2);
    expect(panel.state.reports).toHaveLength(2);
    panel.setView('tree');
    // 'App' was persisted as collapsed, so only the root row shows
    expect(names(root)).toEqual(['App']);
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [], production: false, enabled: true, options: {} } });
    expect(flashes).toEqual([true]);
  });

  it('settings drawer applies library options through the transport and persists them', async () => {
    const configured: unknown[] = [];
    const store: Record<string, unknown> = {};
    const originCalls: unknown[] = [];
    transport = makeTransport({
      configure: (o: unknown) => {
        configured.push(o);
        return Promise.resolve({ trackAllMemoized: true, ...(o as object) });
      },
      storage: { get: (k: string) => Promise.resolve(store[k]), set: (k: string, v: unknown) => Promise.resolve((store[k] = v)) },
      originStatus: () => Promise.resolve({ origin: 'http://localhost:5199', builtIn: true, permitted: true, enabled: true, inject: false }),
      setOrigin: (cfg: unknown) => {
        originCalls.push(cfg);
        return Promise.resolve();
      },
      origin: 'http://localhost:5199',
    });
    panel = factory.createPanel(root, transport);
    panel.handle({ type: 'hello', version: 2, payload: { library: '0.2.0', protocol: 2, react: [], production: false, enabled: true, options: { trackAllMemoized: true } } });
    panel.openSettings();
    await new Promise((r) => setTimeout(r, 0));
    const drawer = root.querySelector('.drawer') as HTMLElement;
    expect(drawer.hidden).toBe(false);
    expect(drawer.textContent).toContain('http://localhost:5199');
    const opt = (label: string) => [...drawer.querySelectorAll('label.opt')].find((l) => l.textContent!.includes(label))!.querySelector('input') as HTMLInputElement;
    expect(opt('Track every React.memo').checked).toBe(true);
    const all = opt('Track every component');
    all.checked = true;
    all.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(configured).toEqual([{ trackAllComponents: true }]);
    expect(store.settings).toEqual({ trackAllMemoized: true, trackAllComponents: true });
    const inject = opt('Inject the library');
    inject.checked = true;
    inject.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(originCalls).toEqual([{ enabled: true, inject: true, deferHook: false }]);
  });
});

describe('scale and navigation', () => {
  let factory: Factory;
  let root: HTMLElement;
  let panel: Panel;
  let calls: unknown[];
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root')!;
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
    calls = [];
    panel = factory.createPanel(root, makeTransport({ highlight: (id: unknown) => calls.push(['highlight', id]) }));
  });

  it('virtualizes the tree and the stream: 3000 nodes keep the DOM small and scrolling reveals the rest', () => {
    for (const r of factory.floodReports(3000)) panel.handle({ type: 'report', payload: r });
    panel.flush();
    expect(panel.state.reports).toHaveLength(2000); // MAX_REPORTS ring
    const rows = root.querySelectorAll('.row').length;
    expect(rows).toBeGreaterThan(10);
    expect(rows).toBeLessThan(100);
    const inner = root.querySelector('.tree .virtual-inner') as HTMLElement;
    const totalRows = parseInt(inner.style.height, 10) / 22;
    expect(totalRows).toBeGreaterThan(300);
    expect(root.querySelectorAll('.stream-item').length).toBeLessThan(100);
    expect(root.querySelector('.stream .count')!.textContent).toBe('2000 reports');
    // scrolling the tree moves the window; the first mounted row is no longer at the top
    const tree = root.querySelector('.tree') as HTMLElement;
    tree.scrollTop = 22 * 200;
    tree.dispatchEvent(new Event('scroll'));
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        const tops = [...root.querySelectorAll<HTMLElement>('.row')].map((r) => parseInt(r.style.top, 10));
        expect(Math.min(...tops)).toBeGreaterThan(22 * 100);
        // selecting a row far down scrolls it into view
        panel.select('Item150');
        expect(root.querySelector('.details-header .name')!.textContent).toBe('Item150');
        resolve();
      }),
    );
  });

  it('keyboard: / focuses search, f opens the fix tab, Esc clears the highlight and leaves the search box', () => {
    panel.handle({ type: 'report', payload: report() });
    panel.flush();
    const search = root.querySelector('input[type="search"]') as HTMLInputElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(search);
    // typing '/' inside the box must not be swallowed
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    search.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).not.toBe(search);
    expect(calls).toEqual([['highlight', null]]);
    panel.select('Row');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(panel.state.tab).toBe('fix');
    expect(root.querySelector('.section.fix h3')!.textContent).toBe('useMemo(style) in <List>');
  });

  it('shows the differing leaves of a changed object prop', () => {
    panel.handle({
      type: 'report',
      payload: report({
        avoidable: false,
        trigger: 'props',
        props: { prev: { filters: { sort: 'asc', page: 1, tags: ['a'] } }, next: { filters: { sort: 'asc', page: 2, tags: ['a', 'b'] } } },
        propChanges: [{ path: 'filters', kind: 'different', prev: { sort: 'asc', page: 1, tags: ['a'] }, next: { sort: 'asc', page: 2, tags: ['a', 'b'] } }],
      }),
    });
    panel.flush();
    panel.select('Row');
    expect(root.querySelector('.kv tr.changed .kind')!.textContent).toBe('changed at filters.page');
    expect(root.querySelector('details.diff summary')!.textContent).toBe('2 differing leaves');
    expect([...root.querySelectorAll('.kv.leaves td.k')].map((n) => n.textContent)).toEqual(['filters.page', 'filters.tags[1]']);
  });

  it('root-cause page lists every commit a component started and the fixes for them', () => {
    const page = (commitId: number) => report({ component: 'Page', path: ['App'], trigger: 'state', avoidable: false, parent: null, owner: 'App', propChanges: [], commitId });
    const row = (commitId: number, n: number) => report({ path: ['App', 'Page'], parent: { name: 'Page', trigger: 'state' }, owner: 'Page', commitId, renderCount: n });
    for (const p of [page(1), row(1, 1), page(2), row(2, 2), report({ component: 'Other', path: ['App'], parent: { name: 'App', trigger: 'state' }, commitId: 3 })]) {
      panel.handle({ type: 'report', payload: p });
    }
    panel.flush();
    panel.setView('commits');
    (root.querySelector('.commits li:last-child') as HTMLElement).click(); // commit #1
    expect(root.querySelector('.details-header .title')!.textContent).toBe('Commit #1');
    (root.querySelector('.roots .root-link') as HTMLElement).click();
    expect(panel.state.tab).toBe('root');
    expect(root.querySelector('.details-header .title')!.textContent).toBe('Root cause <Page>');
    expect(root.querySelector('.details-header .meta')!.textContent).toBe('started 2 commits with 2 avoidable re-renders (state)');
    expect([...root.querySelectorAll('.root-commits .id')].map((n) => n.textContent)).toEqual(['#2', '#1']);
    expect(root.querySelector('.section.fix h3')!.textContent).toBe('useMemo(style) in <Page>');
    // a new report for that root cause refreshes the page
    panel.handle({ type: 'report', payload: page(4) });
    panel.handle({ type: 'report', payload: row(4, 3) });
    panel.flush();
    expect(root.querySelector('.details-header .meta')!.textContent).toBe('started 3 commits with 3 avoidable re-renders (state)');
    (root.querySelector('.root-commits li') as HTMLElement).click();
    expect(root.querySelector('.details-header .title')!.textContent).toBe('Commit #4');
    // clearing leaves the root tab
    panel.clearAll();
    expect(panel.state.tab).toBe('latest');
    expect(root.querySelector('.details .empty')!.textContent).toBe('Select a component to see why it re-rendered.');
  });
});

describe('sessions and deeper analysis', () => {
  let factory: Factory;
  let root: HTMLElement;
  let panel: Panel;
  let store: Record<string, unknown>;
  const send = (m: unknown) => {
    panel.handle(m);
    panel.flush();
  };
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root')!;
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
    store = {};
    panel = factory.createPanel(root, makeTransport({ storage: { get: (k: string) => Promise.resolve(store[k]), set: (k: string, v: unknown) => Promise.resolve((store[k] = v)) } }));
  });

  it('records two sessions and compares them: per-component deltas, totals, resolved fixes; summaries persist', async () => {
    const recordBtn = button(root, '.toolbar .ib', 'Record');
    recordBtn.click();
    expect(panel.state.recording).not.toBeNull();
    expect(recordBtn.querySelector('.label')!.textContent).toBe('Stop');
    send({ type: 'report', payload: report({ selfDuration: 1 }) });
    send({ type: 'report', payload: report({ renderCount: 2, selfDuration: 1 }) });
    send({ type: 'report', payload: report({ component: 'Toolbar', path: ['App'], owner: 'App', propChanges: [] }) });
    const first = panel.stopRecording()!;
    expect(first.avoidable).toBe(3);
    expect(first.fixes.map((f) => f.label)).toEqual(['useMemo(style) in <List>', 'Wrap <Toolbar> in React.memo']);
    await new Promise((r) => setTimeout(r, 0));
    expect((store.sessions as unknown[]).length).toBe(1);

    // "after the fix": Row no longer re-renders, Toolbar still does
    panel.startRecording('After memo');
    send({ type: 'report', payload: report({ component: 'Toolbar', path: ['App'], owner: 'App', propChanges: [], renderCount: 2 }) });
    send({ type: 'report', payload: report({ component: 'Row', avoidable: false, trigger: 'props', propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }] }) });
    const second = panel.stopRecording()!;
    expect(second.name).toBe('After memo');
    expect(second.avoidable).toBe(1);

    panel.setView('sessions');
    const items = [...root.querySelectorAll('.sessions li')];
    expect(items.map((li) => li.querySelector('.name')!.textContent)).toEqual(['After memo', 'Session 1']);
    (items[0] as HTMLElement).click();
    expect(panel.state.tab).toBe('session');
    expect((root.querySelector('.session-name') as HTMLInputElement).value).toBe('After memo');
    // baseline defaults to the previous session
    const select = root.querySelector('.compare-select') as HTMLSelectElement;
    expect(select.value).toBe(first.id);
    const rows = [...root.querySelectorAll('.compare-grid tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(rows[0]).toEqual(['All components', '3', '1', '-2']);
    expect(rows[1]).toEqual(['Wasted time', '2.0 ms', '0.0 ms', '-2.0 ms']);
    expect(rows.slice(2)).toEqual([
      ['Row', '2', '0', '-2'],
      ['Toolbar', '1', '1', '±0'],
    ]);
    expect(root.querySelector('.compare .meta b')!.textContent).toBe('No longer needed: ');
    expect(root.querySelector('.compare')!.textContent).toContain('useMemo(style) in <List>');
    // rename persists
    const name = root.querySelector('.session-name') as HTMLInputElement;
    name.value = 'Fixed rows';
    name.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect((store.sessions as { name: string }[]).map((s) => s.name)).toEqual(['Session 1', 'Fixed rows']);
    // a fresh panel restores the summaries and can still compare
    document.body.innerHTML = '<div id="root"></div>';
    const again = factory.createPanel(document.getElementById('root')!, makeTransport({ storage: { get: (k: string) => Promise.resolve(store[k]), set: (k: string, v: unknown) => Promise.resolve((store[k] = v)) } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(again.state.sessions.map((s) => s.name)).toEqual(['Session 1', 'Fixed rows']);
  });

  it('shows provider attribution and split advice for partial context changes', () => {
    send({
      type: 'report',
      payload: report({
        component: 'Themed', path: ['App', 'Shell'], avoidable: false, trigger: 'hooks', propChanges: [],
        hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: { mode: 'a', user: 'x' }, next: { mode: 'b', user: 'x' }, provider: { component: 'App', path: ['App'] }, changedKeys: ['mode'], totalKeys: 2 }],
      }),
    });
    panel.setView('fixes');
    const ctx = root.querySelector('.contexts li')!;
    expect(ctx.textContent).toContain('Theme (provided by <App>)');
    expect(ctx.querySelector('.hint')!.textContent).toContain('only mode of 2 keys changed');
    const fixes = factory.analysis.fixesFor(report({ component: 'Themed', avoidable: false, trigger: 'hooks', propChanges: [], hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: {}, next: {}, provider: { component: 'App', path: ['App'] }, changedKeys: ['mode'], totalKeys: 2 }] }));
    expect(fixes.map((f) => [f.kind, f.owner, f.label])).toEqual([['splitContext', 'App', 'split Theme in <App>: only mode changed']]);
    // no advice when every key changed
    expect(factory.analysis.fixesFor(report({ avoidable: false, trigger: 'hooks', propChanges: [], hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: {}, next: {}, changedKeys: ['a', 'b'], totalKeys: 2 }] }))).toEqual([]);
  });

  it('renders serialized elements with props, diffs children leaf by leaf, and suggests memoizing children', () => {
    const em = (text: string) => ({ $type: 'element', name: 'em', props: { className: 'x', children: text } });
    const node = factory.valueNode(em('hi'));
    expect(node.querySelector('summary')!.textContent).toBe('<em>');
    expect(factory.valueNode({ $type: 'element', name: 'Icon', key: 'k', props: {} }).textContent).toBe('<Icon key="k">');
    send({
      type: 'report',
      payload: report({
        component: 'Box', avoidable: false, trigger: 'props',
        props: { prev: { children: [em('hi')] }, next: { children: [em('hey')] } },
        propChanges: [{ path: 'children', kind: 'different', prev: [em('hi')], next: [em('hey')] }],
      }),
    });
    panel.select('Box');
    expect(root.querySelector('.kv tr.changed .kind')!.textContent).toBe('changed at children[0].props.children');
    expect([...root.querySelectorAll('.kv.leaves td.k')].map((n) => n.textContent)).toEqual(['children[0].props.children']);
    const fixes = factory.analysis.fixesFor(report({ component: 'Box', propChanges: [{ path: 'children', kind: 'element', prev: em('hi'), next: em('hi') }] }));
    expect(fixes.map((f) => [f.kind, f.label])).toEqual([['children', 'memoize children of <Box> in <List>']]);
    expect(fixes[0]!.snippet).toContain('useMemo');
  });

  it('shows every hook, context and state key with the changed ones as prev → next', () => {
    send({
      type: 'report',
      payload: report({
        component: 'Cart', avoidable: false, trigger: 'state', propChanges: [],
        hookChanges: [{ path: 'useState#1', hook: 'useState', index: 1, kind: 'different', prev: 2, next: 3 }],
        hookState: [
          { path: 'useState#0', hook: 'useState', index: 0, value: 'abc' },
          { path: 'useState#1', hook: 'useState', index: 1, value: 3 },
          { path: 'useReducer#3', hook: 'useReducer', index: 3, value: { open: false } },
        ],
        contexts: [{ name: 'Theme', value: { mode: 'light' } }],
      }),
    });
    panel.select('Cart');
    const sections = [...root.querySelectorAll('.section h3')].map((h) => h.textContent);
    expect(sections).toEqual(['Why did this render?', 'Rendered by', 'Props', 'Hooks', 'Contexts']);
    const hookRows = [...root.querySelectorAll('.section')].find((s) => s.querySelector('h3')!.textContent === 'Hooks')!.querySelectorAll('tr');
    expect([...hookRows].map((tr) => tr.className + ':' + tr.querySelector('td.k')!.textContent)).toEqual([':useState#0', 'changed real:useState#1', ':useReducer#3']);
    expect(hookRows[1]!.textContent).toContain('2→3');
    expect(root.textContent).toContain('Theme');
    // class state renders as its own section, with the changed key highlighted
    send({ type: 'report', payload: report({ component: 'Legacy', avoidable: false, trigger: 'state', propChanges: [], stateChanges: [{ path: 'count', kind: 'different', prev: 1, next: 2 }], state: { count: 2, label: 'x' } }) });
    panel.select('Legacy');
    expect([...root.querySelectorAll('.section h3')].map((h) => h.textContent)).toContain('State');
    expect(root.querySelector('.kv tr.changed td.k')!.textContent).toBe('count');
    expect(factory.reportToMarkdown(report({ hookState: [{ path: 'useState#0', hook: 'useState', index: 0, value: 'abc' }] }))).toContain('- useState#0: `"abc"`');
  });

  it('shows updaters, effect loops, Suspense and custom hook chains; store advice follows the chain', () => {
    send({ type: 'report', payload: report({ commitId: 1, updaters: ['Page'] }) });
    send({ type: 'report', payload: report({ commitId: 2, renderCount: 2, updaters: ['Page'], commitCause: 'effect-after-commit', afterCommit: 1 }) });
    send({ type: 'report', payload: report({ commitId: 3, renderCount: 3, avoidable: false, trigger: 'props', propChanges: [], commitCause: 'suspense-resolved' }) });
    panel.select('Row');
    expect(root.textContent).toContain('Suspense boundary resolved in this commit');
    panel.setView('commits');
    const items = [...root.querySelectorAll('.commits li')];
    expect(items[0]!.querySelector('.cause')!.textContent).toBe('suspense resolved');
    expect(items[1]!.querySelector('.cause')!.textContent).toBe('effect loop ← #1');
    expect(items[2]!.querySelector('.root')!.textContent).toBe('← <App> (state)');
    (items[1] as HTMLElement).click();
    (root.querySelector('.cascade-row.avoid') as HTMLElement).click();
    expect(root.querySelector('.section .cause.effect')!.textContent).toBe('Effect loop: state set right after commit #1');
    expect(root.textContent).toContain('Update scheduled by <Page>');
    // hook chains in the Hooks table and in changes
    send({
      type: 'report',
      payload: report({
        component: 'Cart', avoidable: true, trigger: 'parent', propChanges: [],
        hookChanges: [{ path: 'useSyncExternalStore#2', hook: 'useSyncExternalStore', index: 2, kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 }, custom: ['useSelector'] }],
        hookState: [{ path: 'useState#0', hook: 'useState', index: 0, value: 1, custom: ['useCounter', 'useCart'] }],
      }),
    });
    panel.setView('tree');
    panel.select('Cart');
    expect([...root.querySelectorAll('.kv td.k')].map((k) => k.textContent)).toContain('useCounter › useCart › useState#0');
    const fixes = factory.analysis.fixesFor(report({ component: 'Cart', propChanges: [], hookChanges: [{ path: 'useSyncExternalStore#2', hook: 'useSyncExternalStore', index: 2, kind: 'deep-equal', prev: {}, next: {}, custom: ['useSelector'] }] }));
    expect(fixes.map((f) => f.label)).toEqual(['memoize the selector in <Cart>']);
    expect(fixes[0]!.snippet).toContain('shallowEqual');
    expect(factory.analysis.fixesFor(report({ component: 'Cart', propChanges: [], hookChanges: [{ path: 'useSyncExternalStore#2', hook: 'useSyncExternalStore', index: 2, kind: 'deep-equal', prev: {}, next: {}, custom: ['useCartStore'] }] }))[0]!.snippet).toContain('useShallow');
  });

  it('groups the tree by instance when asked, using keys or ids, and remembers the choice', async () => {
    send({ type: 'report', payload: report({ instanceId: 1, key: 'a' }) });
    send({ type: 'report', payload: report({ instanceId: 2, key: 'b' }) });
    send({ type: 'report', payload: report({ component: 'Other', path: ['App'], instanceId: 3 }) });
    expect(names(root)).toEqual(['App', 'List', 'Row', 'Other']);
    const toggle = root.querySelector('.views button.instances') as HTMLButtonElement;
    toggle.click();
    expect(names(root)).toEqual(['App', 'List', 'Row key="a"', 'Row key="b"', 'Other #3']);
    expect(toggle.classList.contains('active')).toBe(true);
    // new reports land in the per-instance nodes
    send({ type: 'report', payload: report({ instanceId: 1, key: 'a', renderCount: 2 }) });
    const rowA = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.name')!.textContent === 'Row key="a"')!;
    expect(rowA.querySelector('.badge.avoid')!.textContent).toBe('2');
    toggle.click();
    expect(names(root)).toEqual(['App', 'List', 'Row', 'Other']);
  });

  it('share links round-trip a report and the shared page shows it; source context loads around the element', async () => {
    const r = factory.normalizeReport(report({ source: { fileName: 'http://localhost:5199/src/List.tsx?t=1', lineNumber: 4, columnNumber: 5 } }))!;
    const code = await factory.encodeShare(r as never);
    expect(code.startsWith('j.') || code.startsWith('d.')).toBe(true);
    const back = await factory.decodeShare(code);
    expect(back).toEqual(r);
    expect(await factory.decodeShare('x.nope')).toBeNull();
    expect(await factory.decodeShare('')).toBeNull();
    // the panel's Copy link button copies panelUrl?report=<code>
    const copied: string[] = [];
    const reads: string[] = [];
    panel = factory.createPanel(root, makeTransport({
      panelUrl: 'chrome-extension://id/panel.html',
      copy: (t: string) => copied.push(t),
      readSource: (url: string) => (reads.push(url), Promise.resolve('line1\nline2\nline3\nconst x = <Row />;\nline5\nline6\nline7\nline8')),
    }));
    send({ type: 'report', payload: r });
    panel.select('Row');
    button(root, '.actions button', 'Copy link').click();
    // compression runs off the main thread in Node; wait for the copy rather than a fixed tick
    for (let i = 0; i < 50 && !copied.length; i++) await new Promise((res) => setTimeout(res, 10));
    expect(copied[0]).toMatch(/^chrome-extension:\/\/id\/panel\.html\?report=[jd]\./);
    // the panel stamps receivedAt on ingest; everything else round-trips
    expect({ ...(await factory.decodeShare(copied[0]!.split('report=')[1]!) as object), receivedAt: 0 }).toEqual(r);
    // source context: ±3 lines with the element line highlighted
    await new Promise((res) => setTimeout(res, 0));
    expect(reads).toEqual(['http://localhost:5199/src/List.tsx?t=1']);
    const lines = [...root.querySelectorAll('.source-context .line')].map((l) => (l.classList.contains('hit') ? '*' : '') + l.querySelector('.ln')!.textContent!.trim());
    expect(lines).toEqual(['1', '2', '3', '*4', '5', '6', '7']);
    expect(factory.sourceContext('a\nb\nc', 2, 1)).toEqual([
      { n: 1, text: 'a', hit: false },
      { n: 2, text: 'b', hit: true },
      { n: 3, text: 'c', hit: false },
    ]);
  });

  it('windows the Offenders and Fixes views above 200 rows, with a sticky header and a column chooser', () => {
    for (const r of factory.floodReports(3000)) panel.handle({ type: 'report', payload: r });
    panel.flush();
    panel.setView('offenders');
    expect(root.querySelector('.table-wrap .vhead')).not.toBeNull();
    const rows = root.querySelectorAll('.table-wrap .vrow');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(100);
    expect(root.querySelector('.table-wrap table')).toBeNull();
    // sorting through the windowed header still works
    (root.querySelector('.vhead span.num') as HTMLElement).click();
    expect(panel.state.sort).toEqual({ key: 'avoidable', dir: 1 });
    // column chooser adds "Last seen"
    const lastSeen = [...root.querySelectorAll('.columns-menu label')].find((l) => l.textContent!.includes('Last seen'))!.querySelector('input') as HTMLInputElement;
    lastSeen.checked = true;
    lastSeen.dispatchEvent(new Event('change'));
    expect(panel.state.columns).toEqual(['lastSeen']);
    expect([...root.querySelectorAll('.vhead > span')].map((s) => s.textContent)).toContain('Last seen');
    expect(root.querySelector('.vrow > span.mono')!.textContent).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    // the flood has 40 owners, so its fixes stay a plain list; 300 distinct owners switch to windowed rows
    panel.setView('fixes');
    expect(root.querySelector('.table-wrap .fixes li')).not.toBeNull();
    panel.clearAll();
    for (let i = 0; i < 300; i++) panel.handle({ type: 'report', payload: report({ component: `C${i}`, path: ['App'], owner: `Owner${i}`, parent: { name: `Owner${i}`, trigger: 'state' } }) });
    panel.flush();
    expect(root.querySelector('.table-wrap .fix-row')).not.toBeNull();
    expect(root.querySelectorAll('.table-wrap .fix-row').length).toBeLessThan(100);
    (root.querySelector('.table-wrap .fix-row') as HTMLElement).click();
    expect(panel.state.tab).toBe('fixlist');
    expect(root.querySelector('.details-header .title')!.textContent).toMatch(/^useMemo\(style\) in <Owner\d+>$/);
  });

  it('keeps the plain table below the threshold, with the column chooser', () => {
    send({ type: 'report', payload: report({ selfDuration: 1 }) });
    send({ type: 'report', payload: report({ component: 'Other', path: ['App'], avoidable: false, trigger: 'props', propChanges: [] }) });
    send({ type: 'report', payload: report({ component: 'Other', path: ['App', 'B'], avoidable: false, trigger: 'props', propChanges: [] }) });
    panel.setView('offenders');
    expect(root.querySelector('.table-wrap table.grid')).not.toBeNull();
    expect([...root.querySelectorAll('.grid th')].map((t) => t.textContent)).toEqual(['Component', 'Avoidable ▾', 'Total', 'Wasted', 'Top fix']);
    const places = [...root.querySelectorAll('.columns-menu label')].find((l) => l.textContent!.includes('Places'))!.querySelector('input') as HTMLInputElement;
    places.checked = true;
    places.dispatchEvent(new Event('change'));
    expect([...root.querySelectorAll('.grid th')].map((t) => t.textContent)).toEqual(['Component', 'Avoidable ▾', 'Total', 'Wasted', 'Places', 'Top fix']);
    expect([...root.querySelectorAll('.grid tbody tr')].map((tr) => tr.children[4]!.textContent)).toEqual(['1', '2']);
  });

  it('searches values with the ~ prefix across props, hooks, contexts and state', () => {
    send({ type: 'report', payload: report({ props: { prev: {}, next: { label: 'Keyboard', price: 49 } } }) });
    send({ type: 'report', payload: report({ component: 'Cart', path: ['App'], hookState: [{ path: 'useState#0', hook: 'useState', index: 0, value: { items: ['mouse'] } }] }) });
    send({ type: 'report', payload: report({ component: 'Themed', path: ['App'], contexts: [{ name: 'Theme', value: 'dark' }] }) });
    const search = root.querySelector('input[type="search"]') as HTMLInputElement;
    const query = (q: string) => {
      search.value = q;
      search.dispatchEvent(new Event('input'));
    };
    query('~keyboard');
    expect(names(root)).toEqual(['App', 'List', 'Row']);
    query('~mouse');
    expect(names(root)).toEqual(['App', 'Cart']);
    query('~dark');
    expect(names(root)).toEqual(['App', 'Themed']);
    expect(root.querySelector('.stream .count')!.textContent).toBe('1 report');
    query('~');
    expect(names(root)).toEqual(['App', 'List', 'Row', 'Cart', 'Themed']);
    query('cart');
    expect(names(root)).toEqual(['App', 'Cart']);
  });

  it('notes and mute per component persist and hide muted components from Fixes and the summary', async () => {
    send({ type: 'report', payload: report() });
    send({ type: 'report', payload: report({ component: 'Noisy', path: ['App'], owner: 'App', propChanges: [], renderCount: 1 }) });
    send({ type: 'report', payload: report({ component: 'Noisy', path: ['App'], owner: 'App', propChanges: [], renderCount: 2 }) });
    send({ type: 'report', payload: report({ component: 'Noisy', path: ['App'], owner: 'App', propChanges: [], renderCount: 3 }) });
    expect(root.querySelector('.summary .stat.link .mono')!.textContent).toBe('<Noisy>');
    panel.select('Noisy');
    (root.querySelector('.details-header button[aria-label="Mute"]') as HTMLElement).click();
    expect(panel.state.notes).toEqual({ Noisy: { muted: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.notes).toEqual({ Noisy: { muted: true } });
    expect(root.querySelector('.summary .stat.link .mono')!.textContent).toBe('<Row>');
    panel.setView('fixes');
    expect([...root.querySelectorAll('.fixes li .label')].map((l) => l.textContent)).toEqual(['useMemo(style) in <List>']);
    expect(root.querySelector('.section-title')!.textContent).toContain('1 muted component hidden');
    panel.setView('tree');
    const row = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.name')!.textContent === 'Noisy')!;
    expect(row.classList.contains('muted')).toBe(true);
    // a note shows in the details and survives a reload of the panel
    panel.select('Noisy');
    (root.querySelector('.details-header button[aria-label="Note"]') as HTMLElement).click();
    const input = root.querySelector('.note-input') as HTMLInputElement;
    input.value = 'known, ticket #123';
    input.dispatchEvent(new Event('change'));
    expect(panel.state.notes.Noisy).toEqual({ muted: true, note: 'known, ticket #123' });
    document.body.innerHTML = '<div id="root"></div>';
    const again = factory.createPanel(document.getElementById('root')!, makeTransport({ storage: { get: (k: string) => Promise.resolve(store[k]), set: (k: string, v: unknown) => Promise.resolve((store[k] = v)) } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(again.state.notes).toEqual({ Noisy: { muted: true, note: 'known, ticket #123' } });
    again.setNote('Noisy', { muted: false, note: undefined });
    expect(again.state.notes).toEqual({});
  });

  it('exposes roles and states for assistive tech', () => {
    send({ type: 'report', payload: report() });
    panel.select('Row');
    expect(root.querySelector('.tree')!.getAttribute('role')).toBe('tree');
    const row = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.name')!.textContent === 'Row')!;
    expect(row.getAttribute('role')).toBe('treeitem');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.getAttribute('aria-level')).toBe('3');
    expect(root.querySelector('.toast')!.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.drawer')!.getAttribute('role')).toBe('dialog');
    expect((root.querySelector('input[type="search"]') as HTMLInputElement).getAttribute('aria-label')).toContain('Search components');
    expect([...root.querySelectorAll('.toolbar .ib')].every((b) => b.getAttribute('aria-label'))).toBe(true);
    panel.openSettings();
    expect(button(root, '.toolbar .ib', 'Settings').getAttribute('aria-expanded')).toBe('true');
    root.querySelector('.drawer')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((root.querySelector('.drawer') as HTMLElement).hidden).toBe(true);
  });

  it('broadcast transport: hello and reports over a BroadcastChannel, commands answered by the app side', async () => {
    const appSide = new BroadcastChannel('rl-panel-test');
    const cmds: string[] = [];
    appSide.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || !d.__rerenderLensCmd) return;
      cmds.push(d.cmd);
      const result = d.cmd === 'info' ? { count: 1, library: '0.3.0', protocol: 2, react: [{ version: '19.2.0' }], enabled: true, options: {}, overhead: { totalMs: 1.25, maxCommitMs: 0.5 }, commits: 3 } : d.cmd === 'pull' ? { seq: 1, reports: [report()], dropped: false } : d.cmd === 'configure' ? { trackAllComponents: true } : true;
      appSide.postMessage({ __rerenderLensReply: true, id: d.id, result });
    };
    const w = window as unknown as { RerenderLensPanel: { createBroadcastTransport(name: string): Transport } };
    const transport = w.RerenderLensPanel.createBroadcastTransport('rl-panel-test');
    panel = factory.createPanel(root, transport);
    for (let i = 0; i < 50 && panel.state.reports.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      panel.flush();
    }
    expect(cmds.slice(0, 2)).toEqual(['info', 'pull']);
    expect(root.querySelector('.status-text')!.textContent).toBe('connected · lib 0.3.0 · React 19.2.0');
    expect(root.querySelector('.status')!.getAttribute('title')).toContain('library overhead 1.3 ms over 3 commits, worst 0.5 ms');
    expect(root.querySelector('.tab-chip')!.textContent).toBe('channel "rl-panel-test"');
    expect(panel.state.reports).toHaveLength(1);
    // a live report published by the app side
    appSide.postMessage({ __rerenderLens: true, version: 2, type: 'report', payload: report({ component: 'Live', path: ['App'] }) });
    for (let i = 0; i < 50 && panel.state.reports.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
      panel.flush();
    }
    expect(panel.state.reports).toHaveLength(2);
    // storage lives in localStorage under the channel name
    panel.setView('offenders');
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.parse(localStorage.getItem('rerender-lens:rl-panel-test:panel') || '{}').view).toBe('offenders');
    appSide.close();
  });

  it('labels commit priority on the report and in the commits list', () => {
    send({ type: 'report', payload: report({ commitPriority: 'immediate' }) });
    send({ type: 'report', payload: report({ commitId: 2, commitPriority: 'normal', renderCount: 2 }) });
    panel.select('Row');
    expect(root.textContent).toContain('Commit #2 · transition / async priority');
    panel.setView('commits');
    expect([...root.querySelectorAll('.commits li .prio')].map((p) => p.textContent)).toEqual(['transition / async', 'discrete input']);
  });
});

describe('analysis', () => {
  let factory: Factory;
  beforeEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
  });

  it('firstDifferentPath and diffLeaves', () => {
    const { firstDifferentPath, diffLeaves } = factory.analysis;
    expect(firstDifferentPath({ a: 1 }, { a: 1 })).toBeNull();
    expect(firstDifferentPath({ style: { color: 'red' } }, { style: { color: 'blue' } })).toBe('style.color');
    expect(firstDifferentPath({ items: [1, 2] }, { items: [1, 3] })).toBe('items[1]');
    expect(firstDifferentPath({ items: [1, 2] }, { items: [1] })).toBe('items.length');
    expect(firstDifferentPath(1, 'x')).toBe('(value)');
    expect(diffLeaves({ a: 1, b: { c: [1, 2], d: 'x' } }, { a: 1, b: { c: [1, 3, 4], d: 'y' }, e: null })).toEqual([
      { path: 'b.c[1]', prev: 2, next: 3 },
      { path: 'b.c[2]', prev: undefined, next: 4 },
      { path: 'b.d', prev: 'x', next: 'y' },
      { path: 'e', prev: undefined, next: null },
    ]);
    expect(diffLeaves({ a: 1 }, { a: 1 })).toEqual([]);
    const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    expect(diffLeaves(big, {}, 20)).toHaveLength(20);
  });

  it('rootCauseSummary aggregates across commits', () => {
    const { rootCauseSummary } = factory.analysis;
    const page = report({ component: 'Page', path: ['App'], trigger: 'state', avoidable: false, parent: null });
    const row = report({ path: ['App', 'Page'], parent: { name: 'Page', trigger: 'state' } });
    const s = rootCauseSummary('Page', [
      [1, [page, row]],
      [2, [report({ component: 'Other', path: ['App'] })]],
      [3, [page, row, { ...row, component: 'Row2' }]],
    ]);
    expect(s.total).toBe(3);
    expect(s.commits.map((c) => c.key)).toEqual([3, 1]);
    expect(s.trigger).toBe('state');
    expect(rootCauseSummary('Nobody', [[1, [page, row]]]).commits).toEqual([]);
  });

  it('fixesFor covers every avoidable change kind', () => {
    const { fixesFor } = factory.analysis;
    const kinds = fixesFor(
      report({
        propChanges: [
          { path: 'style.nested', kind: 'deep-equal', prev: {}, next: { a: 1 } },
          { path: 'onClick', kind: 'function', prev: 'ƒ f', next: 'ƒ f' },
          { path: 'icon', kind: 'element', prev: '<Icon>', next: '<Icon>' },
          { path: 'n', kind: 'different', prev: 1, next: 2 },
        ],
        hookChanges: [
          { path: 'useState#0', hook: 'useState', index: 0, kind: 'deep-equal', prev: {}, next: {} },
          { path: 'useContext(Theme)', hook: 'useContext', index: 1, kind: 'deep-equal', prev: {}, next: {} },
          { path: 'useSyncExternalStore#2', hook: 'useSyncExternalStore', index: 2, kind: 'deep-equal', prev: {}, next: {} },
        ],
      }),
    ).map((f) => `${f.kind}:${f.owner}:${f.prop}`);
    expect(kinds).toEqual(['useMemo:List:style', 'useCallback:List:onClick', 'useMemoElement:List:icon', 'bailout:Row:useState#0', 'contextValue:Theme.Provider:Theme', 'storeSnapshot:Row:useSyncExternalStore#2']);
    const memo = fixesFor(report({ propChanges: [] }));
    expect(memo).toHaveLength(1);
    expect(memo[0]!.kind).toBe('memo');
    expect(memo[0]!.snippet).toContain('memo(function Row');
    // not memoized + avoidable prop changes: memo first, then the prop fix
    const both = fixesFor(report({ memoized: false }));
    expect(both.map((f) => f.kind)).toEqual(['memo', 'useMemo']);
    expect(both[0]!.detail).toContain('not memoized');
    expect(fixesFor(report({ memoized: true })).map((f) => f.kind)).toEqual(['useMemo']);
    expect(fixesFor(report({ avoidable: false, trigger: 'props', propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }] }))).toEqual([]);
  });

  it('rankFixes merges identical fixes and counts renders removed', () => {
    const { rankFixes } = factory.analysis;
    const ranked = rankFixes([report(), report({ renderCount: 2 }), report({ component: 'Row2', propChanges: [] }), report({ avoidable: false, trigger: 'props' })]);
    expect(ranked.map((f) => [f.label, f.count])).toEqual([
      ['useMemo(style) in <List>', 2],
      ['Wrap <Row2> in React.memo', 1],
    ]);
  });

  it('rootCauseOf follows parent links inside a commit and stops at untracked parents', () => {
    const { rootCauseOf, analyzeCommit } = factory.analysis;
    const page = report({ component: 'Page', path: ['App'], trigger: 'state', avoidable: false, parent: null });
    const list = report({ component: 'List', path: ['App', 'Page'], parent: { name: 'Page', trigger: 'state' } });
    const row = report({ path: ['App', 'Page', 'List'], parent: { name: 'List', trigger: 'parent' } });
    const commit = [page, list, row];
    expect(rootCauseOf(row, commit)).toMatchObject({ name: 'Page', trigger: 'state' });
    expect(rootCauseOf(page, commit)).toBeNull();
    // parent not in the commit (untracked): fall back to the parent info itself
    expect(rootCauseOf(report(), [report()])).toMatchObject({ name: 'App', trigger: 'state' });
    // a component whose path does not sit under the candidate is not its ancestor
    const other = report({ component: 'List', path: ['App', 'Elsewhere'], parent: { name: 'Page', trigger: 'state' } });
    expect(rootCauseOf(row, [page, other, row])).toMatchObject({ name: 'List', trigger: 'parent' });
    const a = analyzeCommit(commit);
    expect(a.avoidable).toBe(2);
    expect(a.roots).toEqual([{ name: 'Page', trigger: 'state', count: 2, components: new Map([['List', 1], ['Row', 1]]) }]);
  });

  it('normalizeReport and markdown', () => {
    expect(factory.normalizeReport({ component: 'X' })).toMatchObject({ component: 'X', path: [], propChanges: [], props: { prev: {}, next: {} }, avoidable: false });
    expect(factory.normalizeReport('nope')).toBeNull();
    const md = factory.reportToMarkdown(report({ source: { fileName: '/src/Row.tsx', lineNumber: 3 } }));
    expect(md).toContain('**Path:** App > List > Row');
    expect(md).toContain('**Source:** /src/Row.tsx:3');
    expect(md).toContain('```jsx');
    expect(factory.sampleReports().every((r) => factory.normalizeReport(r))).toBe(true);
  });
});
