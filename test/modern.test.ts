/**
 * Verdicts on modern React shapes (milestone P): React Compiler output, use(), transitions, Suspense,
 * store selectors, render props, forwardRef + memo, class components, useDeferredValue/useId.
 * Each case asserts the concrete verdict the README table promises.
 */
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import * as compilerRuntime from 'react/compiler-runtime';
import { createRoot } from 'react-dom/client';
import { disable, init, createCollector, track } from '../src/index';
import { h, mount, setup } from './helpers';

afterEach(() => disable());

/** `c` is what babel-plugin-react-compiler imports; `@types/react` exports nothing for it on purpose. */
const c = (compilerRuntime as unknown as { c: (size: number) => unknown[] }).c;

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => React.act(bump) };
}

/** React throttles revealing resolved Suspense content (FALLBACK_THROTTLE_MS = 300); wait it out. */
const settleSuspense = () => new Promise((r) => setTimeout(r, 350));

// React Compiler output, use() and ref-in-props exist from React 19 on; the React 18 CI run skips them.
const REACT19 = Number(React.version.split('.')[0]) >= 19;

describe.skipIf(!REACT19)('React Compiler output (useMemoCache)', () => {
  /** Hand-written equivalent of what babel-plugin-react-compiler emits for `<div>{props.label}</div>`. */
  let bodyRuns = 0;
  let outputBuilt = 0;
  const Compiled = track(function Compiled(props: { label: string; style?: { color: string } }) {
    const $ = c(2);
    bodyRuns++;
    let t0: React.ReactElement;
    if ($[0] !== props.label) {
      outputBuilt++;
      t0 = h('div', null, props.label);
      $[0] = props.label;
      $[1] = t0;
    } else t0 = $[1] as React.ReactElement;
    return t0;
  });

  it('a parent-triggered render with identical props is a cache hit: compiled, not avoidable, nothing to fix', () => {
    const { collector, calls } = setup();
    const { Parent, rerender } = makeParent(() => h(Compiled, { label: 'x' }));
    const hn = mount(h(Parent));
    const runs = bodyRuns;
    rerender();
    expect(bodyRuns).toBe(runs + 1); // React still calls the function...
    expect(outputBuilt).toBe(1); // ...but the output came from the cache
    expect(collector.reports).toHaveLength(1);
    const r = collector.reports[0]!;
    expect(r.compiled).toBe(true);
    expect(r.memoized).toBe(false);
    expect(r.trigger).toBe('parent');
    expect(r.avoidable).toBe(false);
    expect(r.reasons[0]).toMatch(/compiled by React Compiler: its output is memoized .* nothing to fix/);
    // The memo cache is not a hook node: it never shows up as state.
    expect(r.hookChanges).toEqual([]);
    expect(r.hookState).toEqual([]);
    expect(calls).toHaveLength(0); // not printed: not avoidable
    hn.unmount();
  });

  it('a new-but-equal prop still misses the cache: avoidable, with the upstream fix and no React.memo advice', () => {
    const { collector } = setup();
    const { Parent, rerender } = makeParent(() => h(Compiled, { label: 'x', style: { color: 'red' } }));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    expect(r.compiled).toBe(true);
    expect(r.avoidable).toBe(true);
    expect(r.propChanges).toEqual([expect.objectContaining({ path: 'style', kind: 'deep-equal' })]);
    expect(r.reasons.some((x) => /memoize the object with useMemo/.test(x))).toBe(true);
    expect(r.reasons.some((x) => /React\.memo/.test(x))).toBe(false);
    hn.unmount();
  });

  it('a genuine prop change is a normal props render', () => {
    const { collector } = setup();
    const { Parent, rerender } = makeParent((n) => h(Compiled, { label: `x${n}` }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports[0]).toMatchObject({ compiled: true, trigger: 'props', avoidable: false });
    hn.unmount();
  });

  it('uncompiled components do not carry the flag', () => {
    const { collector } = setup();
    const Plain = track((p: { n: number }) => h('span', null, p.n), 'Plain');
    const { Parent, rerender } = makeParent(() => h(Plain, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports[0]!.compiled).toBeUndefined();
    expect(collector.reports[0]!.avoidable).toBe(true);
    hn.unmount();
  });
});

describe.skipIf(!REACT19)('use(promise) under Suspense', () => {
  it('the resumed render and the boundary siblings are never avoidable', async () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllComponents: true });
    let resolveFirst: (v: string) => void = () => {};
    let resolveSecond: (v: string) => void = () => {};
    const first = new Promise<string>((r) => (resolveFirst = r));
    const second = new Promise<string>((r) => (resolveSecond = r));
    function Await(p: { promise: Promise<string> }) {
      return h('em', null, React.use(p.promise));
    }
    function Sib(p: { n: number }) {
      return h('b', null, p.n);
    }
    function Outside(p: { n: number }) {
      return h('u', null, p.n);
    }
    let setPromise: (p: Promise<string>) => void = () => {};
    function Shell() {
      const [p, s] = React.useState(first);
      setPromise = s;
      return h('div', null, h(Outside, { n: 1 }), h(React.Suspense, { fallback: h('i', null, 'loading') }, h(Await, { promise: p }), h(Sib, { n: 1 })));
    }
    // Phase 1: the first render suspends; the thenable resolves afterwards. Everything under the boundary
    // mounts for the first time in the resolving commit, and mounts are never reported. (The render goes
    // through an async act so React's ping on the thenable lands inside an act scope.)
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => root.render(h(Shell)));
    expect(container.innerHTML).toBe('<div><u>1</u><i>loading</i></div>');
    await React.act(async () => {
      resolveFirst('first');
      await settleSuspense();
    });
    expect(container.innerHTML).toBe('<div><u>1</u><em>first</em><b>1</b></div>');
    expect(collector.reports).toEqual([]);

    // Phase 2: a new promise suspends the boundary again: the fallback shows, the old content is hidden.
    await React.act(async () => setPromise(second));
    expect(container.innerHTML).toContain('<i>loading</i>');
    const suspended = collector.reports;
    expect(suspended.map((r) => r.component)).toEqual(['Outside', 'Shell']);
    expect(suspended.find((r) => r.component === 'Shell')).toMatchObject({ trigger: 'state', avoidable: false });
    expect(suspended.find((r) => r.component === 'Outside')).toMatchObject({ trigger: 'parent', avoidable: true }); // outside the boundary: the usual verdict
    collector.clear();

    // Phase 3: the promise resolves and the boundary reveals its content again.
    await React.act(async () => {
      resolveSecond('second');
      await settleSuspense();
    });
    expect(container.textContent).toBe('1second1'); // revealed again (React leaves an empty style on the un-hidden nodes)
    const resolved = collector.reports;
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((r) => r.commitCause === 'suspense-resolved')).toBe(true);
    expect(resolved.filter((r) => r.avoidable)).toEqual([]);
    const awaited = resolved.find((r) => r.component === 'Await')!;
    expect(awaited.trigger).toBe('props'); // the promise prop changed
    expect(awaited.propChanges[0]).toMatchObject({ path: 'promise', kind: 'different' });
    // The sibling that was hidden with the fallback is re-rendered by the reveal: explained, not flagged.
    const sib = resolved.find((r) => r.component === 'Sib')!;
    expect(sib).toMatchObject({ trigger: 'parent', avoidable: false, parent: null });
    expect(sib.reasons[0]).toMatch(/Suspense boundary above it switched from its fallback to content/);
    React.act(() => root.unmount());
    container.remove();
  });
});

