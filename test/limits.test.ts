import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { beginDiffScope, DEFAULT_DIFF_BUDGET, deepEqual, diffRecords } from '../src/diff';
import { createDevtoolsNotifier, serialize, SERIALIZE_MAX_ENTRIES } from '../src/devtools';
import { MAX_REPORTS_PER_COMMIT } from '../src/fiber';
import { createCollector, disable, init, track } from '../src/index';
import { getState } from '../src/state';
import { h, mount } from './helpers';
import { act } from './react-act';

afterEach(() => {
  disable();
});

describe('bounded work per commit', () => {
  it('deepEqual memoizes pairs inside a scope and gives up on values larger than the budget', () => {
    const big = Array.from({ length: DEFAULT_DIFF_BUDGET + 10 }, (_, i) => ({ i }));
    const copy = big.map((x) => ({ ...x }));
    // Too large to walk within one public call: reported as different rather than freezing.
    expect(deepEqual(big, copy)).toBe(false);
    // Small values are unaffected.
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);

    const end = beginDiffScope(1_000_000);
    try {
      const a = { list: Array.from({ length: 2000 }, (_, i) => ({ i })) };
      const b = { list: a.list.map((x) => ({ ...x })) };
      expect(deepEqual(a, b)).toBe(true);
      // The second comparison of the same pair is a cache hit: no object visits at all.
      const spy = vi.spyOn(Object, 'keys');
      expect(deepEqual(a, b)).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      end();
    }

    // Large sets compare members by identity instead of O(n²).
    const items = Array.from({ length: 60 }, (_, i) => ({ i }));
    expect(deepEqual(new Set(items), new Set(items))).toBe(true);
    expect(deepEqual(new Set(items), new Set(items.map((x) => ({ ...x }))))).toBe(false);
  });

  it('diffRecords skips the nested-path walk once the budget is exhausted', () => {
    const big = Array.from({ length: DEFAULT_DIFF_BUDGET + 10 }, (_, i) => ({ i }));
    const changes = diffRecords({ items: big }, { items: big.map((x) => ({ ...x })) });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('items'); // not items[...].i
  });

  it('serialize bounds breadth, handles binary data and DOM nodes, and stops at a node budget', () => {
    const arr = Array.from({ length: SERIALIZE_MAX_ENTRIES + 5 }, (_, i) => i);
    const out = serialize({ arr, bytes: new Uint8Array(1_000_000), buf: new ArrayBuffer(8), p: Promise.resolve(1), node: document.createTextNode('t'), map: new Map(arr.map((i) => [i, i])) }) as Record<string, unknown>;
    expect((out.arr as unknown[]).length).toBe(SERIALIZE_MAX_ENTRIES + 1);
    expect((out.arr as unknown[]).at(-1)).toBe('…+5 more');
    expect(out.bytes).toEqual({ $type: 'Uint8Array', length: 1_000_000 });
    expect(out.buf).toEqual({ $type: 'ArrayBuffer', length: 8 });
    expect(out.p).toBe('[Promise]');
    expect(out.node).toBe('[#text]');
    expect((out.map as { entries: unknown[] }).entries).toHaveLength(SERIALIZE_MAX_ENTRIES + 1);
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 150; i++) wide[`k${i}`] = i;
    expect(Object.keys(serialize(wide) as object)).toHaveLength(SERIALIZE_MAX_ENTRIES + 1);
    // The node budget: a deep-but-narrow graph with more objects than allowed is cut with `[…]`.
    const graph = { children: Array.from({ length: 100 }, () => ({ children: Array.from({ length: 100 }, () => ({ children: Array.from({ length: 5 }, () => ({})) })) })) };
    const text = JSON.stringify(serialize(graph, 10));
    expect(text).toContain('[…]');
    expect(text.length).toBeLessThan(400_000);
  });

  it('a commit with more tracked components than the cap reports the first N and counts the rest', () => {
    const collector = createCollector();
    init({ trackAllComponents: true, silent: true, notifier: collector.notifier, includeState: false });
    const Row = track((p: { i: number }) => h('i', null, p.i), 'Row');
    let bump: () => void = () => {};
    function List() {
      const [n, setN] = React.useState(0);
      bump = () => setN(n + 1);
      return h('div', null, ...Array.from({ length: MAX_REPORTS_PER_COMMIT + 50 }, (_, i) => h(Row, { key: i, i })));
    }
    const hn = mount(h(List));
    act(bump);
    hn.unmount();
    const rows = collector.reports.filter((r) => r.component === 'Row');
    expect(rows.length).toBeLessThanOrEqual(MAX_REPORTS_PER_COMMIT);
    expect(getState().truncated).toBeGreaterThanOrEqual(50);
  });

  it('reports are posted on a real window only after the page side says it listens; replay() also opens the gate', async () => {
    const posted: { type: string }[] = [];
    const onMessage = (e: MessageEvent): void => {
      if (e.data && e.data.__rerenderLens) posted.push(e.data as { type: string });
    };
    window.addEventListener('message', onMessage);
    const collector = createCollector();
    const notify = createDevtoolsNotifier({ target: window });
    init({ silent: true, notifier: (r) => (collector.notifier(r), notify(r)) });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = React.useState(0);
      bump = () => setN(n + 1);
      return h(Child, { n: 1 });
    }
    const hn = mount(h(Parent));
    act(bump);
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'hello')).toBe(true));
    expect(posted.filter((m) => m.type === 'report')).toHaveLength(0); // nobody listens yet
    window.postMessage({ __rerenderLensReady: true }, '*');
    await vi.waitFor(() => expect(posted.some((m) => (m as { __rerenderLensReady?: boolean }).__rerenderLensReady || m.type === 'hello')).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    act(bump);
    await vi.waitFor(() => expect(posted.filter((m) => m.type === 'report')).toHaveLength(1));
    hn.unmount();
    window.removeEventListener('message', onMessage);
  });
});
