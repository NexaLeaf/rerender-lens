import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { configure, disable, getDisplayName, init, isEnabled, track } from '../src/index';
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
  it('patches createElement and restores it', () => {
    const orig = React.createElement;
    init(React);
    expect(isEnabled()).toBe(true);
    expect(React.createElement).not.toBe(orig);
    disable();
    expect(isEnabled()).toBe(false);
    expect(React.createElement).toBe(orig);
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
  it('reports a parent-caused re-render with identical props as avoidable', () => {
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
    expect(calls[0]).toMatch(/<Child> avoidable re-render/);
    hn.unmount();
  });

  it('classifies inline object, callback and element props', () => {
    const { collector } = setup();
    const Icon = () => h('i');
    const Child = track((p: { style: object; onClick: () => void; icon: React.ReactElement }) => h('span', p as object));
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
    expect(collector.reports[0]!.propChanges[0]).toMatchObject({ path: 'n', kind: 'different', prev: 0, next: 1 });
    expect(calls).toHaveLength(0);
    configure({ logAll: true });
    rerender();
    expect(calls[0]).toMatch(/<Child> re-render \(props\)/);
    hn.unmount();
  });

  it('reports own useState changes as "state" and skips deep-equal setState noise correctly', () => {
    const { collector } = setup();
    let set: (v: { a: number }) => void = () => {};
    const Child = track(() => {
      const [v, setV] = React.useState({ a: 1 });
      set = setV;
      return h('span', null, v.a);
    });
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

  it('reports useContext changes as "hooks"', () => {
    const { collector } = setup();
    const Ctx = React.createContext(0);
    const Child = track(() => h('span', null, React.useContext(Ctx)));
    const { Parent, rerender } = makeParent((n) => h(Ctx.Provider, { value: n }, h(Child)));
    const hn = mount(h(Parent));
    rerender();
    // Child is re-rendered because Parent re-rendered *and* the context value changed.
    const r = collector.reports[0]!;
    expect(r.trigger).toBe('hooks');
    expect(r.hookChanges[0]).toMatchObject({ hook: 'useContext', prev: 0, next: 1 });
    hn.unmount();
  });

  it('does not double-report under StrictMode', () => {
    const { collector } = setup();
    const Child = track((p: { n: number }) => h('span', null, p.n));
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

  it('keeps displayName and hoists statics', () => {
    setup();
    const Child = (p: { n?: number }) => h('span', null, p.n);
    Child.displayName = 'Fancy';
    (Child as { propTypes?: object }).propTypes = { n: () => null };
    track(Child);
    const el = React.createElement(Child, { n: 1 });
    expect(el.type).not.toBe(Child);
    expect(getDisplayName(el.type)).toBe('Fancy');
    expect((el.type as { propTypes?: object }).propTypes).toBe((Child as { propTypes?: object }).propTypes);
    // cached: same wrapper every time
    expect(React.createElement(Child, { n: 2 }).type).toBe(el.type);
  });
});

describe('memo and forwardRef', () => {
  it('tracks React.memo with trackAllMemoized and preserves the custom comparator', () => {
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
    rerender(); // n 0 -> 0: comparator says equal, memo bails out, no report
    expect(compareCalls).toBe(1);
    expect(collector.reports).toHaveLength(0);
    rerender(); // n -> 2: real change
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

  it('still forwards refs through a tracked forwardRef component', () => {
    const { collector } = setup();
    const Child = track(
      React.forwardRef<HTMLSpanElement, { n: number }>((p, ref) => h('span', { ref }, p.n)),
    );
    const ref = React.createRef<HTMLSpanElement>();
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1, ref }));
    const hn = mount(h(Parent));
    expect(ref.current?.tagName).toBe('SPAN');
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.avoidable).toBe(true);
    expect(ref.current?.tagName).toBe('SPAN');
    hn.unmount();
  });

  it('tracks memo(forwardRef(...))', () => {
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
  it('reports PureComponent under trackAllMemoized and keeps componentDidUpdate working', () => {
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
      static defaultProps = {};
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
  it('honours include/exclude and configure() at runtime', () => {
    const { collector } = setup({ include: [/^Row/], exclude: ['RowSkip'] });
    const Row = (p: { n: number }) => h('span', null, p.n);
    const RowSkip = (p: { n: number }) => h('span', null, p.n);
    const Other = (p: { n: number }) => h('span', null, p.n);
    const { Parent, rerender } = makeParent(() => h('div', null, h(Row, { n: 1 }), h(RowSkip, { n: 1 }), h(Other, { n: 1 })));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Row']);
    // configure() replaces `include`; the new decision applies to elements created afterwards.
    configure({ include: ['Other'] });
    collector.clear();
    hn.unmount();
    const hn2 = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.component)).toEqual(['Other']);
    hn2.unmount();
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

  it('a throwing notifier is contained', () => {
    const { calls } = setup({ notifier: () => { throw new Error('boom'); } });
    const Child = track((p: { n: number }) => h('span', null, p.n));
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    expect(() => rerender()).not.toThrow();
    expect(calls.some((c) => c.startsWith('warn'))).toBe(true);
    hn.unmount();
  });
});
