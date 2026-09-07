import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { configure, disable, init, isEnabled, shouldTrack, track } from '../src/index';
import { ensureDevtoolsHook, onCommit, type Fiber } from '../src/fiber';
import { h, mount, setup } from './helpers';

afterEach(() => disable());

/** A parent that re-renders on demand and renders `child(n)` each time. */
function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => React.act(bump) };
}

describe('init / disable', () => {
  it('wraps onCommitFiberRoot and restores it', () => {
    const hook = ensureDevtoolsHook();
    const orig = hook.onCommitFiberRoot;
    init();
    expect(isEnabled()).toBe(true);
    expect(hook.onCommitFiberRoot).not.toBe(orig);
    disable();
    expect(isEnabled()).toBe(false);
    expect(hook.onCommitFiberRoot).toBe(orig);
  });
  it('does nothing for untracked components', () => {
    const { collector } = setup();
    const Child = (p: { n: number }) => h('span', null, p.n);
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(0);
    hn.unmount();
  });
});

describe('function components', () => {
  it('reports a parent-caused re-render with identical props as avoidable and names the parent', () => {
    const { collector, calls } = setup();
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    expect(collector.reports).toHaveLength(0); // mount is never reported
    rerender();
    expect(collector.reports).toHaveLength(1);
    const r = collector.reports[0]!;
    expect(r.component).toBe('Child');
    expect(r.trigger).toBe('parent');
    expect(r.avoidable).toBe(true);
    expect(r.renderCount).toBe(1);
    expect(r.parent).toEqual({ name: 'Parent', trigger: 'state' });
    expect(r.owner).toBe('Parent');
    expect(r.path).toEqual(['Parent']);
    expect(r.reasons[0]).toMatch(/because <Parent> re-rendered \(its state changed\)/);
    expect(calls[0]).toMatch(/<Child> avoidable re-render/);
    expect(calls.some((c) => c === 'at Parent > Child')).toBe(true);
    hn.unmount();
  });

  it('keeps a stable instanceId and increments renderCount per instance', () => {
    const { collector } = setup();
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h('div', null, h(Child, { n: 1, key: 'a' }), h(Child, { n: 2, key: 'b' })));
    const hn = mount(h(Parent));
    rerender();
    rerender();
    expect(collector.reports).toHaveLength(4);
    const ids = new Set(collector.reports.map((r) => r.instanceId));
    expect(ids.size).toBe(2);
    expect(collector.reports.map((r) => r.renderCount)).toEqual([1, 1, 2, 2]);
    hn.unmount();
  });

  it('classifies inline object, callback and element props', () => {
    const { collector } = setup();
    const Icon = () => h('i');
    const Child = track((p: { style: object; onClick: () => void; icon: React.ReactElement }) => h('span', p as object), 'Child');
    const { Parent, rerender } = makeParent(() =>
      h(Child, { style: { color: 'red' }, onClick: () => {}, icon: h(Icon, { size: 1 }) }),
    );
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    expect(r.avoidable).toBe(true);
    expect(r.propChanges.map((c) => [c.path, c.kind])).toEqual([
      ['style', 'deep-equal'],
      ['onClick', 'function'],
      ['icon', 'element'],
    ]);
    hn.unmount();
  });

  it('marks genuine prop changes as not avoidable and does not print them unless logAll', () => {
    const { collector, calls } = setup();
    const Child = track(function Child(p: { n: number }) {
      return h('span', null, p.n);
    });
    const { Parent, rerender } = makeParent((n) => h(Child, { n }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports[0]!.trigger).toBe('props');
    expect(collector.reports[0]!.avoidable).toBe(false);
    expect(collector.reports[0]!.parent).toBeNull();
    expect(collector.reports[0]!.propChanges[0]).toMatchObject({ path: 'n', kind: 'different', prev: 0, next: 1 });
    expect(calls).toHaveLength(0);
    configure({ logAll: true });
    rerender();
    expect(calls[0]).toMatch(/<Child> re-render \(props\)/);
    hn.unmount();
  });

  it('reports own useState changes as "state" and a deep-equal setState as avoidable', () => {
    const { collector } = setup();
    let set: (v: { a: number }) => void = () => {};
    const Child = track(() => {
      const [v, setV] = React.useState({ a: 1 });
      React.useRef(null);
      set = setV;
      return h('span', null, v.a);
    }, 'Child');
    const hn = mount(h(Child));
    React.act(() => set({ a: 2 }));
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.trigger).toBe('state');
    expect(collector.reports[0]!.avoidable).toBe(false);
    expect(collector.reports[0]!.hookChanges[0]).toMatchObject({ hook: 'useState', index: 0, kind: 'different' });
    React.act(() => set({ a: 2 })); // new reference, same contents
    expect(collector.reports).toHaveLength(2);
    expect(collector.reports[1]!.avoidable).toBe(true);
    expect(collector.reports[1]!.reasons[0]).toMatch(/deep-equal/);
    hn.unmount();
  });

  it('labels useReducer and falls back to node inspection when hook types are ambiguous', () => {
    const { collector } = setup();
    let dispatch: (a: number) => void = () => {};
    const Child = track(() => {
      const [v, d] = React.useReducer((s: number, a: number) => s + a, 0);
      const [pending] = React.useTransition(); // two nodes, one debug type
      dispatch = d;
      return h('span', null, v, String(pending));
    }, 'Child');
    const hn = mount(h(Child));
    React.act(() => dispatch(1));
    const r = collector.reports[0]!;
    expect(r.trigger).toBe('state');
    expect(r.hookChanges[0]!.hook).toBe('useReducer');
    hn.unmount();
  });

  it('reports useContext changes as "hooks"', () => {
    const { collector } = setup();
    const Ctx = React.createContext(0);
    Ctx.displayName = 'Counter';
    const Child = track(() => h('span', null, React.useContext(Ctx)), 'Child');
    const { Parent, rerender } = makeParent((n) => h(Ctx.Provider, { value: n }, h(Child)));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    expect(r.trigger).toBe('hooks');
    expect(r.hookChanges[0]).toMatchObject({ hook: 'useContext', path: 'useContext(Counter)', prev: 0, next: 1 });
    hn.unmount();
  });

  it('reports a memoized context consumer when only the context changes', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const Ctx = React.createContext(0);
    const Child = React.memo(function Child() {
      return h('span', null, React.useContext(Ctx));
    });
    const stable = h(Child);
    const { Parent, rerender } = makeParent((n) => h(Ctx.Provider, { value: n }, stable));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.trigger).toBe('hooks');
    expect(collector.reports[0]!.avoidable).toBe(false);
    hn.unmount();
  });

  it('reports once per commit under StrictMode', () => {
    const { collector } = setup();
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(React.StrictMode, null, h(Parent)));
    expect(collector.reports).toHaveLength(0);
    rerender();
    expect(collector.reports).toHaveLength(1);
    rerender();
    expect(collector.reports).toHaveLength(2);
    expect(collector.reports[1]!.renderCount).toBe(2);
    hn.unmount();
  });
});

