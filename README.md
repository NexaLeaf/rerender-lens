# rerender-lens

Find avoidable React re-renders and see exactly what caused them: which prop, which state,
which context, and which ancestor started the update.

It reads the fiber tree after every commit through the same global hook React DevTools uses.
Nothing in React is patched or wrapped, so it works with Fast Refresh, `React.memo` comparators,
`forwardRef`, class components, the automatic JSX runtime, and any bundler.

```
▸ [rerender-lens] <ProductRow> avoidable re-render: 1 equal by value, 1 new function
    - caused by <ProductPage> re-rendering (its state changed).
    - prop "style" is a new reference but deep-equal to the previous value: memoize the object with useMemo, or hoist it to module scope if it is constant.
    - prop "onSelect" is a new function instance on every render: wrap it in useCallback (or hoist it out of the parent's render).
    at App > ProductPage > ProductRow
```

## Install

```sh
npm i -D rerender-lens
```

Peer dependency: `react >= 16.8`. Tested with React 18 and 19.

## Setup

```ts
// src/rerender-lens.ts
import { init } from 'rerender-lens';

if (import.meta.env.DEV) {
  init({ trackAllMemoized: true });
}
```

```ts
// src/main.tsx
import './rerender-lens';
import { createRoot } from 'react-dom/client';
...
```

Import the setup file before `react-dom`. React DOM looks for the DevTools hook once, when its
module loads; `init` creates the hook if nothing else did. If the React DevTools extension is
installed, or Vite's Fast Refresh preamble runs, the hook already exists and order does not matter.

No `jsxImportSource`, no default-import requirement, no Babel plugin.

## Choosing what to track

```ts
init({
  trackAllMemoized: true,        // every React.memo and PureComponent
  include: [/^Grid/, 'Sidebar'], // by display name: string, RegExp or predicate
  exclude: ['DevOverlay'],
});
```

Or mark a component:

```ts
import { track } from 'rerender-lens';

export const ProductRow = track(function ProductRow(props: Props) { ... });
export default track(memo(Sidebar));
export const Cell = track((props: CellProps) => ..., 'Cell'); // name for anonymous arrows
```

Marking sets the static `rerenderLens = true`; you can also set it by hand. `configure()`
changes any option at runtime without remounting anything.

## What a report contains

Every update of a tracked component produces a `RenderReport`:

| Field | Meaning |
| --- | --- |
| `component` | display name |
| `trigger` | `props`, `parent`, `state`, `hooks` or `mixed` |
| `avoidable` | `true` when nothing genuinely changed |
| `propChanges` | one entry per changed prop with `path`, `kind`, `prev`, `next` |
| `stateChanges` | class components: `this.state` diff |
| `hookChanges` | `useState`, `useReducer`, `useSyncExternalStore` and `useContext` values that changed |
| `parent` | nearest ancestor that rendered in the same commit, and why |
| `owner` | component that created the element (dev builds) |
| `path` | component ancestry from the root |
| `instanceId`, `renderCount` | stable per mounted instance |
| `memoized` | `React.memo` / `PureComponent`: props alone decide whether it re-renders |
| `selfDuration`, `treeDuration` | own render time, and with everything below that rendered (dev/profiling builds) |
| `commitId` | shared by every report of one React commit |
| `source` | file, line and column where the element was created (dev builds) |
| `reasons` | human-readable explanations with the fix |

Change kinds:

| `kind` | Means | Fix |
| --- | --- | --- |
| `deep-equal` | new reference, same contents | `useMemo`, or hoist a constant |
| `function` | new function, same body | `useCallback` |
| `element` | new element, same type and props | `useMemo` the element or pass it as `children` |
| `different` | a real change | none needed |
| `added` / `removed` | key appeared or disappeared | usually a real change |

A `parent` trigger with no changes at all means: identical props, an ancestor re-rendered.
Wrap the component in `React.memo`.

By default only avoidable re-renders are printed; pass `logAll: true` to print every report.
The `notifier` always receives every report.

## Use in tests

```ts
import { init, disable, createCollector } from 'rerender-lens';

const collector = createCollector();
beforeAll(() => init({ trackAllMemoized: true, silent: true, notifier: collector.notifier }));
afterAll(disable);
beforeEach(collector.clear);

test('typing in the search box does not re-render the grid rows', async () => {
  render(<ProductPage />);
  await user.type(screen.getByRole('searchbox'), 'abc');
  collector.assertNoAvoidable(); // throws listing every component and reason
  // or: expect(collector.avoidable).toHaveLength(0)
});
```

In Vitest or Jest, call `ensureDevtoolsHook()` (or `init`) from a `setupFiles` entry so the hook
exists before `react-dom` is imported by your tests.

## Track a single component from the inside

Works anywhere without `init`, for example inside library packages or Storybook:

```ts
import { useWhyRerender } from 'rerender-lens';

function Row(props: RowProps) {
  const theme = useContext(ThemeContext);
  useWhyRerender('Row', { ...props, theme });
  ...
}
```