describe('startTransition', () => {
  it('the memo child with equal props does not render; the parent is a normal-priority state render', async () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllComponents: true });
    let childRenders = 0;
    const Child = React.memo(function Child(p: { n: number }) {
      childRenders++;
      return h('span', null, p.n);
    });
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = React.useState(0);
      bump = () => React.startTransition(() => setN((x) => x + 1));
      return h('div', null, n, h(Child, { n: 1 }));
    }
    const hn = mount(h(Parent));
    await React.act(async () => bump());
    expect(childRenders).toBe(1);
    expect(collector.reports.map((r) => r.component)).toEqual(['Parent']);
    const r = collector.reports[0]!;
    expect(r).toMatchObject({ trigger: 'state', avoidable: false, commitPriority: 'normal' });
    expect(r.hookChanges[0]).toMatchObject({ hook: 'useState', kind: 'different', prev: 0, next: 1 });
    hn.unmount();
  });
});

describe('Suspense fallback → content (React.lazy)', () => {
  it('siblings inside the boundary are re-rendered by the reveal, not flagged; siblings outside keep the usual verdict', async () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllComponents: true });
    let resolve: (v: { default: React.ComponentType }) => void = () => {};
    const Lazy = React.lazy(() => new Promise<{ default: React.ComponentType }>((r) => (resolve = r)));
    function Inside(p: { n: number }) {
      return h('b', null, p.n);
    }
    function Outside(p: { n: number }) {
      return h('u', null, p.n);
    }
    let show: (on: boolean) => void = () => {};
    function Shell() {
      const [on, setOn] = React.useState(false);
      show = setOn;
      return h('div', null, h(Outside, { n: 1 }), h(React.Suspense, { fallback: h('i', null, 'loading') }, on ? h(Lazy) : null, h(Inside, { n: 1 })));
    }
    const hn = mount(h(Shell));
    await React.act(async () => show(true));
    expect(hn.container.innerHTML).toContain('<i>loading</i>');
    collector.clear();
    await React.act(async () => {
      resolve({ default: () => h('em', null, 'done') });
      await settleSuspense();
    });
    expect(hn.container.innerHTML).toContain('<em>done</em>');
    const reports = collector.reports;
    expect(reports.map((r) => r.component)).toEqual(['Inside']);
    const inside = reports[0]!;
    expect(inside).toMatchObject({ trigger: 'parent', avoidable: false, commitCause: 'suspense-resolved', parent: null });
    expect(inside.reasons[0]).toMatch(/Suspense boundary above it switched from its fallback to content/);
    expect(inside.reasons.some((x) => /React\.memo/.test(x))).toBe(false);
    hn.unmount();
  });
});