describe('memo and forwardRef', () => {
  it('tracks React.memo with trackAllMemoized; a custom comparator still bails out', () => {
    const { collector } = setup({ trackAllMemoized: true });
    let compareCalls = 0;
    const Child = React.memo(
      (p: { n: number; extra: object }) => h('span', null, p.n),
      (a, b) => {
        compareCalls++;
        return a.n === b.n;
      },
    );
    const { Parent, rerender } = makeParent((n) => h(Child, { n: n < 2 ? 0 : n, extra: {} }));
    const hn = mount(h(Parent));
    rerender();
    expect(compareCalls).toBe(1);
    expect(collector.reports).toHaveLength(0);
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.trigger).toBe('props');
    hn.unmount();
  });

  it('reports memo with default shallow compare when an inline object defeats it', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const Child = React.memo(function Child(p: { style: object }) {
      return h('span', p as object);
    });
    const { Parent, rerender } = makeParent(() => h(Child, { style: { a: 1 } }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.propChanges[0]).toMatchObject({ path: 'style', kind: 'deep-equal' });
    expect(collector.reports[0]!.component).toBe('Child');
    hn.unmount();
  });

  it('tracks forwardRef components', () => {
    const { collector } = setup();
    const Child = track(React.forwardRef<HTMLSpanElement, { n: number }>((p, ref) => h('span', { ref }, p.n)));
    const ref = React.createRef<HTMLSpanElement>();
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1, ref }));
    const hn = mount(h(Parent));
    expect(ref.current?.tagName).toBe('SPAN');
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.avoidable).toBe(true);
    hn.unmount();
  });

  it('tracks memo(forwardRef(...)) and uses the displayName', () => {
    const { collector } = setup({ trackAllMemoized: true });
    const Inner = React.forwardRef<HTMLSpanElement, { cb: () => void }>((p, ref) => h('span', { ref }));
    Inner.displayName = 'Inner';
    const Child = React.memo(Inner);
    const { Parent, rerender } = makeParent(() => h(Child, { cb: () => {} }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports[0]!.component).toBe('Inner');
    expect(collector.reports[0]!.propChanges[0]!.kind).toBe('function');
    hn.unmount();
  });
});

