# rerender-lens

React re-render debugger. See README.md for the public API.

## Commands

- `npm test` — vitest (jsdom). `npm run typecheck`, `npm run build` (tsup), `npm run lint:pkg` (publint + attw).
- `npm run check` runs all of the above; it is also `prepublishOnly`.

## Layout

- `src/types.ts` — public types, `MARKER` (`rerenderLens` static).
- `src/diff.ts` — `deepEqual`, `classify`, `diffRecords`, `firstDifferentPath`. Pure.
- `src/report.ts` — `buildReport` (trigger/avoidable/reasons), `printReport`, `summarize`. Pure.
- `src/state.ts` — global state on `globalThis[Symbol.for('rerender-lens.state')]` so ESM/CJS builds and the jsx-runtime entries share one instance; `dispatch` prints and notifies.
- `src/tracker.ts` — `init`/`configure`/`disable`, `resolveType`, wrappers for function/memo/forwardRef/class.
- `src/hook.ts` — `useWhyRerender`. `src/notifiers.ts` — collector. `src/devtools.ts` — postMessage bridge.
- `src/jsx-runtime.ts`, `src/jsx-dev-runtime.ts` — wrap `react/jsx-runtime` for `jsxImportSource`.

## Design decisions

- Wrappers are cached per original type (WeakMap) so element identity is stable; track/no-track decisions are cached per `configure()` generation.
- Reports fire during render (function components) or in `componentDidUpdate` (classes). Mount is never reported.
- StrictMode rule: same props object + same hook values by reference = React re-invoked the render, skip.
- `useState`/`useReducer` changes are trigger `state`; `useContext`/`useSyncExternalStore` are `hooks`.
- Console prints only avoidable reports unless `logAll`; the notifier gets everything.
- `ReactLike` is structural so the default import type-checks under NodeNext.

## Testing conventions

- Tests call `React.createElement` through `h` in `test/helpers.ts`, which resolves the function at call time (the patch replaces the property). Never capture `React.createElement` at import.
- Components in tests call `React.useState` etc. as property accesses for the same reason.
- Anonymous arrows have no name; use `track(fn, 'Name')` or a named function.
