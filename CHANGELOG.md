# Changelog

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