describe('class components', () => {
  it('reports PureComponent under trackAllMemoized', () => {
    const { collector } = setup({ trackAllMemoized: true });
    let didUpdate = 0;
    class Child extends React.PureComponent<{ items: number[] }> {
      override componentDidUpdate() {
        didUpdate++;
      }
      override render() {
        return h('span', null, this.props.items.length);
      }
    }
    const { Parent, rerender } = makeParent(() => h(Child, { items: [1, 2] }));
    const hn = mount(h(Parent));
    rerender();
    expect(didUpdate).toBe(1);
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.propChanges[0]).toMatchObject({ path: 'items', kind: 'deep-equal' });
    expect(collector.reports[0]!.avoidable).toBe(true);
    hn.unmount();
  });

  it('reports setState with deep-equal contents as avoidable and genuine state as "state"', () => {
    const { collector } = setup();
    let inst: React.Component | null = null;
    class Child extends React.Component<Record<string, never>, { open: boolean; list: number[] }> {
      override state = { open: false, list: [1] };
      override render() {
        inst = this;
        return h('span', null, String(this.state.open));
      }
    }
    track(Child);
    const hn = mount(h(Child));
    React.act(() => inst!.setState({ list: [1] }));
    expect(collector.reports[0]!.avoidable).toBe(true);
    expect(collector.reports[0]!.stateChanges[0]).toMatchObject({ path: 'list', kind: 'deep-equal' });
    React.act(() => inst!.setState({ open: true }));
    expect(collector.reports[1]!.trigger).toBe('state');
    expect(collector.reports[1]!.avoidable).toBe(false);
    hn.unmount();
  });
});

