import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { disable, track } from '../src/index';
import { jsx, jsxs, Fragment } from '../src/jsx-runtime';
import { jsxDEV } from '../src/jsx-dev-runtime';
import { mount, setup } from './helpers';

afterEach(() => disable());

describe('jsx-runtime entries', () => {
  it('route tracked types through the wrapper and share state with the main entry', () => {
    const { collector } = setup();
    const Child = track((p: { n: number }) => jsx('span', { children: p.n }));
    let bump = () => {};
    function Parent() {
      const [k, setK] = React.useState(0);
      bump = () => setK((x) => x + 1);
      return jsxs(Fragment, { children: [jsx(Child, { n: 1 }, 'a'), jsxDEV(Child, { n: 1 }, 'b', false, undefined, undefined)] });
    }
    expect(jsx(Child, { n: 1 }).type).not.toBe(Child);
    const hn = mount(jsx(Parent, {}));
    React.act(bump);
    expect(collector.reports).toHaveLength(2);
    expect(collector.reports.every((r) => r.avoidable)).toBe(true);
    hn.unmount();
  });
  it('pass untracked and host types through unchanged', () => {
    setup();
    const Plain = () => null;
    expect(jsx(Plain, {}).type).toBe(Plain);
    expect(jsx('div', {}).type).toBe('div');
    expect(jsx(Fragment, {}).type).toBe(Fragment);
  });
});
