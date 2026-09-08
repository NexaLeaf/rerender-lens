import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeChrome, makePort, settle, type FakeChrome, type FakePort } from './fake-chrome';

const source = readFileSync(join(__dirname, '..', 'panel.js'), 'utf8');

interface Panel {
  state: { reports: unknown[]; library: unknown; relay: boolean; polling: boolean; tabLabel: string | null; origin: string | null };
  flush(): void;
}
interface Factory {
  bootStandalone(o: { tabId?: number | null }): Panel;
}

/** A page bridge as the injected/page library would expose it. */
function fakeBridge(reports: unknown[]) {
  const calls: unknown[] = [];
  return {
    calls,
    bridge: {
      size: reports.length,
      version: 2,
      info: () => ({ count: reports.length, library: '0.2.0', protocol: 2, react: [{ version: '19.2.0', bundleType: 1 }], production: false, enabled: true, options: {}, source: 'page', injected: false }),
      pull: (since: number) => ({ seq: reports.length, reports: reports.slice(since), dropped: false }),
      replay: () => calls.push('replay'),
      clear: () => calls.push('clear'),
      configure: (o: unknown) => (calls.push(['configure', o]), { trackAllMemoized: true }),
      highlight: (id: unknown) => (calls.push(['highlight', id]), true),
      flashAvoidable: (on: unknown) => calls.push(['flash', on]),
    },
  };
}

const report = (component: string) => ({
  component, path: ['App'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 1, commitId: 1,
  owner: 'App', parent: { name: 'App', trigger: 'state' }, props: { prev: {}, next: {} }, propChanges: [], stateChanges: [], hookChanges: [], reasons: [],
});

describe('standalone panel (side panel / window)', () => {
  let chrome: FakeChrome;
  let factory: Factory;
  let ports: FakePort[];
  const load = (c: FakeChrome) => {
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.className = '';
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    ports = [];
    c.runtime.connect.mockImplementation((o: { name: string }) => {
      const p = makePort(o.name);
      ports.push(p);
      return p;
    });
    new Function('chrome', 'window', 'document', source)(c, window, document);
    factory = w.RerenderLensPanel as Factory;
  };
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('pinned to a tab: connects to the relay for it, reads origin and hello through chrome.scripting, shows the tab chip', async () => {
    const page = fakeBridge([report('A')]);
    chrome = makeChrome({ activeUrl: 'http://localhost:5199/app', page: { __RERENDER_LENS_DEVTOOLS__: page.bridge } });
    load(chrome);
    const panel = factory.bootStandalone({ tabId: 7 });
    await settle();
    await settle();
    expect(ports).toHaveLength(1);
    expect(ports[0]!.sent[0]).toEqual({ type: 'init', tabId: 7 });
    // origin came from an isolated-world executeScript; hello from a MAIN-world command
    const worlds = chrome._executed.map((c) => [c.target.tabId, c.world]);
    expect(worlds).toContainEqual([7, 'ISOLATED']);
    expect(worlds).toContainEqual([7, 'MAIN']);
    expect(panel.state.origin).toBe(location.origin);
    expect(panel.state.library).toMatchObject({ library: '0.2.0', protocol: 2 });
    expect(document.querySelector('.status-text')!.textContent).toBe('connected · lib 0.2.0 · React 19.2.0');
    expect(document.querySelector('.tab-chip')!.textContent).toBe('Example app · localhost:5199');
    // no content script yet: the panel pulled the buffer and polls
    expect(panel.state.polling).toBe(true);
    panel.flush();
    expect(panel.state.reports).toHaveLength(1);
    // a content script connecting stops the polling and relayed reports flow
    ports[0]!.onMessage.emit({ type: 'connected' });
    expect(panel.state.polling).toBe(false);
    ports[0]!.onMessage.emit({ type: 'report', payload: report('B') });
    panel.flush();
    expect(panel.state.reports).toHaveLength(2);
    // settings and highlight go through the same command bridge
    const rowA = [...document.querySelectorAll<HTMLElement>('.row')].find((r) => r.querySelector('.name')!.textContent === 'A')!;
    rowA.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(page.calls).toContainEqual(['highlight', 1]);
    // no undock buttons outside DevTools for a pinned tab? they exist (window/side panel) and route to the tab
    expect([...document.querySelectorAll('.toolbar .ib .label')].map((l) => l.textContent)).toContain('Side panel');
    // the content script going away resumes polling; a navigation stops it until the new page answers `info`
    ports[0]!.onMessage.emit({ type: 'disconnected' });
    await settle();
    await settle();
    expect(panel.state.polling).toBe(true);
    chrome.tabs.onUpdated.emit(7, { status: 'loading' });
    expect(panel.state.polling).toBe(false);
    expect(panel.state.reports).toHaveLength(0);
  });

  it('follows the active tab when not pinned and starts over on tab switch', async () => {
    const page = fakeBridge([]);
    chrome = makeChrome({ activeUrl: 'http://localhost:5199/', page: { __RERENDER_LENS_DEVTOOLS__: page.bridge } });
    load(chrome);
    const panel = factory.bootStandalone({});
    await settle();
    await settle();
    expect(ports.at(-1)!.sent[0]).toEqual({ type: 'init', tabId: 7 });
    ports.at(-1)!.onMessage.emit({ type: 'connected' });
    ports.at(-1)!.onMessage.emit({ type: 'report', payload: report('A') });
    panel.flush();
    expect(panel.state.reports).toHaveLength(1);
    chrome.tabs.get.mockImplementation((id: number) => Promise.resolve({ id, url: 'https://other.example.com/x', title: 'Other' }));
    chrome.tabs.onActivated.emit({ tabId: 9 });
    await settle();
    await settle();
    expect(panel.state.reports).toHaveLength(0);
    expect(ports.at(-1)!.sent[0]).toEqual({ type: 'init', tabId: 9 });
    expect(document.querySelector('.tab-chip')!.textContent).toBe('Other · other.example.com');
  });

  it('undock: side panel pins the tab and opens; window asks the background', async () => {
    chrome = makeChrome({ activeUrl: 'http://localhost:5199/', page: { __RERENDER_LENS_DEVTOOLS__: fakeBridge([]).bridge } });
    load(chrome);
    factory.bootStandalone({ tabId: 7 });
    await settle();
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.toolbar .ib')].find((b) => b.querySelector('.label')!.textContent === label)!;
    button('Side panel').click();
    await settle();
    expect(chrome._sidePanel).toEqual([
      ['setOptions', { tabId: 7, path: 'sidepanel.html?tabId=7', enabled: true }],
      ['open', { tabId: 7 }],
    ]);
    const sent: unknown[] = [];
    chrome.runtime.sendMessage = (m: unknown, cb: (r: unknown) => void) => {
      sent.push(m);
      cb({ ok: true, result: { windowId: 99 } });
    };
    button('Window').click();
    await settle();
    expect(sent).toEqual([{ type: 'window:open', tabId: 7 }]);
  });
});
