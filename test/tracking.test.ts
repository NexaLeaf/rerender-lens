import { describe, expect, it } from 'vitest';
import React from 'react';
import { explainTracking, shouldTrack, track, type Options } from '../src/index';

const Plain = function Plain() {
  return null;
};
const Memo = React.memo(function Inner() {
  return null;
});
(Memo as { displayName?: string }).displayName = 'Memo';
class Pure extends React.PureComponent {
  override render() {
    return null;
  }
}
class Klass extends React.Component {
  override render() {
    return null;
  }
}
const Fwd = React.forwardRef(function Fwd() {
  return null;
});
const Marked = track(function Marked() {
  return null;
}, 'Marked');
const anon = () => null; // an arrow assigned to a const still gets a name; strip it
Object.defineProperty(anon, 'name', { value: '' });

describe('explainTracking', () => {
  it('names the rule that decided, and what to change', () => {
    // the common case: trackAllMemoized on, but the component is a plain function
    const v = explainTracking(Plain, { trackAllMemoized: true });
    expect(v).toMatchObject({ tracked: false, name: 'Plain', memoized: false });
    expect(v.reason).toContain('only covers React.memo components and PureComponent classes');
    expect(v.reason).toContain('<Plain>');
    expect(v.fix).toContain('Add "Plain" to include');
    expect(v.fix).toContain('React.memo');
    expect(v.fix).toContain('Track every component');
  });

  it('explains every selection rule', () => {
    // marked with track()
    expect(explainTracking(Marked, {})).toMatchObject({ tracked: true, name: 'Marked' });
    expect(explainTracking(Marked, {}).reason).toContain('track()');
    // include
    const inc = explainTracking(Plain, { include: [/^Pl/] });
    expect(inc.tracked).toBe(true);
    expect(inc.reason).toContain('matches "include"');
    // exclude wins over the marker
    const exc = explainTracking(Marked, { exclude: ['Marked'], trackAllComponents: true });
    expect(exc.tracked).toBe(false);
    expect(exc.reason).toContain('wins over every other rule');
    expect(exc.fix).toContain('exclude');
    // track every component
    expect(explainTracking(Plain, { trackAllComponents: true }).reason).toContain('"Track every component" is on');
    // memo / PureComponent under trackAllMemoized
    const memo = explainTracking(Memo, { trackAllMemoized: true });
    expect(memo).toMatchObject({ tracked: true, name: 'Memo', memoized: true });
    expect(memo.reason).toContain('React.memo component');
    const pure = explainTracking(Pure, { trackAllMemoized: true });
    expect(pure).toMatchObject({ tracked: true, name: 'Pure', memoized: true });
    expect(pure.reason).toContain('PureComponent');
    // nothing turned on at all
    const none = explainTracking(Klass, {});
    expect(none.tracked).toBe(false);
    expect(none.reason).toContain('Nothing selects <Klass>');
    expect(none.fix).toContain('Track every React.memo and PureComponent');
  });

  it('flags a component with no display name and a host element', () => {
    const noName = explainTracking(anon, { trackAllMemoized: true });
    expect(noName).toMatchObject({ tracked: false, name: 'Anonymous' });
    expect(noName.reason).toContain('no display name');
    expect(noName.fix).toContain("track(fn, 'Name')");
    // ...unless something else already selects it
    expect(explainTracking(anon, { trackAllComponents: true }).tracked).toBe(true);

    const host = explainTracking('div', { trackAllComponents: true });
    expect(host).toMatchObject({ tracked: false, name: 'div', memoized: false });
    expect(host.reason).toContain('DOM element');
    expect(host.fix).toBeUndefined();

    const nope = explainTracking({ not: 'a component' }, { trackAllComponents: true });
    expect(nope).toMatchObject({ tracked: false, name: 'Anonymous' });
    expect(nope.reason).toContain('not a React component type');
  });

  it('agrees with shouldTrack over a matrix of types and options', () => {
    const types: unknown[] = [Plain, Memo, Pure, Klass, Fwd, Marked, anon, 'div', 'span', null, undefined, 42, { a: 1 }];
    const optionSets: Options[] = [
      {},
      { trackAllMemoized: true },
      { trackAllComponents: true },
      { trackAllMemoized: true, trackAllComponents: true },
      { include: ['Plain'] },
      { include: [/^(Plain|Memo|Pure|Klass|Fwd|Marked|Anonymous|div)$/] },
      { include: [(n: string) => n.length > 3] },
      { exclude: ['Marked'] },
      { exclude: [/./], trackAllComponents: true },
      { exclude: ['Plain'], include: ['Plain'] },
      { trackAllMemoized: true, exclude: ['Memo'] },
      { trackAllComponents: true, exclude: ['Pure'], include: ['Pure'] },
    ];
    for (const t of types) {
      for (const o of optionSets) {
        const verdict = explainTracking(t, o);
        expect({ type: String((t as { name?: string })?.name ?? t), options: o, tracked: verdict.tracked }).toEqual({
          type: String((t as { name?: string })?.name ?? t),
          options: o,
          tracked: shouldTrack(t, o),
        });
        expect(verdict.reason.length).toBeGreaterThan(0);
        // a fix is offered exactly when there is something to change
        if (verdict.tracked) expect(verdict.fix).toBeUndefined();
      }
    }
  });
});
