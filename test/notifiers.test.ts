import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { buildReport } from '../src/report';
import { combineNotifiers, createCollector, createDevtoolsNotifier, serialize, DEVTOOLS_MARKER } from '../src/index';

const avoidable = buildReport({ component: 'A', renderCount: 1, prevProps: {}, nextProps: {}, propChanges: [] });
const genuine = buildReport({
  component: 'B', renderCount: 1, prevProps: { n: 1 }, nextProps: { n: 2 },
  propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }],
});

describe('createCollector', () => {
  it('collects, filters and asserts', () => {
    const c = createCollector();
    c.notifier(genuine);
    expect(() => c.assertNoAvoidable()).not.toThrow();
    c.notifier(avoidable);
    expect(c.avoidable).toHaveLength(1);
    expect(() => c.assertNoAvoidable()).toThrow(/1 avoidable re-render detected:\n {2}<A> render #1/);
    c.clear();
    expect(c.reports).toHaveLength(0);
  });
});

describe('combineNotifiers', () => {
  it('fans out and skips falsy entries', () => {
    const a = vi.fn();
    const b = vi.fn();
    combineNotifiers(a, undefined, false, b)(avoidable);
    expect(a).toHaveBeenCalledWith(avoidable);
    expect(b).toHaveBeenCalledWith(avoidable);
  });
});

describe('serialize', () => {
  it('makes values postMessage-safe', () => {
    const cyc: Record<string, unknown> = { name: 'x' };
    cyc.self = cyc;
    const El = () => null;
    const out = serialize({
      fn: function handler() {},
      el: React.createElement(El),
      date: new Date(0),
      map: new Map([['k', 1]]),
      set: new Set([1]),
      big: 10n,
      nan: NaN,
      cyc,
      inst: new (class Foo { v = 1; })(),
    }) as Record<string, unknown>;
    expect(out.fn).toBe('ƒ handler');
    expect(out.el).toBe('<El>');
    expect(out.date).toEqual({ $type: 'Date', value: '1970-01-01T00:00:00.000Z' });
    expect(out.map).toEqual({ $type: 'Map', entries: [['k', 1]] });
    expect(out.set).toEqual({ $type: 'Set', values: [1] });
    expect(out.big).toBe('10n');
    expect(out.nan).toBe('NaN');
    expect((out.cyc as Record<string, unknown>).self).toBe('[Circular]');
    expect(out.inst).toEqual({ v: 1, $type: 'Foo' });
    expect(() => structuredClone(out)).not.toThrow();
  });
  it('cuts at maxDepth', () => {
    expect(serialize({ a: { b: { c: 1 } } }, 2)).toEqual({ a: { b: '[…]' } });
  });
});

describe('createDevtoolsNotifier', () => {
  it('posts hello, reports, replays and clears', () => {
    const postMessage = vi.fn();
    const notify = createDevtoolsNotifier({ target: { postMessage } as unknown as Window, bufferSize: 2 });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]![0]).toMatchObject({ [DEVTOOLS_MARKER]: true, type: 'hello' });
    notify(avoidable);
    notify(genuine);
    notify(genuine);
    const bridge = window.__RERENDER_LENS_DEVTOOLS__!;
    expect(bridge.size).toBe(2);
    postMessage.mockClear();
    bridge.replay();
    expect(postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['hello', 'report', 'report']);
    const posted = postMessage.mock.calls[1]![0] as { payload: { component: string; props: unknown } };
    expect(posted.payload.component).toBe('B');
    expect(() => structuredClone(posted)).not.toThrow();
    bridge.clear();
    expect(bridge.size).toBe(0);
    expect(postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'clear' });
  });
});
