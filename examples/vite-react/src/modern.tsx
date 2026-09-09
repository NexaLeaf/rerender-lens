// Modern React shapes (README "What counts as avoidable"): a React Compiler-style component, use(),
// startTransition, a Suspense boundary that resolves, an external store read through a selector, a
// render prop on a memo list, forwardRef + memo with a fresh ref, a plain class, useDeferredValue.
// Open the panel (or the extension) and click each button to see the verdict the table promises.
// The example tracks memo components plus `include`; the plain ones here opt in with the `rerenderLens` marker.
// `@types/react` deliberately exports nothing for the compiler runtime; the compiler itself imports `c`.
import * as compilerRuntime from 'react/compiler-runtime';
import {
  Component,
  forwardRef,
  memo,
  PureComponent,
  StrictMode,
  Suspense,
  createRef,
  startTransition,
  use,
  useCallback,
  useDeferredValue,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';

const c = (compilerRuntime as unknown as { c: (size: number) => unknown[] }).c;

// ---- 1. React Compiler output, hand-written (what babel-plugin-react-compiler emits for <div>{label}</div>).
// Not memoized: React calls it on every parent render, but the output comes from the memo cache.
function CompiledLabel(props: { label: string }) {
  const $ = c(2);
  let t0: ReactNode;
  if ($[0] !== props.label) {
    t0 = <div className="cell">compiled: {props.label}</div>;
    $[0] = props.label;
    $[1] = t0;
  } else t0 = $[1] as ReactNode;
  return t0;
}
CompiledLabel.rerenderLens = true;

// ---- 2. use(promise) under Suspense.
const wait = (ms: number, v: string) => new Promise<string>((r) => setTimeout(() => r(v), ms));
function Await(props: { promise: Promise<string> }) {
  return <em>{use(props.promise)}</em>;
}
Await.rerenderLens = true;
function Sibling(props: { n: number }) {
  return <b> sibling {props.n}</b>;
}
Sibling.rerenderLens = true;

// ---- 5. useSyncExternalStore with a selector (the useSyncExternalStoreWithSelector shape).
let storeState = { a: 1, b: 1 };
const listeners = new Set<() => void>();
const store = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => storeState,
  set: (s: typeof storeState) => {
    storeState = s;
    listeners.forEach((l) => l());
  },
};
function useAppSelector<T>(selector: (s: typeof storeState) => T): T {
  const memo = useRef<{ s: unknown; v: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.get();
    if (!memo.current || memo.current.s !== s) memo.current = { s, v: selector(s) };
    return memo.current.v;
  });
}
function ObjectSelector() {
  const v = useAppSelector((s) => ({ a: s.a })); // new object per store change: avoidable
  return <span className="cell">object selector a={v.a}</span>;
}
ObjectSelector.rerenderLens = true;
function PrimitiveSelector() {
  const a = useAppSelector((s) => s.a); // primitive: no render unless a changes
  return <span className="cell">primitive selector a={a}</span>;
}
PrimitiveSelector.rerenderLens = true;

// ---- 6. Render prop on a memo list.
const List = memo(function List(props: { items: string[]; renderItem: (x: string) => ReactNode }) {
  return (
    <ul>
      {props.items.map((x) => (
        <li key={x}>{props.renderItem(x)}</li>
      ))}
    </ul>
  );
});
const ITEMS = ['alpha', 'beta'];

// ---- 7. forwardRef + memo.
const Field = memo(
  forwardRef<HTMLInputElement, { label: string }>(function Field(props, ref) {
    return (
      <label className="cell">
        {props.label} <input ref={ref} />
      </label>
    );
  }),
);

