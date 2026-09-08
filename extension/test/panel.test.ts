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
  state: { reports: unknown[]; selectedKey: string | null; paused: boolean; view: string; tab: string; library: unknown; relay: boolean; flashOn: boolean };
  handle(m: unknown): void;
  flush(): void;
  select(name: string): void;
  clearAll(): void;
  setView(v: string): void;
  importData(d: unknown): number;
  openSettings(): void;
}
interface Fix { kind: string; owner: string; prop: string | null; label: string; detail: string; snippet: string; count?: number; key?: string }
interface Factory {
  PROTOCOL: number;
  createPanel(root: HTMLElement, t: Transport, o?: object): Panel;
  valueNode(v: unknown): HTMLElement;
  normalizeReport(p: unknown): Record<string, unknown> | null;
  reportToMarkdown(r: unknown): string;
  sampleReports(): Record<string, unknown>[];
  analysis: {
    firstDifferentPath(a: unknown, b: unknown): string | null;
    fixesFor(r: unknown): Fix[];
    rankFixes(rs: unknown[]): Fix[];
    rootCauseOf(r: unknown, rs: unknown[]): { name: string; trigger: string } | null;
    analyzeCommit(rs: unknown[]): { avoidable: number; roots: { name: string; trigger: string; count: number }[]; contexts: { name: string; consumers: number }[] };
    contextAttribution(rs: unknown[]): { name: string; consumers: number; avoidable: number }[];
  };
}

const names = (root: HTMLElement) => [...root.querySelectorAll('.row .name')].map((n) => n.textContent);
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

describe('analysis', () => {
  let factory: Factory;
  beforeEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
  });

  it('firstDifferentPath', () => {
    const { firstDifferentPath } = factory.analysis;
    expect(firstDifferentPath({ a: 1 }, { a: 1 })).toBeNull();
    expect(firstDifferentPath({ style: { color: 'red' } }, { style: { color: 'blue' } })).toBe('style.color');
    expect(firstDifferentPath({ items: [1, 2] }, { items: [1, 3] })).toBe('items[1]');
    expect(firstDifferentPath({ items: [1, 2] }, { items: [1] })).toBe('items.length');
    expect(firstDifferentPath(1, 'x')).toBe('(value)');
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
