import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeChrome, settle, type FakeChrome } from './fake-chrome';

const panel = readFileSync(join(__dirname, '..', 'panel.js'), 'utf8');
const sidebar = readFileSync(join(__dirname, '..', 'sidebar.js'), 'utf8');

function load(chrome: FakeChrome) {
  document.body.innerHTML = '<div id="root"></div>';
  const w = window as unknown as Record<string, unknown>;
  delete w.RerenderLensPanel;
  // panel.js must not boot the extension transport here: the sidebar page is not panel.html
  new Function('chrome', 'window', 'document', panel)(chrome, window, document);
  new Function('chrome', 'window', 'document', sidebar)(chrome, window, document);
}

const report = {
  component: 'Row', path: ['App', 'List'], trigger: 'parent', avoidable: true, renderCount: 3, instanceId: 9, commitId: 1, memoized: false,
  owner: 'List', parent: { name: 'App', trigger: 'state' },
  props: { prev: { n: 1 }, next: { n: 1 } }, propChanges: [], stateChanges: [], hookChanges: [], reasons: ['identical props'],
};

describe('elements sidebar', () => {
  let chrome: FakeChrome;
  beforeEach(() => {
    document.documentElement.className = '';
  });

  it('explains when the library is missing or nothing is selected', async () => {
    chrome = makeChrome({ evalResult: { missing: true } });
    load(chrome);
    await settle();
    expect(document.body.textContent).toContain('not running in this page');
    chrome.devtools.inspectedWindow.eval.mockImplementation((_c: string, cb: (r: unknown) => void) => cb({ none: true }));
    chrome.devtools.panels.elements.onSelectionChanged.emit();
    await settle();
    expect(document.body.textContent).toContain('Select an element');
    chrome.devtools.inspectedWindow.eval.mockImplementation((_c: string, cb: (r: unknown) => void) => cb(null));
    chrome.devtools.panels.elements.onSelectionChanged.emit();
    await settle();
    expect(document.body.textContent).toContain('No React component renders this element');
  });

  it('renders the component, tracking state, last report and highlight buttons', async () => {
    chrome = makeChrome({ evalResult: { component: 'Row', instanceId: 9, tracked: true, path: ['App', 'List'], reports: [report] } });
    load(chrome);
    await settle();
    expect(document.querySelector('.sb-title .name')!.textContent).toBe('Row');
    expect(document.body.textContent).toContain('in App › List');
    expect(document.body.textContent).toContain('tracked');
    expect(document.body.textContent).toContain('1 recent report');
    expect(document.body.textContent).toContain('identical props');
    expect(document.body.textContent).toContain('Not memoized');
    // compact mode: no action bar in the sidebar's report view
    expect(document.querySelector('.actions')).toBeNull();
    const buttons = [...document.querySelectorAll('.sb-actions button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Highlight', 'Clear']);
    chrome.devtools.inspectedWindow.eval.mockClear();
    buttons[0]!.click();
    expect(chrome.devtools.inspectedWindow.eval.mock.calls[0]![0]).toBe('window.__RERENDER_LENS_DEVTOOLS__.highlight(9)');
    buttons[1]!.click();
    expect(chrome.devtools.inspectedWindow.eval.mock.calls[1]![0]).toBe('window.__RERENDER_LENS_DEVTOOLS__.highlight(null)');
  });

  it('an untracked component with no instance id has no highlight button', async () => {
    chrome = makeChrome({ evalResult: { component: 'Plain', instanceId: null, tracked: false, path: [], reports: [] } });
    load(chrome);
    await settle();
    expect(document.body.textContent).toContain('not tracked');
    expect(document.body.textContent).toContain('no re-renders reported');
    expect(document.querySelectorAll('.sb-actions button')).toHaveLength(0);
  });
});
