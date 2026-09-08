# Changelog

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
