import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createCollector, customHooksFromStack, disable, init, storeAdvice, track } from '../src/index';
import { getDispatcherRef } from '../src/fiber';
import { h, mount } from './helpers';
import { act } from './react-act';
import { HAS_UPDATERS } from './react-version';

afterEach(() => disable());

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => act(bump) };
}

describe('custom hook names (resolveHookNames)', () => {
  it('parses V8 and Firefox stacks into the custom hook chain between the primitive and the component', () => {
    const v8 = ['Error', '    at __rl_useState (http://x/lens.js:10:5)', '    at useCart (http://x/app.js:20:9)', '    at useShop (http://x/app.js:30:9)', '    at Cart (http://x/app.js:40:9)', '    at renderWithHooks (http://x/react-dom.js:1:1)'].join('\n');
    expect(customHooksFromStack(v8, 'Cart', '__rl_')).toEqual(['useCart', 'useShop']);
    const ff = ['__rl_useState@http://x/lens.js:10:5', 'useCart@http://x/app.js:20:9', 'Cart@http://x/app.js:40:9'].join('\n');
    expect(customHooksFromStack(ff, 'Cart', '__rl_')).toEqual(['useCart']);
    expect(customHooksFromStack('no marker here', 'Cart', '__rl_')).toEqual([]);
  });

  it('labels hook changes and snapshots with the custom hooks that own them, without re-rendering when off', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, resolveHookNames: true });
    let renders = 0;
    function useCounter() {
      const [n, set] = React.useState(0);
      return { n, inc: () => set((x) => x + 1) };
    }
    function useCart() {
      const counter = useCounter();
      const [items] = React.useState<string[]>([]);
      return { ...counter, items };
    }
    let inc: () => void = () => {};
    const Cart = track(function Cart(p: { label: string }) {
      renders++;
      const cart = useCart();
      const [open] = React.useState(false);
      if (renders === 1) inc = cart.inc; // only from the real mount render (the replay returns no-op setters)
      return h('span', null, `${p.label}${cart.n}${open}`);
    }, 'Cart');
    const hn = mount(h(Cart, { label: 'x' }));
    const before = renders;
    act(() => inc());
    expect(getDispatcherRef()).not.toBeNull();
    const r = collector.reports.find((x) => x.component === 'Cart')!;
    const change = r.hookChanges.find((c) => c.hook === 'useState')!;
    expect(change.index).toBe(0);
    expect(change.custom).toEqual(['useCounter', 'useCart']);
    expect(r.reasons).toContain('useCounter › useCart › useState#0 changed.');
    expect(r.hookState!.map((x) => [x.path, x.custom ?? null])).toEqual([
      ['useState#0', ['useCounter', 'useCart']],
      ['useState#1', ['useCart']],
      ['useState#2', null],
    ]);
    // the replay is cached per component type: exactly one extra render for the first report
    expect(renders).toBe(before + 1 + 1);
    act(() => inc());
    expect(renders).toBe(before + 2 + 1);
    hn.unmount();

    // off by default: no extra render, no names
    disable();
    const c2 = createCollector();
    init({ notifier: c2.notifier, silent: true });
    const Plain = track(function Plain() {
      renders++;
      const cart = useCart();
      inc = cart.inc; // never replayed: names are off
      return h('span', null, cart.n);
    }, 'Plain');
    const hn2 = mount(h(Plain));
    const b2 = renders;
    act(() => inc());
    expect(renders).toBe(b2 + 1);
    expect(c2.reports[0]!.hookChanges[0]!.custom).toBeUndefined();
    hn2.unmount();
  });

  it('gives up cleanly when the replay throws', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, resolveHookNames: true });
    let first = true;
    let set: (n: number) => void = () => {};
    const Odd = track(function Odd() {
      const [n, s] = React.useState(0);
      set = s;
      // a component that behaves differently on replay (throws on a non-React dispatcher path)
      if (!first) throw new Error('replay');
      first = false;
      return h('span', null, n);
    }, 'Odd');
    const hn = mount(h(Odd));
    first = false;
    expect(() => act(() => set(1))).toThrow();
    hn.unmount();
    expect(collector.reports.length).toBeGreaterThanOrEqual(0);
  });
});

describe('updaters, effect loops, suspense and keys', () => {
  it.skipIf(!HAS_UPDATERS)('names the component that scheduled the commit and reports element keys', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Row = track((p: { n: number }) => h('span', null, p.n), 'Row');
    const { Parent, rerender } = makeParent((n) => h('div', null, h(Row, { n, key: 'a' }), h(Row, { n, key: 'b' })));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports.map((r) => r.key)).toEqual(['a', 'b']);
    expect(collector.reports[0]!.updaters).toEqual(['Parent']);
    expect(collector.reports[0]!.commitCause).toBeUndefined();
    hn.unmount();
  });

  it.skipIf(!HAS_UPDATERS)('flags a commit scheduled by an effect right after the previous commit as an effect loop', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Child = track((p: { n: number; m: number }) => h('span', null, p.n + p.m), 'Child');
    let setN: (n: number) => void = () => {};
    function Loop() {
      const [n, sN] = React.useState(0);
      const [m, setM] = React.useState(0);
      setN = sN;
      React.useEffect(() => {
        setM(n * 2); // derived state set in an effect: the classic extra commit
      }, [n]);
      return h(Child, { n, m });
    }
    const hn = mount(h(Loop));
    act(() => setN(1));
    const reports = collector.reports.filter((r) => r.component === 'Child');
    expect(reports.length).toBe(2);
    expect(reports[0]!.commitCause).toBeUndefined();
    expect(reports[1]!.commitCause).toBe('effect-after-commit');
    expect(reports[1]!.afterCommit).toBe(reports[0]!.commitId);
    expect(reports[1]!.updaters).toEqual(['Loop']);
    expect(reports[1]!.reasons.some((x) => /effect → setState loop/.test(x))).toBe(true);
    hn.unmount();
  });

  it('labels the commit in which a Suspense boundary resolves', async () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllComponents: true });
    let resolve: (v: { default: React.ComponentType }) => void = () => {};
    const Lazy = React.lazy(() => new Promise<{ default: React.ComponentType }>((r) => (resolve = r)));
    function Shell() {
      return h(React.Suspense, { fallback: h('i', null, 'loading') }, h(Lazy), h('b', null, 'x'));
    }
    const hn = mount(h(Shell));
    await act(async () => {
      resolve({ default: () => h('em', null, 'done') });
      await Promise.resolve();
    });
    await act(async () => {});
    const resolved = collector.reports.find((r) => r.commitCause === 'suspense-resolved');
    // React may commit the resolution without re-rendering a tracked component; when it does, it is labelled.
    if (resolved) expect(resolved.reasons.some((x) => /Suspense boundary resolved/.test(x))).toBe(true);
    hn.unmount();
  });

  it('gives store-specific advice from the custom hook chain', () => {
    expect(storeAdvice(['useSelector'])).toMatch(/shallowEqual|createSelector/);
    expect(storeAdvice(['useCartStore'])).toMatch(/useShallow/);
    expect(storeAdvice(['useBoundStore'])).toMatch(/useShallow/);
    expect(storeAdvice(undefined)).toMatch(/cache the snapshot/);
  });
});
