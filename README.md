# rerender-lens

Find avoidable React re-renders and learn exactly which prop, state or hook caused them.
A modern alternative to `why-did-you-render`: TypeScript, structured reports you can assert on
in tests, a hook for tracking a single component, and a bridge for a DevTools panel.

```
[rerender-lens] <ProductRow> avoidable re-render: 1 equal by value, 1 new function
  - prop "style" is a new reference but deep-equal to the previous value: memoize the object with useMemo, or hoist it to module scope if it is constant.
  - prop "onSelect" is a new function instance on every render: wrap it in useCallback (or hoist it out of the parent's render).
```

## Install

```sh
npm i -D rerender-lens
```

Peer dependency: `react >= 16.8`. Tested with React 18 and 19.

## Setup

Create a file that runs **before anything else imports React components**, and import it first
in your entry point. Development only.

```ts
// src/rerender-lens.ts
import React from 'react';                 // default import, not `import * as React`
import { init } from 'rerender-lens';

if (import.meta.env.DEV) {
  init(React, { trackAllMemoized: true });
}
```

```ts
// src/main.tsx
import './rerender-lens';
import { createRoot } from 'react-dom/client';
...
```

### Automatic JSX runtime (Vite, Next, TS `react-jsx`)

With the automatic runtime the compiler never calls `React.createElement`, so also point
`jsxImportSource` at this package in development:

```ts
// vite.config.ts
export default defineConfig(({ mode }) => ({
  esbuild: mode === 'development' ? { jsxImportSource: 'rerender-lens' } : undefined,
  plugins: [react({ jsxImportSource: mode === 'development' ? 'rerender-lens' : 'react' })],
}));
```

```jsonc
// tsconfig.json (or a tsconfig.dev.json)
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "rerender-lens" } }
```

Anything still using `React.createElement` (the classic runtime, `React.cloneElement` of a new
element, libraries) is covered by `init` alone.

## Choosing what to track

```ts
init(React, {
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

Marking sets the static `rerenderLens = true`; you can also set it by hand.

## What a report contains

Every update of a tracked component produces a `RenderReport`:

| Field | Meaning |
| --- | --- |
| `component` | display name |
| `trigger` | `props`, `parent`, `state`, `hooks` or `mixed` |
| `avoidable` | `true` when nothing genuinely changed |
| `propChanges` | one entry per changed prop with `path`, `kind`, `prev`, `next` |
| `stateChanges` | class components: `this.state` diff |
| `hookChanges` | `useState`, `useReducer`, `useContext`, `useSyncExternalStore` values that changed |
| `reasons` | human-readable explanations with the fix |

Change kinds:

| `kind` | Means | Fix |
| --- | --- | --- |
| `deep-equal` | new reference, same contents | `useMemo`, or hoist a constant |
| `function` | new function, same body | `useCallback` |
| `element` | new element, same type and props | `useMemo` the element or pass it as `children` |
| `different` | a real change | none needed |
| `added` / `removed` | key appeared or disappeared | usually a real change |

A `parent` trigger with no changes at all means: identical props, the parent re-rendered.
Wrap the component in `React.memo`.

By default only avoidable re-renders are printed to the console; pass `logAll: true` to print
every report. The `notifier` always receives every report.

## Use in tests

```ts
import React from 'react';
import { init, disable, createCollector } from 'rerender-lens';

const collector = createCollector();
beforeAll(() => init(React, { trackAllMemoized: true, silent: true, notifier: collector.notifier }));
afterAll(disable);
beforeEach(collector.clear);

test('typing in the search box does not re-render the grid rows', async () => {
  render(<ProductPage />);
  await user.type(screen.getByRole('searchbox'), 'abc');
  collector.assertNoAvoidable(); // throws with every component and reason
  // or: expect(collector.avoidable).toHaveLength(0)
});
```

Import order matters here too: `init` must run before the modules under test read
`React.useState` etc. A `setupFiles` entry in Vitest/Jest is the usual place.

## Track a single component from the inside

No patching, works anywhere, including inside library packages or Storybook:

```ts
import { useWhyRerender } from 'rerender-lens';

