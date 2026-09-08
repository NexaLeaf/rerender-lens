# rerender-lens DevTools extension

A Chrome / Edge / Firefox DevTools panel ("Re-renders") that shows avoidable React re-renders
live, laid out like React DevTools' Components tab: component tree on the left with avoidable
counts, details on the right (why it rendered, which ancestor triggered it, props with the changed
ones highlighted, state and hooks, the fix as a code snippet), plus a live stream at the bottom.

Other views in the left pane:

- **Offenders**: every component ranked by avoidable re-renders, total renders and wasted time.
- **Commits**: one row per React commit with its root cause; the details show the render cascade
  (who caused whom), the contexts that changed, and the fixes for that commit. Click a root cause
  to see every commit that component started across the session.
- **Fixes**: every suggested fix ranked by how many avoidable re-renders it removes
  ("useCallback(onSelect) in <ProductPage>: 12"), with a snippet to copy. Contexts are listed
  with the component that renders their Provider and, for object values, which keys changed.
- **Sessions**: press *Record*, use the app, press *Stop*. Apply a fix, record again, and the
  session page compares the two: avoidable re-renders per component with deltas, wasted time,
  and the fixes that are no longer suggested. Summaries survive reloads and travel with exports.

Also: an **Elements-panel sidebar** ("Re-renders") for the selected DOM node, a toolbar **badge**
with the avoidable count of the current tab, hover-to-highlight of a component's DOM in the page,
"open source" links into the Sources panel, JSON export/import, Markdown copy of a report, and a
Settings drawer that changes the library's options live (persisted per origin).

Keyboard: `/` focuses search, arrows move in the tree, `f` opens the Fix tab, `Esc` clears the
highlight (and closes Settings). Search matches component names, `/regex/`, or `~text` to search
prop, hook, context and state values. The tree and the live stream are virtualized, so tens of
thousands of reports stay smooth; `panel.html?demo&flood=5000` is the scale test.

## Next to the page, or in a window

You do not have to keep DevTools open. From the toolbar popup (or the *Side panel* / *Window*
buttons in the DevTools panel):

- **Open side panel** shows the same panel in Chrome's side panel, next to the page, pinned to
  that tab. Firefox opens it as a sidebar that follows the active tab.
- **Open in window** shows it in its own window, pinned to the tab, so you can tile it on a second
  screen.

Outside DevTools the panel talks to the page through the background relay and
`chrome.scripting` (for settings, highlight and polling), so the origin must be one the extension
has access to: local hosts, or a site you enabled. Below 720px wide the layout stacks the tree
above the details and shows icon-only buttons.

Without the extension at all, `npx rerender-lens panel` serves this same panel from a local relay
and any app pointed at it (`createDevtoolsNotifier({ relay })`) shows up there; see the package
README.

## Two ways to connect a page

**1. The page runs the library** (any host the extension is enabled on):

```ts
import { init, createDevtoolsNotifier } from 'rerender-lens';
init({ trackAllMemoized: true, silent: true, notifier: createDevtoolsNotifier() });
```

**2. Injection, no app code**: open the toolbar popup (or Settings in the panel), enable the site
and tick *Inject the library*. The extension then loads rerender-lens into the page before React,
with `trackAllMemoized` on and `includeState` off (the state snapshots are the costliest part on
large apps; tick *Include state* in Settings when you need them). Reload the page. Options you change in Settings are saved per origin
and applied on the next load.

If the page already runs the library, injection steps aside.

Local development hosts (`localhost`, `127.0.0.1`, `*.localhost`, `*.local`) are always enabled.
Any other origin needs a one-time host permission, requested when you enable it (optional host
permissions; nothing is granted until you ask).

Production React builds are detected and flagged: names may be minified and hooks unlabeled.

## Install

From a release: download `rerender-lens-chrome-<version>.zip` (Edge uses the same file,
Firefox has its own) from the GitHub release, unzip, `chrome://extensions` → *Developer mode* →
*Load unpacked*. Or the Chrome Web Store once the listing is live (see `store/PUBLISHING.md`).

From source:

```sh
npm install
npm run build        # also writes extension/vendor/rerender-lens.{core,engine,}.js (the injectable library)
npm run build:ext    # dist-extension/{chrome,edge,firefox}/ and .zip files
```

then load `extension/` (or `dist-extension/chrome/`) unpacked. Open your app, open DevTools, pick
the **Re-renders** tab.

## Preview without installing

Open `panel.html?demo` (or `panel.html?demo&theme=dark`) from any static server to see the panel
with sample data.

## How it talks to the page

- `content.js` (isolated world) forwards `window` messages carrying `__rerenderLens: true` to
  `background.js`, which routes them to the panel(s) inspecting that tab and updates the badge.
- When no content script is present (a host you did not enable), the panel polls the page's bridge
  with `chrome.devtools.inspectedWindow.eval('...pull(since)')` every 500 ms instead. Same data,
  slightly later.
- `inject.js` + `vendor/rerender-lens.*.js` (core, engine, bridge) run in the page's main world at `document_start` on
  origins with injection enabled (registered with `chrome.scripting.registerContentScripts`).
- Settings, highlight and source links go through the bridge (`window.__RERENDER_LENS_DEVTOOLS__`),
  never through the app.

If React DevTools is also installed, both hooks coexist: whichever installs the global hook first
owns it, the other wraps it. If React DevTools' Components tab comes up empty with injection on,
tick *Let React DevTools create the hook* for that origin (popup or Settings): the injector then
waits one task before touching the hook, so React DevTools' script can install it first. Page
scripts are still not running at that point, so react-dom finds the hook either way.

When a page runs its own copy of the library and injection is on, the injected copy steps aside
and the panel says so; turn injection off for that origin.

## Files

| | |
| --- | --- |
| `manifest.json` | MV3; `scripts/build-extension.mjs` derives the Firefox manifest from it |
| `background.js` | routing, badge, per-origin script registration (`shared.js` helpers) |
| `content.js`, `inject.js`, `inject-deferred.js` | relay; in-page bootstrap for injection; flag file for the deferred mode |
| `devtools.js`, `panel.html/css`, `src/panel.ts` | the panel. `npm run build` compiles `src/panel.ts` to the committed `panel.js` (CI checks it is current); `RerenderLensPanel.analysis` holds the pure ranking code |
| `sidepanel.html` | the same panel booted standalone (side panel, own window, Firefox sidebar); `?tabId=` pins a tab |
| `sidebar.html/js` | Elements-panel sidebar |
| `popup.html/js` | toolbar popup to enable a site |
| `store/` | listing text, privacy policy, publishing notes |
| `test/*.test.ts` | jsdom tests for the panel, background, popup and sidebar (`npm test`, fake `chrome` in `test/fake-chrome.ts`); `e2e/` has the Playwright suite (`npm run e2e`) |

## Tests

`npm test` runs `test/panel.test.ts` in jsdom with a fake transport. `npm run e2e` starts the
example app and drives Chromium with the extension loaded: relay, badge, injection, and the panel.
