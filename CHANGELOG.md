# Changelog

## Unreleased

- **CI tooling.** `rankFixes` / `formatFixes`, `summarizeReports` / `compareSummaries`, and
  `checkBudget` / `toBudget` / `assertWithinBudget` in the package; the collector gains
  `fixes()`, `summary()` and `assertWithinBudget()`, and `assertNoAvoidable()` now ends with the
  ranked fixes. A `rerender-lens` CLI (`fixes`, `summary --out`, `compare`, `budget --init`)
  works on panel exports and session files and exits non-zero on regressions or violations.
- **Source context.** The report shows the lines around where the element was created (DevTools
  resources or a fetch of the module in side-panel mode).
- **Shareable links.** *Copy link* puts the report into a `panel.html?report=…` URL (deflated when
  the browser can); anyone with the extension opens it without the page.
- **Custom hook names, opt-in** (`resolveHookNames`, also in Settings): hook changes and
  snapshots read `useCounter › useCart › useState#0`. Like React DevTools, the library re-runs a
  component type once with a stand-in dispatcher and reads the custom hooks off the call stack;
  results are cached per type and a failing replay yields no names.
- **Updaters.** Every report names the components that scheduled the commit (`updaters`, from
  React's updater tracking), so the Commits view shows "set by <X>" even when X is untracked.
- **Effect loops.** A commit scheduled right after the previous one by a component that rendered
  in it is flagged `effect-after-commit` with the offending commit id; the report explains the
  effect → setState pattern. Suspense boundaries resolving are labelled `suspense-resolved`.
- **Store advice.** A `useSyncExternalStore` snapshot with equal contents now gets Redux
  (`shallowEqual` / `createSelector`) or Zustand (`useShallow`) advice when the hook chain
  identifies the store hook.
- **Instances.** Reports carry the element `key`; the tree can group by instance
  (`<Row key="a">`, `<Row #12>`) via the Instances toggle.
- **`rerender-lens/vite`**: a Vite plugin that starts the library before React in dev, with the
  DevTools notifier, from one line in `vite.config.ts`. **`rerender-lens/setup`**: a side-effect
  entry for Next.js `instrumentation-client.ts`, Webpack entry arrays and the like.
- CI lints the Firefox package with `web-ext lint`; `extension/store/QA.md` is the manual
  checklist for what no test reaches. A docs site builds from the READMEs (`npm run build:docs`)
  and deploys to GitHub Pages; `npm run docs:media` captures its screenshots and GIF.
- **Full state on every report.** `hookState` (every `useState` / `useReducer` /
  `useSyncExternalStore` value), `contexts` (every context the component reads) and, for class
  components, `state`. The panel's report shows Hooks, State and Contexts in full, with the
  changed entries as prev → next; the console prints them too. `includeState: false` turns it off
  (also in the panel's Settings).
- **Sessions.** Record, use the app, Stop; apply a fix; record again. The Sessions view compares
  two sessions: avoidable re-renders per component with deltas, totals, wasted time, and which
  suggested fixes went away. Summaries persist per origin; exports include them.
- **Provider attribution.** A `useContext` change now names the component that renders the
  Provider and, for object values, which keys changed. When only some keys changed the reason
  and the Fixes view say so and suggest splitting the context or selecting slices.
- **Children diffs.** Elements are serialized with their props, so a changed `children` prop
  shows the differing leaf (`children[0].props.label`); re-created children get their own advice
  and fix snippet (memoize or hoist them).
- **Commit priority.** Every report carries the priority React gave the commit (discrete input,
  continuous input, transition / async, low, idle); the Commits list and report show it. The
  bridge `info()` also counts scheduled roots vs commits.
- Not done: custom hook names for hook changes. React DevTools gets them by re-running the
  component with a fake dispatcher; doing that from a commit hook is too invasive.
- The panel outside DevTools: **Open side panel** shows it in Chrome's side panel next to the
  page, **Open in window** in its own window (toolbar popup, or the new buttons in the DevTools
  panel). Both use the background relay plus `chrome.scripting` instead of DevTools APIs, follow
  the active tab unless pinned, and stack the layout when narrower than 720px. Firefox gets the
  same page as a sidebar.
- UI refresh: new palette and spacing in light and dark, icon toolbar with labels that collapse
  in narrow layouts, segmented view switcher, a summary strip (renders, avoidable, wasted time,
  top offender, best fix, all clickable), clearer selection and banners.
- `selfDuration` is now the component's own render time; the previous value (the whole subtree)
  moved to `treeDuration`. Children that bailed out contribute nothing, as in the Profiler.
- `memoized` on every report (`React.memo` / `PureComponent`). Reports of unmemoized components
  with avoidable prop changes explain that `React.memo` is needed as well; the panel's Fixes view
  lists it first.
- Bridge `info()` reports `source` (`page` or `extension`) and `injected`. The panel warns when the
  page runs its own copy next to the injected one.
- Extension: per-origin "Let React DevTools create the hook" toggle (popup and Settings). With it
  on, the injector waits one task so React DevTools' own script can install the global hook first.
- Elements sidebar: an element without a React component above it now says so instead of
  "not running".
- jsdom tests for `background.js`, `popup.js` and `sidebar.js` (shared fake `chrome`).
- Panel source moved to TypeScript (`extension/src/panel.ts`); `npm run build` writes the
  committed `extension/panel.js`, and CI fails when it is out of date.
- Tree and live stream are virtualized (only the rows in view exist in the DOM); the stream now
  keeps every buffered report instead of the last 300. `panel.html?demo&flood=5000` loads
  synthetic data for scale testing.
- Keyboard: `/` focuses search, `f` opens the Fix tab, `Esc` clears the page highlight. The
  details tab is remembered per origin.
- `different` object props show the differing leaves (`filters.page: 1 → 2`) without expanding
  the whole value; the kind label names the first differing path.
- Root-cause page: click a root cause in a commit to see every commit it started, the components
  it re-rendered avoidably, and the fixes for them.

## 0.2.0

Library

- Every report carries `commitId` (shared by the reports of one React commit) and, in dev
  builds, `source` (`_debugSource` on React <= 18, parsed from `_debugStack` on React 19).
- DevTools bridge protocol 2: `hello` carries library version, protocol, React renderers and
  options; `pull(since)` for polling panels; `info()`, `configure()`, `getOptions()`,
  `highlight(instanceId)`, `flashAvoidable(on)` (in-page overlay), `inspect(node)`.
- `getRenderers()` / `isProductionReact()`: what react-dom registered on the DevTools hook.
  `attach` wraps `hook.inject` so hooks created by react-refresh (Vite) are covered too.
- `serializeOptions` / `deserializeOptions`, `VERSION`.
- An IIFE build (`extension/vendor/rerender-lens.js`, global `RerenderLens`) for injection.

Extension

- Store-ready packaging: `npm run build:ext` writes Chrome, Edge and Firefox zips; the manifest
  version follows `package.json`; CI uploads the zips; the release workflow publishes to the
  Chrome Web Store when secrets are configured. Listing text and privacy policy in
  `extension/store/`.
- Zero-config mode: enable an origin from the toolbar popup or the panel's Settings and tick
  *Inject the library*; the extension loads rerender-lens into the page before React.
  Optional host permissions for non-local hosts; local development hosts are on by default.
- Three-state status (no page / no library / connected with library and React versions),
  protocol-mismatch and production-build warnings.
- Polling fallback through `inspectedWindow.eval` when no content script is present.
- New views: Offenders (sortable table), Commits (root causes, render cascade, contexts),
  Fixes (ranked by avoidable re-renders removed, with snippets). Per-report Fix tab.
- Hover-to-highlight and flash of avoidable renders in the page; "open source" links into the
  Sources panel; Copy as Markdown; JSON export/import.
- Settings drawer driving `configure()` live, persisted per origin; panel state (filters,
  collapsed nodes, split width) persisted per origin.
- Elements-panel sidebar for `$0`; toolbar badge with the avoidable count per tab.
- Reports are batched per animation frame; malformed payloads are ignored.
- Playwright end-to-end suite (`npm run e2e`) running Chromium with the extension against the
  example app (relay, badge, injection, panel).

## 0.1.0

Initial release.

- `init(options)` observes React commits through the DevTools global hook and reports every
  update of a tracked component. No patching, no wrappers: Fast Refresh, memo comparators,
  forwardRef, classes and the automatic JSX runtime all work unchanged.
- Change classification: `deep-equal`, `function`, `element`, `different`, `added`, `removed`.
- Trigger classification: `props`, `parent`, `state`, `hooks`, `mixed`; `avoidable` flag.
- `parent` (nearest ancestor that rendered, and why), `owner`, `path`, `instanceId`,
  `renderCount`, `selfDuration` on every report.
- Hook state (`useState`, `useReducer`, `useSyncExternalStore`) and `useContext` diffs.
- `useWhyRerender(name, values)` hook for tracking one component without `init`.
- `createCollector()` with `assertNoAvoidable()` for tests; `combineNotifiers()`.
- `createDevtoolsNotifier()` posting structured-clone-safe reports on `window`.
- `ignoreHotReload` and `maxReportsPerComponent` options.
- Example Vite app with three deliberate re-render bugs.