function Row(props: RowProps) {
  const theme = useContext(ThemeContext);
  useWhyRerender('Row', { ...props, theme });
  ...
}
```

Pass whatever values you want compared. Reports use the notifier from `init` when it was
called, or the `options` third argument.

## DevTools bridge

```ts
import { createDevtoolsNotifier } from 'rerender-lens';

init(React, { trackAllMemoized: true, silent: true, notifier: createDevtoolsNotifier() });
```

Each report is serialized (functions become `ƒ name`, elements `<Type>`, cycles cut) and posted
on `window` as `{ __rerenderLens: true, version: 1, type: 'report', payload }`. The last 300
reports are buffered; `window.__RERENDER_LENS_DEVTOOLS__.replay()` re-posts them and `.clear()`
drops them. Any extension or in-page panel can consume this.

## API

```ts
init(React, options?): () => void         // returns disable
configure(options): void                  // merge options at runtime
disable(): void                           // restore React
isEnabled(): boolean
track(component, name?): component
useWhyRerender(name, values, options?)
createCollector(): { reports, avoidable, notifier, clear, assertNoAvoidable }
combineNotifiers(...notifiers): Notifier
createDevtoolsNotifier({ bufferSize?, target?, maxDepth? }): Notifier
deepEqual(a, b), diffRecords(prev, next), classify(prev, next)   // the primitives
```

`Options`:

| Option | Default | |
| --- | --- | --- |
| `trackAllMemoized` | `false` | track every `memo` / `PureComponent` |
| `trackAllComponents` | `false` | track everything (noisy) |
| `include` / `exclude` | | display-name matchers |
| `trackHooks` | `true` | capture and diff hook values |
| `logAll` | `false` | print non-avoidable reports too |
| `silent` | `false` | never print; notifier still runs |
| `notifier` | | receives every `RenderReport` |
| `collapse` | `true` | `console.groupCollapsed` vs `console.group` |
| `console` | `console` | sink for printing |

## How it works, and the caveats that follow

- `init` replaces `React.createElement` with one that maps a tracked component type to a cached
  wrapper. The wrapper renders the original, keeps the previous props and hook values in a ref,
  and diffs them on the next render. Class components get a subclass whose `componentDidUpdate`
  diffs `props` and `state` and then calls yours.
- Hook values are captured by patching `React.useState`, `useReducer`, `useContext` and
  `useSyncExternalStore`. This only reaches code that reads those functions **after** `init`
  ran, which is why the setup file must be imported first. With `import * as React`, the
  namespace is read-only in most bundlers; pass the default import.
- A wrapper is a different element type from the original, so the first time a component
  becomes tracked (or stops being tracked after `configure`) it remounts. Decide tracking at
  startup; use `configure` for reporting options.
- The mount render is never reported. Under `StrictMode` the duplicate dev render is detected
  (same props object, same hook values) and skipped.
- `trackHooks: false` disables state-triggered reports for function components, because the
  wrapper then cannot distinguish a state update from a StrictMode re-invocation.
- Diffing is structural and happens during render. It is meant for development; do not enable
  it in production builds.

## Migrating from why-did-you-render

| why-did-you-render | rerender-lens |
| --- | --- |
| `whyDidYouRender(React, opts)` | `init(React, opts)` |
| `trackAllPureComponents` | `trackAllMemoized` |
| `Comp.whyDidYouRender = true` | `track(Comp)` or `Comp.rerenderLens = true` |
| `include` / `exclude` (RegExp[]) | same, plus strings and predicates |
| `trackHooks` | same |
| `logOnDifferentValues` | `logAll` |
| `notifier` (`{ Component, prevProps, ... }`) | `notifier` (`RenderReport`) |
| `jsxImportSource: '@welldone-software/why-did-you-render'` | `jsxImportSource: 'rerender-lens'` |

## License

MIT
