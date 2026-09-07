# rerender-lens

React re-render debugger. See README.md for the public API.

## Commands

- `npm test` (vitest, jsdom), `npm run typecheck`, `npm run build` (tsup), `npm run lint:pkg` (publint + attw).
- `npm run check` runs all of the above and is `prepublishOnly`.
- `npm run dev:example` builds the library and starts `examples/vite-react` on port 5199 (install it first with `npm --prefix examples/vite-react install`).

## Layout

- `src/types.ts` — public types, `MARKER` (`rerenderLens` static).
- `src/diff.ts` — `deepEqual`, `classify`, `diffRecords`, `firstDifferentPath`. Pure.
- `src/report.ts` — `buildReport` (trigger/avoidable/reasons), `printReport`, `summarize`. Pure.
- `src/state.ts` — options + enabled flag on `globalThis[Symbol.for('rerender-lens.state')]`; `dispatch` prints (with the per-component cap) and notifies.
- `src/fiber.ts` — the core: `ensureDevtoolsHook`, `attach` (wraps `hook.onCommitFiberRoot`), `onCommit` (tree walk + analysis).
- `src/tracker.ts` — `init`/`configure`/`disable`, `shouldTrack`, `getDisplayName`, `track`.
- `src/hook.ts` — `useWhyRerender`. `src/notifiers.ts` — collector. `src/devtools.ts` — postMessage bridge.
- `examples/vite-react` — dogfood app (links the library via `file:../..`, so `npm run build` first).

## Design decisions

- Fiber inspection instead of wrapping element types. The earlier wrapper design broke Fast Refresh (a wrapped component never received its edits, because refresh families are keyed by the original function and Vite's plugin-react injects module-local `$RefreshReg$`, so there is no way to join a family from outside). Reading fibers is what React DevTools does; it needs no import-order tricks and no `jsxImportSource`.
- "Did it render" = `flags & PerformedWork` (1). Skip a subtree when `fiber.child === fiber.alternate.child` (React reused the children, so nothing below rendered). Fresh fibers always have fresh flags; stale ones are only reachable through a skipped subtree.
- Hot reload detection: `fiber.type !== fiber.alternate.type` on a rendered component (React assigns `family.current` to the work-in-progress type in `createWorkInProgress`). Such a commit is skipped when `ignoreHotReload` is on.
- Hook diffing only looks at nodes with a `queue.lastRenderedReducer` (state) or `queue.getSnapshot` (external store). `_debugHookTypes` is used for labels only when its length matches the node count after removing node-less hooks (`useContext`, `useDebugValue`, `use`), because `useTransition`/`useSyncExternalStore` create several nodes per call.
- `useState`/`useReducer` changes are trigger `state`; `useContext`/`useSyncExternalStore` are `hooks`.
- Console prints only avoidable reports unless `logAll`; the notifier gets everything.
- Mount is never reported; StrictMode's double render is one commit and reports once.

## Testing conventions

- `test/setup.ts` calls `ensureDevtoolsHook()` before any test imports `react-dom`; otherwise react-dom never injects and no commits are observed.
- Synthetic-fiber tests in `test/tracker.test.ts` cover hot-reload suppression, bailout pruning and React 16 `effectTag`.
- Anonymous arrows have no name; use `track(fn, 'Name')` or a named function.
