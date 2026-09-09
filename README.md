# rerender-lens

Find avoidable React re-renders and see exactly what caused them: which prop, state or context,
which ancestor started the cascade, and the fix.

It reads the fiber tree after each commit through the same global hook React DevTools uses.
Nothing in React is patched, so it works with Fast Refresh, `React.memo`, `forwardRef`, class
components and any bundler.

```
▸ [rerender-lens] <ProductRow> avoidable re-render: 1 equal by value, 1 new function
    - caused by <ProductPage> re-rendering (its state changed).
    - prop "style" is a new reference but deep-equal to the previous value: memoize it with useMemo, or hoist it.
    - prop "onSelect" is a new function instance on every render: wrap it in useCallback.
    at App > ProductPage > ProductRow
```

## Pick a way in

| You have | Do this | You get |
| --- | --- | --- |
| Any React app, no code changes | Install the [DevTools extension](#devtools-extension) | A **Re-renders** panel in DevTools |
| A Vite app | `rerenderLens()` in `vite.config.ts` | Console output, the panel at `/__rerender-lens/`, no extension needed |
| Next.js, Webpack, anything else | `import 'rerender-lens/setup'` + `npx rerender-lens panel` | The same panel in any browser tab |
| Tests | `rerender-lens/vitest`, `rerender-lens/jest` or `rerender-lens/playwright` | Failing tests and CI budgets for avoidable re-renders |

## DevTools extension

Adds a **Re-renders** tab: the component tree with avoidable counts, why each component rendered,
the props and hooks that changed, and the fix as a snippet. Other views rank components by wasted
renders (Offenders), group renders by React commit with their root cause (Commits), rank every fix
by how many re-renders it removes (Fixes), and compare a recording before and after a fix
(Sessions). A timeline strip above the tree draws one bar per commit sized by its renders and
coloured by its avoidable share: click a bar for that commit, drag across bars to brush a time
window that every view narrows to. Also: an Elements-panel sidebar, a badge with the tab's
avoidable count, hover to highlight in the page, "open source" links, and the same panel next to
the page (side panel) or in its own window.

**Install** (until the Web Store listing is live): download `rerender-lens-chrome-<version>.zip`
from the [latest release](https://github.com/NexaLeaf/rerender-lens/releases), unzip it, open
`chrome://extensions`, turn on *Developer mode*, *Load unpacked*, pick the folder. Edge loads the
same folder; Firefox 128+ uses the `firefox` zip via `about:debugging`.

**Connect a page.** Local hosts (`localhost`, `127.0.0.1`, `*.localhost`, `*.local`) work out of
the box; for any other site click the toolbar icon and *Enable on this site*. Then either tick
*Inject the library* (the extension loads rerender-lens before React; no app code) or let the page
run the library itself:

```ts
import { init, createDevtoolsNotifier } from 'rerender-lens';
init({ trackAllMemoized: true, silent: true, notifier: createDevtoolsNotifier() });
```

Injection tracks every `memo` / `PureComponent` and leaves the hook/context/state snapshots off
(*Include state* in Settings turns them on; they are the costliest part on large apps). Settings
are saved per origin. Details, shortcuts and packaging: [`extension/README.md`](extension/README.md).

## Vite

```ts
// vite.config.ts
import { rerenderLens } from 'rerender-lens/vite';
export default defineConfig({ plugins: [react(), rerenderLens({ trackAllMemoized: true, panel: true })] });
```

Dev only (`vite build` is untouched). `panel: true` serves the panel at
`http://localhost:5173/__rerender-lens/`; the app and the panel talk over a same-origin
`BroadcastChannel`, so no extension is needed. `pages: ['/']` limits which HTML pages get the
setup script; `devtools: false` skips the bridge.

## Next.js, Webpack, anything

```ts
// Next.js: instrumentation-client.ts        // Webpack / Rspack: entry: ['rerender-lens/setup', './src/index.tsx']
import 'rerender-lens/setup';
```

The setup entry starts the library with every `memo` / `PureComponent` tracked, outside
production builds. To see the panel without the extension:

```sh
npx rerender-lens panel           # http://127.0.0.1:4141/  (--port, --host 0.0.0.0 for another machine)
```

and point the app at it with `RERENDER_LENS_RELAY=http://127.0.0.1:4141`
(`NEXT_PUBLIC_RERENDER_LENS_RELAY` for Next.js), `createDevtoolsNotifier({ relay })`, or
`window.__RERENDER_LENS_RELAY__` set before the app loads. Settings, highlight and replay travel
back to the app, and the panel re-attaches when an app reloads. Point **several apps** at one relay
(a host app and a microfrontend, two pages, two machines) and the panel shows a picker listing each
by address; it watches one at a time and commands go only to that one.

## Manual setup

```ts
import { init } from 'rerender-lens';
if (import.meta.env.DEV) init({ trackAllMemoized: true, include: [/^Grid/, 'Sidebar'], exclude: ['DevOverlay'] });
```

Import it before `react-dom` (React looks for the DevTools hook once, when it loads). Mark single
components with `track(Comp)` or `Comp.rerenderLens = true`; `configure()` changes options at
runtime. Inside a library or Storybook, `useWhyRerender('Row', { ...props, theme })` reports one
component without `init`.

## Tests and CI

**Vitest**, whole suite, two config lines:

```ts
test: {
  setupFiles: ['rerender-lens/vitest/setup'],
  reporters: ['default', ['rerender-lens/vitest', { budget: 'rerender-budget.json' }]],
}
```

The reporter prints the run's ranked fixes and root causes, fails on budget violations, and can
write a panel-compatible export. Custom options: `setupRerenderLens(options, { afterAll })`.

**Jest**, the same two lines (`setupFilesAfterEnv`, not `setupFiles`: the hook needs `afterAll`):

```js
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['rerender-lens/jest/setup'],
  reporters: ['default', ['rerender-lens/jest', { budget: 'rerender-budget.json' }]],
};
```

Same options and same output as the Vitest reporter; a budget violation fails the run.

**Playwright**, real browser:

```ts
import { installRerenderLens, pullReports, expectWithinBudget } from 'rerender-lens/playwright';
await installRerenderLens(page, { include: ['ProductRow'] }); // before page.goto
await page.goto('/products');
expectWithinBudget(await pullReports(page), { '*': 0 });     // throws with the ranked fixes
```

**Any test runner**, per test:

```ts
const collector = createCollector();
beforeAll(() => init({ trackAllMemoized: true, silent: true, notifier: collector.notifier }));
test('search does not re-render the rows', () => { /* ... */ collector.assertNoAvoidable(); });
```

**CLI**, on a panel export or a session summary:

```sh
npx rerender-lens fixes export.json                        # ranked fixes, then root causes
npx rerender-lens causes export.json                       # which component started each cascade
npx rerender-lens budget export.json --init > rerender-budget.json
npx rerender-lens budget export.json rerender-budget.json  # exit 1 when a component exceeds its budget
npx rerender-lens summary export.json --out before.json && npx rerender-lens compare before.json after.json
```

## What a report says

Every re-render of a tracked component is a `RenderReport`. The fields you will read:

| Field | Meaning |
| --- | --- |
| `component`, `path`, `owner` | display name, ancestry from the root, who created the element |
| `trigger` | `props`, `parent`, `state`, `hooks` or `mixed` |
| `avoidable` | `true` when nothing genuinely changed |
| `propChanges`, `stateChanges`, `hookChanges` | what changed: `path`, `kind`, `prev`, `next`; context entries name the provider and the changed keys |
| `hookState`, `contexts`, `state` | every hook, context and class state value (`includeState`) |
| `parent`, `updaters` | the ancestor that rendered in the same commit and why; the components that scheduled the commit |
| `commitId`, `commitPriority`, `commitCause` | one id per React commit; discrete input / transition / idle; `effect-after-commit` or `suspense-resolved` |
| `selfDuration`, `treeDuration`, `source` | render time (dev/profiling builds); file, line and column of the element |
| `reasons` | the explanations with the fix, as printed |

| `kind` | Means | Fix |
| --- | --- | --- |
| `deep-equal` | new reference, same contents | `useMemo`, or hoist a constant |
| `function` | new function, same body | `useCallback` |
| `element` | new element, same type and props | `useMemo` the element or pass it as `children` |
| `different` | a real change | none |

A `parent` trigger with no changes means identical props and an ancestor re-rendered: wrap the
component in `React.memo`.

## What counts as avoidable

`avoidable` is true when the render produced no genuine change in props, state or hooks *and*
nothing about the situation explains the render away. The rules, on the shapes modern apps produce
(each row is a test in `test/modern.test.ts` and a card on the example's `/modern.html`):

| Situation | Verdict | Why / fix |
| --- | --- | --- |
| Parent re-rendered, identical props, plain function or class component | avoidable, `parent` | wrap in `React.memo`; classes: extend `PureComponent` or implement `shouldComponentUpdate` |
| Same, but the component is compiled by React Compiler (`compiled: true`) | **not avoidable** | React still calls it, but its output comes from the memo cache and the render is cheap; a compiled app re-renders every component on a parent update and flagging them all would be noise. A new-but-equal prop (`deep-equal`, `function`, `element`) still misses the cache and stays avoidable, with the upstream fix and no `React.memo` advice |
| `memo` / `PureComponent` / `shouldComponentUpdate → false` with equal props | no report | React bailed out; the component never rendered |
| Inline object, array or element prop (`deep-equal`, `element`) | avoidable | `useMemo`, hoist constants, pass static elements as `children` from a stable parent |
| Inline callback or render prop (`function`), e.g. `renderItem={(x) => …}` on a memo list | avoidable | `useCallback` or hoist it. **Limitation:** functions are compared by name and source, so a new closure with the same text that captures a *changed* value is still `function` and counted as avoidable, even though its output differs |
| `ref` is a new `{ current }` object on every render (React 19 keeps `ref` in props; forwardRef and memo see it) | avoidable, `deep-equal` on `ref` | `useRef` (or `createRef` outside the render); `.current` is ignored because React mutates it when it re-attaches the ref. An inline callback ref is `function`: `useCallback` |
| `useSyncExternalStore` / store selector returning a new object with equal contents | avoidable, hook `deep-equal` | store-specific advice: return a stored slice, `shallowEqual` / `createSelector` (Redux), `useShallow` (Zustand), or cache the snapshot. A selector returning a primitive does not render at all |
| `useState`/`setState` with a value deep-equal to the current one | avoidable | reuse the existing object or bail out before calling the setter |
| A genuine prop, state, context or store change | not avoidable (`props` / `state` / `hooks` / `mixed`) | the change is listed with its path |
| `startTransition(() => setState(…))` | parent: `state` at `commitPriority: 'normal'`, not avoidable; memo children with equal props: no report | nothing to fix |
| Content revealed by a Suspense boundary (`use(promise)` resolved, `React.lazy` loaded) | **not avoidable**, `commitCause: 'suspense-resolved'` | React re-renders the content it kept hidden while the fallback was shown; the component that suspended has a genuinely new promise (`props`). Components outside the boundary in the same commit keep the usual verdict |
| The deferred second render of `useDeferredValue` (dev builds) | not avoidable, `hooks` with a `useDeferredValue` change | React's catch-up render; it is also never mistaken for an effect → setState loop. `useId` and a stable deferred input add no hook changes |
| Mount, StrictMode's double render, a Fast Refresh commit | no report | never reported (StrictMode is one commit) |

## Options

| Option | Default | |
| --- | --- | --- |
| `trackAllMemoized` | `false` | track every `memo` / `PureComponent` |
| `trackAllComponents` | `false` | track everything (noisy) |
| `include` / `exclude` | | display-name matchers: string, RegExp or predicate |
| `trackHooks` | `true` | diff hook state and contexts |
| `includeState` | `true` (`false` when injected) | put every hook, context and class state value on each report; the costliest option on large trees |
| `resolveHookNames` | `false` | label hooks with the custom hooks that own them (`useCart › useState#0`) |
| `logAll` | `false` | print non-avoidable reports too |
| `silent` | `false` | never print; the notifier still runs |
| `notifier` | | receives every `RenderReport` |
| `ignoreHotReload` | `true` | skip commits caused by Fast Refresh |
| `maxReportsPerComponent` | `0` | stop printing a component after N reports |
| `collapse`, `console` | `true`, `console` | console group style and sink |

## API

```ts
init(options?): () => void          configure(options)   disable()   isEnabled()
track(component, name?)             useWhyRerender(name, values, options?)
ensureDevtoolsHook()                // create the global hook early (test setup files)
createCollector()                   // { reports, avoidable, notifier, clear, assertNoAvoidable, assertWithinBudget, fixes, summary }
createDevtoolsNotifier({ bufferSize?, target?, maxDepth?, flashAvoidable?, channel?, relay? })
rankFixes, formatFixes, rankRootCauses, formatRootCauses, analyzeCommit, rootCauseOf
summarizeReports, compareSummaries, formatComparison, parseExport
checkBudget, toBudget, assertWithinBudget
combineNotifiers, getRenderers, isProductionReact, serializeOptions, deserializeOptions, VERSION
// rerender-lens/vite       rerenderLens(options)
// rerender-lens/setup      side-effect entry
// rerender-lens/relay      createRelayServer({ port?, host? })
// rerender-lens/vitest     setupRerenderLens(options?, { afterAll }), default reporter; rerender-lens/vitest/setup
// rerender-lens/playwright installRerenderLens(page, options?), pullReports, clearReports, expectWithinBudget
```

The bridge at `window.__RERENDER_LENS_DEVTOOLS__` (`replay`, `clear`, `pull`, `info`, `configure`,
`highlight`, `flashAvoidable`, `inspect`) is what the extension and the panels talk to. Reports are
serialized with bounds (100 entries per container, depth 4, 20k nodes per report) and posted on
`window` only once a listener announced itself, so a page nobody inspects pays nothing per report.

## How it works

- After each commit the fiber tree is walked from the root, skipping subtrees React bailed out
  of. A component rendered when React set its `PerformedWork` flag; props, class state, hook
  nodes and context reads are compared with the fiber's alternate.
- Work per commit is bounded: equality is memoized across the commit and gives up on values too
  large to walk, at most 200 components are reported per commit (the rest is counted in
  `info().truncated`), and a commit stops after 25 ms.
- A commit in which Fast Refresh swapped a component's code is skipped. Mounts are never reported;
  StrictMode's double render is one commit and reports once.
- Development only: everything runs inside React's commit callback. Production builds are
  detected and flagged (names may be minified).
- Fiber fields have been stable since React 16.9; the walk is wrapped so a change in React logs
  one warning instead of breaking the app.

The suite runs on React 19, 18 and 17 in CI. What each version gives you:

| | React 19 | React 18 | React 17 |
| --- | --- | --- | --- |
| Props, state, parent attribution, avoidable verdicts, `memo` / `forwardRef` / classes | yes | yes | yes |
| Context changes (`useContext`, provider attribution) | yes | yes | no: React only records the value a component read from a context from 18 on, so a context change looks like a plain parent re-render (the library says so once) |
| `updaters` (who scheduled the commit) and effect-loop detection | yes | yes | no: React's updater tracking starts at 18 |
| `useSyncExternalStore`, `useTransition`, `useDeferredValue`, `useId` | yes | yes | not in React 17 |
| `use()`, `ref` as a prop, React Compiler output | yes | no | no |

## Examples

`examples/vite-react` has three deliberate bugs and the built-in panel; `scale.html?rows=3000` is
the scale test with a readout of the library's own cost. `examples/next` is the same app in
Next.js, started from `instrumentation-client.ts` and reporting to the relay panel.

```sh
npm install && npm --prefix examples/vite-react install
npm run dev:example          # http://localhost:5199/  and  /__rerender-lens/
```

## Migrating from why-did-you-render

| why-did-you-render | rerender-lens |
| --- | --- |
| `whyDidYouRender(React, opts)` | `init(opts)` |
| `trackAllPureComponents` | `trackAllMemoized` |
| `Comp.whyDidYouRender = true` | `track(Comp)` or `Comp.rerenderLens = true` |
| `include` / `exclude` (RegExp[]) | same, plus strings and predicates |
| `logOnDifferentValues` | `logAll` |
| `logOwnerReasons` | always on: `parent` and `owner` |
| `notifier({ Component, prevProps, ... })` | `notifier(report: RenderReport)` |
| `jsxImportSource` | not needed |

## License

MIT
