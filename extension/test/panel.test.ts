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
}

function makeTransport(): Transport {
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
  };
}

const report = (over: Record<string, unknown> = {}) => ({
  component: 'Row', path: ['App', 'List'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 1,
  owner: 'List', parent: { name: 'App', trigger: 'state' },
  props: { prev: { style: { a: 1 }, n: 1 }, next: { style: { a: 1 }, n: 1 } },
  propChanges: [{ path: 'style', kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 } }],
  stateChanges: [], hookChanges: [], reasons: ['caused by <App> re-rendering (its state changed).', 'prop "style" ...'],
  ...over,
});

interface Panel {
  state: { reports: unknown[]; selectedKey: string | null; paused: boolean };
  handle(m: unknown): void;
  select(name: string): void;
  clearAll(): void;
}
interface Factory {
  createPanel(root: HTMLElement, t: Transport, o?: object): Panel;
  valueNode(v: unknown): HTMLElement;
}

const names = (root: HTMLElement) => [...root.querySelectorAll('.row .name')].map((n) => n.textContent);

describe('devtools panel', () => {
  let factory: Factory;
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root')!;
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
  });

  it('renders an empty state and reflects the connection status', () => {
    const panel = factory.createPanel(root, makeTransport());
    expect(root.querySelector('.tree .empty')!.textContent).toMatch(/No re-renders/);
    expect(root.querySelector('.status')!.classList.contains('connected')).toBe(false);
    panel.handle({ type: 'connected' });
    expect(root.querySelector('.status')!.classList.contains('connected')).toBe(true);
    expect(root.querySelector('.status-text')!.textContent).toBe('connected');
  });

  it('builds a tree from report paths with avoidable badges and selects the latest report', () => {
    const panel = factory.createPanel(root, makeTransport());
    panel.handle({ type: 'report', payload: report() });
    panel.handle({ type: 'report', payload: report({ renderCount: 2 }) });
    panel.handle({
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
    panel.handle({ type: 'report', payload: report({ renderCount: 3, propChanges: [], reasons: ['identical props'] }) });
    expect(root.querySelector('.details-header .meta')!.textContent).toBe('3 re-renders, 3 avoidable');
    expect(root.textContent).toContain('identical props');
  });

  it('filters by text and regex, and by avoidable only', () => {
    const panel = factory.createPanel(root, makeTransport());
    panel.handle({ type: 'report', payload: report() });
    panel.handle({ type: 'report', payload: report({ component: 'Other', path: ['App'], avoidable: false, trigger: 'props' }) });
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
    const t = makeTransport();
    const panel = factory.createPanel(root, t);
    panel.handle({ type: 'report', payload: report() });
    const buttons = [...root.querySelectorAll('.toolbar button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent!.includes('Pause'))!.click();
    panel.handle({ type: 'report', payload: report({ renderCount: 2 }) });
    expect(panel.state.reports).toHaveLength(1);
    buttons.find((b) => b.textContent!.includes('Resume'))!.click();
    panel.handle({ type: 'report', payload: report({ renderCount: 2 }) });
    expect(panel.state.reports).toHaveLength(2);
    panel.select('Row');
    const historyTab = [...root.querySelectorAll('.tabs button')].find((b) => b.textContent!.startsWith('History')) as HTMLButtonElement;
    historyTab.click();
    expect(root.querySelectorAll('.history li')).toHaveLength(2);
    (root.querySelector('.history li:last-child') as HTMLElement).click();
    expect(root.textContent).toContain('#1');
    buttons.find((b) => b.textContent!.includes('Clear'))!.click();
    expect(t.cleared).toBe(1);
    expect(panel.state.reports).toHaveLength(0);
    expect(root.querySelector('.tree .empty')).not.toBeNull();
  });

  it('renders serialized values with types', () => {
    expect(factory.valueNode('\u0192 onClick').className).toBe('v fn');
    expect(factory.valueNode('<Icon>').textContent).toBe('<Icon>');
    expect(factory.valueNode('x').textContent).toBe('"x"');
    expect(factory.valueNode(3).className).toBe('v num');
    expect(factory.valueNode(null).textContent).toBe('null');
    expect(factory.valueNode([1, 2]).textContent).toBe('[1, 2]');
    expect(factory.valueNode({ $type: 'Map', entries: [['a', 1]] }).querySelector('summary')!.textContent).toBe('Map(1)');
    expect(factory.valueNode({ a: 1, b: 2 }).querySelector('summary')!.textContent).toBe('{a, b}');
  });
});