// ---- 8. Classes.
class PlainClass extends Component<{ n: number }> {
  static rerenderLens = true;
  override render() {
    return <span className="cell">plain class {this.props.n}</span>;
  }
}
class PureClass extends PureComponent<{ n: number }> {
  override render() {
    return <span className="cell">PureComponent {this.props.n}</span>;
  }
}
class GuardedClass extends Component<{ n: number }> {
  static rerenderLens = true;
  override shouldComponentUpdate() {
    return false;
  }
  override render() {
    return <span className="cell">shouldComponentUpdate → false {this.props.n}</span>;
  }
}

// ---- 9. useDeferredValue.
function Deferred(props: { query: string }) {
  const deferred = useDeferredValue(props.query);
  return (
    <span className="cell">
      deferred: {deferred} {deferred !== props.query ? '(catching up…)' : ''}
    </span>
  );
}
Deferred.rerenderLens = true;

function App() {
  const [tick, setTick] = useState(0);
  const [transitionTick, setTransitionTick] = useState(0);
  const [promise, setPromise] = useState(() => wait(600, 'ready'));
  const [query, setQuery] = useState('');
  const stableRef = useRef<HTMLInputElement>(null);
  const stableRender = useCallback((x: string) => x.toUpperCase(), []);
  return (
    <>
      <h1>rerender-lens modern shapes</h1>
      <p className="hint">Each card is one row of the README table "What counts as avoidable". Open the panel to watch the verdicts.</p>

      <div className="card">
        <h2>Parent re-render (state) — compiled vs plain vs classes</h2>
        <button onClick={() => setTick((t) => t + 1)}>Re-render parent ({tick})</button>
        <CompiledLabel label="stable" />
        <PlainClass n={1} />
        <PureClass n={1} />
        <GuardedClass n={1} />
        <p className="hint">Compiled: not avoidable (cache hit). Plain class: avoidable (PureComponent advice). PureComponent / shouldComponentUpdate: no report.</p>
      </div>

      <div className="card">
        <h2>startTransition</h2>
        <button onClick={() => startTransition(() => setTransitionTick((t) => t + 1))}>Transition update ({transitionTick})</button>
        <List items={ITEMS} renderItem={stableRender} />
        <p className="hint">The memo list has equal props: no report. The parent renders at normal priority.</p>
      </div>

      <div className="card">
        <h2>use(promise) under Suspense</h2>
        <button onClick={() => setPromise(wait(600, `ready #${Date.now() % 1000}`))}>New promise (suspends)</button>
        <Suspense fallback={<i>loading…</i>}>
          <Await promise={promise} />
          <Sibling n={1} />
        </Suspense>
        <p className="hint">The resolving commit is labelled "suspense resolved"; neither the awaiting component nor its sibling is avoidable.</p>
      </div>

      <div className="card">
        <h2>External store with a selector</h2>
        <button onClick={() => store.set({ ...storeState, b: storeState.b + 1 })}>Change an unrelated slice (b)</button>{' '}
        <button onClick={() => store.set({ ...storeState, a: storeState.a + 1 })}>Change the selected slice (a)</button>
        <ObjectSelector />
        <PrimitiveSelector />
        <p className="hint">Unrelated slice: the object selector is avoidable (equal by value, store advice); the primitive selector does not render.</p>
      </div>

      <div className="card">
        <h2>Render prop and ref on memo components</h2>
        <button onClick={() => setTick((t) => t + 1)}>Re-render parent ({tick})</button>
        <List items={ITEMS} renderItem={(x) => `${x}!`} />
        <Field label="fresh ref" ref={createRef<HTMLInputElement>()} />
        <Field label="stable ref" ref={stableRef} />
        <p className="hint">Inline renderItem: avoidable (new function, useCallback). Fresh ref object: avoidable on "ref" (useRef advice). Stable ref: no report.</p>
      </div>

      <div className="card">
        <h2>useDeferredValue</h2>
        <label>
          Type: <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Deferred query={query} />
        <p className="hint">Two renders per keystroke: the urgent one (props) and the deferred catch-up (hooks: useDeferredValue). Neither is avoidable.</p>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
