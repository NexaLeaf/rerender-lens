# Changelog

## 0.1.0

Initial release.

- `init(React, options)` patches `createElement` and the state hooks; tracked components report every update.
- Change classification: `deep-equal`, `function`, `element`, `different`, `added`, `removed`.
- Trigger classification: `props`, `parent`, `state`, `hooks`, `mixed`; `avoidable` flag.
- Supports function components, `React.memo` (custom comparators preserved), `forwardRef`, `memo(forwardRef())`, class and `PureComponent` components.
- `useWhyRerender(name, values)` hook for tracking one component without patching.
- `createCollector()` with `assertNoAvoidable()` for tests; `combineNotifiers()`.
- `createDevtoolsNotifier()` posting structured-clone-safe reports on `window` for a DevTools panel.
- `rerender-lens/jsx-runtime` and `rerender-lens/jsx-dev-runtime` for the automatic JSX runtime.
- StrictMode double-render is not reported.