describe('useSyncExternalStore with a selector', () => {
  function makeStore() {
    let state = { a: 1, b: 1 };
    const listeners = new Set<() => void>();
    return {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      get: () => state,
      set: (s: typeof state) => {
        state = s;
        listeners.forEach((l) => l());
      },
    };
  }
  type Store = ReturnType<typeof makeStore>;
  /** The `useSyncExternalStoreWithSelector` shape: the selection is recomputed only when the snapshot changes. */
  function useAppSelector<T>(store: Store, selector: (s: ReturnType<Store['get']>) => T): T {
    const memo = React.useRef<{ s: unknown; v: T } | null>(null);
    return React.useSyncExternalStore(store.subscribe, () => {
      const s = store.get();
      if (!memo.current || memo.current.s !== s) memo.current = { s, v: selector(s) };
      return memo.current.v;
    });
  }

  it('a selector returning a new object of equal contents is deep-equal, avoidable, with the store advice', () => {
    const { collector } = setup({ trackAllComponents: true });
    const store = makeStore();
    function Obj() {
      const v = useAppSelector(store, (s) => ({ a: s.a }));
      return h('b', null, v.a);
    }
    const hn = mount(h(Obj));
    React.act(() => store.set({ a: 1, b: 2 })); // an unrelated slice changed
    expect(collector.reports).toHaveLength(1);
    const r = collector.reports[0]!;
    expect(r).toMatchObject({ component: 'Obj', trigger: 'parent', avoidable: true, parent: null });
    expect(r.hookChanges).toEqual([expect.objectContaining({ hook: 'useSyncExternalStore', kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 } })]);
    expect(r.reasons[0]).toMatch(/useSyncExternalStore #\d+ returned a new reference that is deep-equal/);
    expect(r.reasons[0]).toMatch(/getSnapshot returns a new reference with the same contents: cache the snapshot/);
    hn.unmount();
  });

  it('names the selector hook and gives selector advice when custom hook names are resolved', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllComponents: true, resolveHookNames: true });
    const store = makeStore();
    function Obj() {
      const v = useAppSelector(store, (s) => ({ a: s.a }));
      return h('b', null, v.a);
    }
    const hn = mount(h(Obj));
    React.act(() => store.set({ a: 1, b: 2 }));
    const r = collector.reports.find((x) => x.component === 'Obj')!;
    expect(r.avoidable).toBe(true);
    expect(r.hookChanges[0]!.custom).toEqual(['useAppSelector']);
    expect(r.reasons[0]).toMatch(/useAppSelector › useSyncExternalStore#\d+ returned a new reference/);
    expect(r.reasons[0]).toMatch(/the selector returns a new object on every call: return a stored slice, pass shallowEqual, or memoize it with createSelector/);
    hn.unmount();
  });

  it('a stable selection (a primitive) does not render at all', () => {
    const { collector } = setup({ trackAllComponents: true });
    const store = makeStore();
    let renders = 0;
    function Prim() {
      renders++;
      return h('i', null, useAppSelector(store, (s) => s.a));
    }
    const hn = mount(h(Prim));
    React.act(() => store.set({ a: 1, b: 2 }));
    expect(renders).toBe(1);
    expect(collector.reports).toHaveLength(0);
    React.act(() => store.set({ a: 2, b: 2 }));
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]).toMatchObject({ trigger: 'hooks', avoidable: false });
    expect(collector.reports[0]!.hookChanges[0]).toMatchObject({ hook: 'useSyncExternalStore', kind: 'different', prev: 1, next: 2 });
    hn.unmount();
  });
});

