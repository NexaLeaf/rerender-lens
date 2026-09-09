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
    chrome = makeChrome({
      evalResult: {
        component: 'Row', instanceId: 9, tracked: true, path: ['App', 'List'], reports: [report],
        tracking: { tracked: true, name: 'Row', memoized: true, reason: '<Row> is a React.memo component, and "Track every React.memo and PureComponent" is on.' },
      },
    });
    load(chrome);
    await settle();
    expect(document.querySelector('.sb-title .name')!.textContent).toBe('Row');
    expect(document.body.textContent).toContain('in App › List');
    expect(document.body.textContent).toContain('tracked');
    expect(document.querySelector('.sb-reason')!.textContent).toContain('is a React.memo component');
    expect(document.querySelector('.sb-fix')).toBeNull();
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

  it('an untracked component shows the verdict, the fix and a Track this component button', async () => {
    chrome = makeChrome({
      evalResult: {
        component: 'Plain', instanceId: null, tracked: false, path: [], reports: [], options: { include: ['Row'] },
        tracking: {
          tracked: false, name: 'Plain', memoized: false,
          reason: '"Track every React.memo and PureComponent" only covers React.memo components and PureComponent classes, and <Plain> is neither.',
          fix: 'Add "Plain" to include, wrap it in React.memo, or turn on "Track every component".',
        },
      },
    });
    load(chrome);
    await settle();
    expect(document.body.textContent).toContain('not tracked');
    expect(document.body.textContent).toContain('no re-renders reported');
    expect(document.querySelector('.sb-reason')!.textContent).toContain('only covers React.memo components');
    expect(document.querySelector('.sb-fix')!.textContent).toContain('Add "Plain" to include');
    // no instance id, so no highlight buttons: only the one-click fix
    const buttons = [...document.querySelectorAll('.sb-actions button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Track this component']);
    chrome.devtools.inspectedWindow.eval.mockClear();
    buttons[0]!.click();
    await settle();
    expect(chrome.devtools.inspectedWindow.eval.mock.calls[0]![0]).toBe('window.__RERENDER_LENS_DEVTOOLS__.configure({"include":["Row","Plain"]})');
  });

  it('a tracked component that has not re-rendered is not the untracked case', async () => {
    chrome = makeChrome({
      evalResult: {
        component: 'Quiet', instanceId: 3, tracked: true, path: [], reports: [],
        tracking: { tracked: true, name: 'Quiet', memoized: false, reason: '<Quiet> matches "include".' },
      },
    });
    load(chrome);
    await settle();
    expect(document.body.textContent).toContain('no re-renders yet');
    expect(document.body.textContent).not.toContain('no re-renders reported');
    const buttons = [...document.querySelectorAll('.sb-actions button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Highlight', 'Clear']);
  });
});
