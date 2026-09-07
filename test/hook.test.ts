import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { createCollector, disable, useWhyRerender } from '../src/index';
import { h, mount, silentConsole } from './helpers';

afterEach(() => disable());

describe('useWhyRerender', () => {
  it('works without init(): reports to the given notifier', () => {
    const collector = createCollector();
    const con = silentConsole();
    const opts = { notifier: collector.notifier, console: con.console };
    function Row(p: { style: object; n: number }) {
      useWhyRerender('Row', p, opts);
      return h('span', null, p.n);
    }
    let bump = () => {};
    function Parent() {
      const [k, setK] = React.useState(0);
      bump = () => setK((x) => x + 1);
      return h(Row, { style: { a: 1 }, n: k < 2 ? 0 : k });
    }
    const hn = mount(h(Parent));
    expect(collector.reports).toHaveLength(0);
    React.act(bump);
    expect(collector.reports).toHaveLength(1);
    expect(collector.reports[0]!.avoidable).toBe(true);
    expect(collector.reports[0]!.propChanges[0]).toMatchObject({ path: 'style', kind: 'deep-equal' });
    expect(con.calls[0]).toMatch(/<Row> avoidable/);
    React.act(bump);
    expect(collector.reports[1]!.trigger).toBe('props');
    hn.unmount();
  });

  it('reports once per commit under StrictMode', () => {
    const collector = createCollector();
    const opts = { notifier: collector.notifier, silent: true };
    function Row(p: { n: number }) {
      useWhyRerender('Row', p, opts);
      return h('span', null, p.n);
    }
    let bump = () => {};
    function Parent() {
      const [k, setK] = React.useState(0);
      bump = () => setK((x) => x + 1);
      return h(Row, { n: 1 });
    }
    const hn = mount(h(React.StrictMode, null, h(Parent)));
    React.act(bump);
    React.act(bump);
    expect(collector.reports).toHaveLength(2);
    expect(collector.reports.map((r) => r.renderCount)).toEqual([1, 2]);
    hn.unmount();
  });
});