describe('selection', () => {
  it('honours include/exclude and applies configure() live without remounting', () => {
    const { collector } = setup({ include: [/^Row/], exclude: ['RowSkip'] });
    let mounts = 0;
    const Row = (p: { n: number }) => h('span', null, p.n);
    const RowSkip = (p: { n: number }) => h('span', null, p.n);
    const Other = (p: { n: number }) => {
      React.useEffect(() => void mounts++, []);
      return h('span', null, p.n);
    };
    const { Parent, rerender } = makeParent(() => h('div', null, h(Row, { n: 1 }), h(RowSkip, { n: 1 }), h(Other, { n: 1 })));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Row']);
    configure({ include: ['Other'] });
    collector.clear();
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Other']);
    expect(mounts).toBe(1);
    hn.unmount();
  });

  it('trackAllComponents tracks plain functions too', () => {
    const { collector } = setup({ trackAllComponents: true, exclude: ['Parent'] });
    const Plain = (p: { n: number }) => h('span', null, p.n);
    const { Parent, rerender } = makeParent(() => h(Plain, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Plain']);
    hn.unmount();
  });

  it('shouldTrack understands memo, PureComponent, markers and matchers', () => {
    const Fn = () => null;
    const M = React.memo(Fn);
    class P extends React.PureComponent { override render() { return null; } }
    class C extends React.Component { override render() { return null; } }
    expect(shouldTrack(M, { trackAllMemoized: true })).toBe(true);
    expect(shouldTrack(P, { trackAllMemoized: true })).toBe(true);
    expect(shouldTrack(C, { trackAllMemoized: true })).toBe(false);
    expect(shouldTrack(Fn, { trackAllMemoized: true })).toBe(false);
    expect(shouldTrack(Fn, { include: [(n) => n === 'Fn'] })).toBe(true);
    expect(shouldTrack(track(Fn), { exclude: ['Fn'] })).toBe(false);
    expect(shouldTrack('div', { trackAllComponents: true })).toBe(false);
  });

  it('a throwing notifier is contained', () => {
    const { calls } = setup({ notifier: () => { throw new Error('boom'); } });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    expect(() => rerender()).not.toThrow();
    expect(calls.some((c) => c.startsWith('warn'))).toBe(true);
    hn.unmount();
  });

  it('maxReportsPerComponent stops printing but keeps notifying', () => {
    const { collector, calls } = setup({ maxReportsPerComponent: 2 });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    rerender();
    rerender();
    rerender();
    expect(collector.reports).toHaveLength(4);
    const groups = calls.filter((c) => c.startsWith('group '));
    expect(groups).toHaveLength(2);
    expect(calls.filter((c) => c.includes('reached maxReportsPerComponent'))).toHaveLength(1);
    hn.unmount();
  });
});

describe('commit inspection on synthetic fibers', () => {
  function fiber(partial: Partial<Fiber>): Fiber {
    return {
      tag: 0, key: null, type: null, elementType: null, stateNode: null, memoizedProps: {}, memoizedState: null,
      alternate: null, child: null, sibling: null, return: null, flags: 0, ...partial,
    };
  }
  it('skips a commit in which Fast Refresh swapped a component', () => {
    const { collector } = setup({ trackAllComponents: true });
    const Old = function Comp() { return null; };
    const New = function Comp() { return null; };
    const alt = fiber({ type: Old, elementType: Old, flags: 1 });
    const swapped = fiber({ type: New, elementType: New, flags: 1, alternate: alt });
    const rootAlt = fiber({ tag: 3, child: alt });
    const root = fiber({ tag: 3, child: swapped, alternate: rootAlt });
    swapped.return = root;
    onCommit({ current: root });
    expect(collector.reports).toHaveLength(0);
    configure({ ignoreHotReload: false });
    onCommit({ current: root });
    expect(collector.reports).toHaveLength(1);
  });
  it('does not descend into bailed-out subtrees', () => {
    const { collector } = setup({ trackAllComponents: true });
    const Comp = function Stale() { return null; };
    const staleChild = fiber({ type: Comp, elementType: Comp, flags: 1, alternate: fiber({ type: Comp, elementType: Comp }) });
    const bailedAlt = fiber({ type: Comp, child: staleChild });
    const bailed = fiber({ type: Comp, elementType: Comp, flags: 0, alternate: bailedAlt, child: staleChild });
    const root = fiber({ tag: 3, child: bailed, alternate: fiber({ tag: 3 }) });
    onCommit({ current: root });
    expect(collector.reports).toHaveLength(0);
  });
  it('reads effectTag on React 16 fibers', () => {
    const { collector } = setup({ trackAllComponents: true });
    const Comp = function Legacy() { return null; };
    const alt = fiber({ type: Comp, elementType: Comp, memoizedProps: { a: 1 } });
    delete (alt as Partial<Fiber>).flags;
    const f = fiber({ type: Comp, elementType: Comp, alternate: alt, memoizedProps: { a: 1 } });
    delete (f as Partial<Fiber>).flags;
    (f as Fiber).effectTag = 1;
    const root = fiber({ tag: 3, child: f, alternate: fiber({ tag: 3 }) });
    onCommit({ current: root });
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.avoidable).toBe(true);
  });
});
