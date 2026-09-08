# rerender-lens

React re-render debugger. See README.md for the public API.

## Commands

- `npm test` (vitest, jsdom), `npm run typecheck`, `npm run build` (tsup: `dist/` + the IIFE `extension/vendor/rerender-lens.js`), `npm run lint:pkg` (publint + attw).
- `npm run build:ext` packages `extension/` into `dist-extension/` (Chrome/Edge/Firefox zips; syncs the manifest version from package.json).
- `npm run check` runs all of the above and is `prepublishOnly`.
- `npm run e2e` (Playwright, Chromium with the extension loaded against the example app; needs `npm run build` and `npm --prefix examples/vite-react install` first).
- `npm run dev:example` builds the library and starts `examples/vite-react` on port 5199 (`/` runs the library itself, `/plain.html` does not, for testing injection).

## Layout

- `src/types.ts` — public types, `MARKER` (`rerenderLens` static).
- `src/diff.ts` — `deepEqual`, `classify`, `diffRecords`, `firstDifferentPath`. Pure.
- `src/report.ts` — `buildReport` (trigger/avoidable/reasons), `printReport`, `summarize`. Pure.
- `src/state.ts` — options + enabled flag on `globalThis[Symbol.for('rerender-lens.state')]`; `dispatch` prints (with the per-component cap) and notifies.
- `src/fiber.ts` — the core: `ensureDevtoolsHook`, `attach` (wraps `hook.onCommitFiberRoot` and `hook.inject`), `onCommit` (tree walk + analysis), instance registry (`fiberById`, `hostNodesOf`, `fiberForNode`), `sourceOf`, `getRenderers`.
- `src/tracker.ts` — `init`/`configure`/`disable`, `shouldTrack`, `getDisplayName`, `track`.
- `src/hook.ts` — `useWhyRerender`. `src/notifiers.ts` — collector. `src/overlay.ts` — in-page highlight/flash DOM.
- `src/devtools.ts` — postMessage bridge (protocol 2): `createDevtoolsNotifier`, `window.__RERENDER_LENS_DEVTOOLS__` (`replay`, `pull`, `info`, `configure`, `highlight`, `inspect`, ...), `serializeOptions`.
- `src/inject.ts` — entry of the IIFE bundle (everything but `useWhyRerender`, which needs `react` as a module). `src/version.ts` — `VERSION` from a build define.
- `examples/vite-react` — dogfood app (links the library via `file:../..`, so `npm run build` first).
- `extension/` — MV3 DevTools extension, plain JS, no build except the vendored library bundle. `panel.js` exposes `RerenderLensPanel.createPanel(root, transport)` plus pure `analysis` helpers (`fixesFor`, `rankFixes`, `rootCauseOf`, `analyzeCommit`); `panel.html?demo` runs it with sample data; `background.js` routes messages, keeps the badge and registers per-origin scripts (`shared.js`); `inject.js` bootstraps the injected library; `sidebar.*` is the Elements sidebar; `popup.*` enables origins; `store/` holds listing/privacy/publishing docs.
- `scripts/` — `build-extension.mjs` (+ `zip.mjs`, dependency-free zip writer), `sync-version.mjs`.
- `e2e/` — Playwright config and spec.

## Design decisions

- Fiber inspection instead of wrapping element types. The earlier wrapper design broke Fast Refresh (a wrapped component never received its edits, because refresh families are keyed by the original function and Vite's plugin-react injects module-local `$RefreshReg$`, so there is no way to join a family from outside). Reading fibers is what React DevTools does; it needs no import-order tricks and no `jsxImportSource`.
- "Did it render" = `flags & PerformedWork` (1). Skip a subtree when `fiber.child === fiber.alternate.child` (React reused the children, so nothing below rendered). Fresh fibers always have fresh flags; stale ones are only reachable through a skipped subtree.
- Hot reload detection: `fiber.type !== fiber.alternate.type` on a rendered component (React assigns `family.current` to the work-in-progress type in `createWorkInProgress`). Such a commit is skipped when `ignoreHotReload` is on.
- Hook diffing only looks at nodes with a `queue.lastRenderedReducer` (state) or `queue.getSnapshot` (external store). `_debugHookTypes` is used for labels only when its length matches the node count after removing node-less hooks (`useContext`, `useDebugValue`, `use`), because `useTransition`/`useSyncExternalStore` create several nodes per call.
- `useState`/`useReducer` changes are trigger `state`; `useContext`/`useSyncExternalStore` are `hooks`.
- Console prints only avoidable reports unless `logAll`; the notifier gets everything.
- Mount is never reported; StrictMode's double render is one commit and reports once.
- `commitId` is assigned per `onCommit` call that produced at least one report. `source` comes from `_debugSource` (React <= 18) or the first non-React frame of `_debugStack` (React 19).
- React renderer info: hooks created by react-refresh never fill `hook.renderers`, so `attach` wraps `hook.inject` and records what react-dom passes. This is why `init` should run before `react-dom` loads if you want the React version and dev/prod detection.
- Extension: dynamically registered content scripts (injection, relay on user-enabled origins) need real host permissions, so the manifest declares `host_permissions` for the local hosts and `optional_host_permissions` for everything else; nothing beyond local hosts is granted until the user enables a site. Injection is off until enabled per origin. If the extension's hook is created before React DevTools installs its own, React DevTools bails out; documented as a known limitation.
- `selfDuration` = `actualDuration` minus the direct children's `actualDuration` (React resets it to 0 in `createWorkInProgress`, so bailed-out children add nothing); `treeDuration` is the raw value. `memoized` comes from the fiber tag (14/15) or `stateNode.isPureReactComponent`.
- Injection "defer" mode is a one-line flag script (`inject-deferred.js`) listed before `inject.js`; the injector then creates/wraps the hook in a `setTimeout(0)`. Kept as a per-origin toggle rather than a default because a synchronous `<script>` in `<head>` could load react-dom before the timer fires.
- Panel transport contract: only `subscribe` is required; every other method (`pull`, `configure`, `highlight`, `storage`, `originStatus`, ...) is optional and the panel degrades (tests and demo mode use partial transports). Reports are batched per animation frame; tests call `panel.flush()`.

## Testing conventions

- `test/setup.ts` calls `ensureDevtoolsHook()` before any test imports `react-dom`; otherwise react-dom never injects and no commits are observed.
- Synthetic-fiber tests in `test/tracker.test.ts` cover hot-reload suppression, bailout pruning and React 16 `effectTag`. `test/bridge.test.ts` covers protocol 2.
- Extension runtime scripts are tested by evaluating them with `new Function` against `extension/test/fake-chrome.ts`; `background.js` returns its top-level functions that way. Await `settle()` twice after a UI change that goes through the background's async message handler.
- Anonymous arrows have no name; use `track(fn, 'Name')` or a named function. `memo(function X)` gets renamed by the dev transform (`X2`); set `displayName` on the memo.
- Instance ids are a global counter across tests: read the id from a report rather than assuming `1`.