describe('render props on a memo component', () => {
  const List = React.memo(function List(p: { items: string[]; renderItem: (x: string) => React.ReactNode }) {
    return h('ul', null, ...p.items.map((x) => h('li', { key: x }, p.renderItem(x))));
  });
  const ITEMS = ['a', 'b'];

  it('an inline renderItem defeats memo: kind function, avoidable, useCallback advice', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const { Parent, rerender } = makeParent(() => h(List, { items: ITEMS, renderItem: (x) => x.toUpperCase() }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(1);
    const r = collector.reports[0]!;
    expect(r).toMatchObject({ component: 'List', trigger: 'parent', avoidable: true, memoized: true });
    expect(r.propChanges).toEqual([expect.objectContaining({ path: 'renderItem', kind: 'function' })]);
    expect(r.reasons.some((x) => /prop "renderItem" is a new function instance on every render: wrap it in useCallback/.test(x))).toBe(true);
    hn.unmount();
  });

  it('known limitation: a new function with the same source that closes over a changed value is still "function"', () => {
    const { collector } = setup({ trackAllMemoized: true });
    // `n` changes every render, so the output changes too, but the function text does not.
    const { Parent, rerender } = makeParent((n) => h(List, { items: ITEMS, renderItem: (x) => `${x}${n}` }));
    const hn = mount(h(Parent));
    rerender();
    expect(hn.container.textContent).toBe('a1b1');
    const r = collector.reports[0]!;
    expect(r.propChanges).toEqual([expect.objectContaining({ path: 'renderItem', kind: 'function' })]);
    expect(r.avoidable).toBe(true); // documented: closures are compared by source, not by what they capture
    hn.unmount();
  });

  it('a useCallback-stable renderItem does not render the list', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const render = (x: string) => x.toUpperCase();
    const { Parent, rerender } = makeParent(() => h(List, { items: ITEMS, renderItem: render }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(0);
    hn.unmount();
  });
});

describe.skipIf(!REACT19)('forwardRef + memo and the ref prop (React 19 keeps ref in props)', () => {
  const Inner = React.forwardRef<HTMLSpanElement, { n: number }>((p, ref) => h('span', { ref }, p.n));
  Inner.displayName = 'Inner';
  const Field = React.memo(Inner);

  it('a stable ref object and equal props: no render at all', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const ref = React.createRef<HTMLSpanElement>();
    const { Parent, rerender } = makeParent(() => h(Field, { n: 1, ref }));
    const hn = mount(h(Parent));
    rerender();
    expect(ref.current?.tagName).toBe('SPAN');
    expect(collector.reports).toHaveLength(0);
    hn.unmount();
  });

  it('a new ref object on every render defeats memo: deep-equal on "ref", avoidable, useRef advice (not ref.current)', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const { Parent, rerender } = makeParent(() => h(Field, { n: 1, ref: React.createRef<HTMLSpanElement>() }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(1);
    const r = collector.reports[0]!;
    expect(r).toMatchObject({ component: 'Inner', trigger: 'parent', avoidable: true, memoized: true });
    expect(r.propChanges).toEqual([expect.objectContaining({ path: 'ref', kind: 'deep-equal' })]);
    expect(r.reasons.some((x) => /prop "ref" is a new ref object on every render.*create the ref once with useRef/.test(x))).toBe(true);
    hn.unmount();
  });

  it('an inline callback ref is a new function: avoidable, useCallback advice', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const { Parent, rerender } = makeParent(() => h(Field, { n: 1, ref: (el: HTMLSpanElement | null) => void el }));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    expect(r.avoidable).toBe(true);
    expect(r.propChanges).toEqual([expect.objectContaining({ path: 'ref', kind: 'function' })]);
    expect(r.reasons.some((x) => /prop "ref" is a new function instance on every render: wrap it in useCallback/.test(x))).toBe(true);
    hn.unmount();
  });

  it('a stable ref with a genuinely changed prop is a props render', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const ref = React.createRef<HTMLSpanElement>();
    const { Parent, rerender } = makeParent((n) => h(Field, { n, ref }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports[0]).toMatchObject({ trigger: 'props', avoidable: false });
    expect(collector.reports[0]!.propChanges).toEqual([expect.objectContaining({ path: 'n', kind: 'different' })]);
    hn.unmount();
  });
});

describe('class components', () => {
  class Scu extends React.Component<{ n: number }> {
    override shouldComponentUpdate() {
      return false;
    }
    override render() {
      return h('span', null, this.props.n);
    }
  }
  class Pure extends React.PureComponent<{ n: number }> {
    override render() {
      return h('span', null, this.props.n);
    }
  }
  class Plain extends React.Component<{ n: number }> {
    override render() {
      return h('span', null, this.props.n);
    }
  }

  it('shouldComponentUpdate → false and PureComponent with equal props: no report; a plain class is avoidable with PureComponent advice', () => {
    const { collector } = setup({ trackAllComponents: true, exclude: ['Parent'] });
    const { Parent, rerender } = makeParent(() => h('div', null, h(Scu, { n: 1 }), h(Pure, { n: 1 }), h(Plain, { n: 1 })));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Plain']);
    const r = collector.reports[0]!;
    expect(r).toMatchObject({ trigger: 'parent', avoidable: true, memoized: false, parent: { name: 'Parent', trigger: 'state' } });
    expect(r.reasons[0]).toMatch(/Make "Plain" extend PureComponent \(or implement shouldComponentUpdate\)/);
    expect(r.reasons[0]).not.toMatch(/React\.memo/);
    hn.unmount();
  });

  it('a plain class with a new-but-equal prop names both fixes for classes', () => {
    const { collector } = setup({ trackAllComponents: true, exclude: ['Parent'] });
    class Card extends React.Component<{ style: object }> {
      override render() {
        return h('span', null, 'x');
      }
    }
    const { Parent, rerender } = makeParent(() => h(Card, { style: { a: 1 } }));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    expect(r.avoidable).toBe(true);
    expect(r.reasons.some((x) => /is not memoized.*also extend PureComponent \(or implement shouldComponentUpdate\)/.test(x))).toBe(true);
    hn.unmount();
  });
});

describe('useDeferredValue and useId', () => {
  function Child(p: { q: string }) {
    const deferred = React.useDeferredValue(p.q);
    const id = React.useId();
    return h('span', { id }, deferred);
  }
  function makeSearch() {
    let setQuery: (q: string) => void = () => {};
    let tick: () => void = () => {};
    function Search() {
      const [q, setQ] = React.useState('a');
      const [, setT] = React.useState(0);
      setQuery = setQ;
      tick = () => setT((x) => x + 1);
      return h(Child, { q });
    }
    return { Search, setQuery: (q: string) => setQuery(q), tick: () => tick() };
  }

  it('no spurious hook changes when the input is stable', () => {
    const { collector } = setup({ trackAllComponents: true, exclude: ['Search'] });
    const { Search, tick } = makeSearch();
    const hn = mount(h(Search));
    React.act(tick);
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]).toMatchObject({ component: 'Child', trigger: 'parent', avoidable: true, hookChanges: [], hookState: [] });
    hn.unmount();
  });

  it('the deferred second render is a hooks render (useDeferredValue caught up), not an avoidable parent render or an effect loop', async () => {
    const { collector } = setup({ trackAllComponents: true, exclude: ['Search'] });
    const { Search, setQuery } = makeSearch();
    const hn = mount(h(Search));
    await React.act(async () => setQuery('b'));
    expect(hn.container.textContent).toBe('b');
    expect(collector.reports).toHaveLength(2);
    const [urgent, deferred] = collector.reports;
    expect(urgent).toMatchObject({ trigger: 'props', avoidable: false, hookChanges: [] });
    expect(urgent!.propChanges[0]).toMatchObject({ path: 'q', prev: 'a', next: 'b' });
    expect(deferred).toMatchObject({ trigger: 'hooks', avoidable: false, propChanges: [], parent: null });
    expect(deferred!.hookChanges).toEqual([expect.objectContaining({ hook: 'useDeferredValue', kind: 'different', prev: 'a', next: 'b' })]);
    expect(deferred!.reasons[0]).toMatch(/useDeferredValue #\d+ caught up with its latest value.*nothing to fix/);
    expect(deferred!.commitCause).toBeUndefined();
    hn.unmount();
  });
});