Pass whatever values you want compared.

## DevTools bridge

```ts
import { createDevtoolsNotifier } from 'rerender-lens';

init({ trackAllMemoized: true, silent: true, notifier: createDevtoolsNotifier() });
```

Each report is serialized (functions become `ƒ name`, elements `<Type>`, cycles cut) and posted
on `window` as `{ __rerenderLens: true, version: 2, type: 'report', payload }`. The last 300
reports are buffered. The bridge at `window.__RERENDER_LENS_DEVTOOLS__` exposes:

| Method | |
| --- | --- |
| `replay()` / `clear()` | re-post or drop the buffer |
| `pull(since)` | reports newer than a sequence number, for panels that poll instead of listening |
| `info()` | library version, protocol, React renderers (version, dev/prod), current options |
| `configure(options)` / `getOptions()` | change options at runtime; matchers as strings (`"/^Grid/"`) |
| `highlight(instanceId)` / `flashAvoidable(on)` | outline a component's DOM in the page, or flash avoidable renders |
| `inspect(node)` | component, instance id and recent reports for a DOM node (DevTools `$0`) |

The Chrome extension in `extension/` consumes this. With the extension you do not even need the
`init` call: enable *Inject the library* for an origin and the extension loads rerender-lens into
the page before React (see `extension/README.md`).

Every report also carries `commitId` (shared by all reports of one React commit) and, in dev
builds, `source` (where the element was created).

## API

```ts
init(options?): () => void              // returns disable
configure(options): void                // merge options at runtime
disable(): void
isEnabled(): boolean
track(component, name?): component
ensureDevtoolsHook(): hook              // create the global hook early (test setup files)
useWhyRerender(name, values, options?)
createCollector(): { reports, avoidable, notifier, clear, assertNoAvoidable }
combineNotifiers(...notifiers): Notifier
createDevtoolsNotifier({ bufferSize?, target?, maxDepth?, flashAvoidable? }): Notifier
getRenderers(), isProductionReact()       // what react-dom registered on the DevTools hook
serializeOptions(o), deserializeOptions(o) // Options <-> JSON-safe form used by the bridge
VERSION
deepEqual(a, b), diffRecords(prev, next), classify(prev, next)
```

`Options`:

| Option | Default | |
| --- | --- | --- |
| `trackAllMemoized` | `false` | track every `memo` / `PureComponent` |
| `trackAllComponents` | `false` | track everything (noisy) |
| `include` / `exclude` | | display-name matchers |
| `trackHooks` | `true` | diff hook state and contexts |
| `logAll` | `false` | print non-avoidable reports too |
| `silent` | `false` | never print; notifier still runs |
| `notifier` | | receives every `RenderReport` |
| `collapse` | `true` | `console.groupCollapsed` vs `console.group` |
| `console` | `console` | sink for printing |
| `ignoreHotReload` | `true` | skip commits caused by Fast Refresh |
| `maxReportsPerComponent` | `0` | stop printing a component after N reports |

## How it works, and the caveats that follow

- After each commit, the fiber tree is walked from the root, skipping subtrees React bailed out
  of. A component counts as re-rendered when React set its `PerformedWork` flag. Props, class
  state, hook state nodes and context dependencies are compared against the fiber's alternate.
- Hook labels come from React's dev-only hook type list when it maps one-to-one onto the state
  nodes; otherwise nodes are labelled by inspection (`useState`, `useReducer`,
  `useSyncExternalStore`, or `state` for internal nodes of `useTransition` and friends).
- A commit in which Fast Refresh swapped a component's code is skipped entirely
  (`ignoreHotReload`). The edited component's children re-render with identical props during
  that commit, which would otherwise look like avoidable re-renders.
- The mount render is never reported. StrictMode's double render happens inside one commit and
  is reported once.
- Everything runs during React's commit callback, synchronously. It is meant for development;
  keep it out of production builds.
- Fiber field names have been stable since React 16.9 (`flags` was `effectTag` before 17; both
  are handled). Future React versions may change internals; the walk is wrapped so a failure
  logs one warning instead of breaking the app.

## Example app

`examples/vite-react` has three deliberate bugs. From the repo root:

```sh
npm install
npm --prefix examples/vite-react install
npm run dev:example
```

## Migrating from why-did-you-render

| why-did-you-render | rerender-lens |
| --- | --- |
| `whyDidYouRender(React, opts)` | `init(opts)` |
| `trackAllPureComponents` | `trackAllMemoized` |
| `Comp.whyDidYouRender = true` | `track(Comp)` or `Comp.rerenderLens = true` |
| `include` / `exclude` (RegExp[]) | same, plus strings and predicates |
| `trackHooks` | same |
| `logOnDifferentValues` | `logAll` |
| `logOwnerReasons` | always on: `parent` and `owner` fields |
| `notifier` (`{ Component, prevProps, ... }`) | `notifier` (`RenderReport`) |
| `jsxImportSource: '@welldone-software/why-did-you-render'` | not needed |

## License

MIT
