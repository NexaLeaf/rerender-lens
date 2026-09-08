import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBudget, compareSummaries, createCollector, disable, formatComparison, formatFixes, init, parseExport, rankFixes, summarizeReports, toBudget, track } from '../src/index';
import { main } from '../src/cli';
import { h, mount } from './helpers';

afterEach(() => disable());

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => React.act(bump) };
}

/** Two rounds of the example app's bugs: an inline style object and an inline callback. */
function collectSample(rounds: number) {
  const collector = createCollector();
  init({ notifier: collector.notifier, silent: true, trackAllMemoized: true, include: ['Plain'] });
  const Row = React.memo(function Row(p: { style: object; onSelect: () => void }) {
    return h('span', { onClick: p.onSelect }, JSON.stringify(p.style));
  });
  Row.displayName = 'Row';
  const Plain = (p: { n: number }) => h('i', null, p.n);
  const { Parent, rerender } = makeParent((n) => h('div', null, h(Row, { style: { a: 1 }, onSelect: () => {} }), h(Plain, { n: 1 })));
  const hn = mount(h(Parent));
  for (let i = 0; i < rounds; i++) rerender();
  hn.unmount();
  disable();
  return collector;
}

describe('fixes, budgets and sessions in the library', () => {
  it('ranks fixes and prints them; the collector exposes them and puts them in assertNoAvoidable', () => {
    const collector = collectSample(2);
    const ranked = rankFixes(collector.reports);
    // ties sort by label, case-insensitively
    expect(ranked.map((f) => [f.label, f.count])).toEqual([
      ['useCallback(onSelect) in <Parent>', 2],
      ['useMemo(style) in <Parent>', 2],
      ['Wrap <Plain> in React.memo', 2],
    ]);
    expect(collector.fixes()).toEqual(ranked);
    expect(formatFixes(collector.reports)).toContain(' 1. useCallback(onSelect) in <Parent>  (removes 2: <Row> x2)');
    expect(formatFixes(collector.reports)).toContain(' 3. Wrap <Plain> in React.memo  (removes 2: <Plain> x2)');
    expect(() => collector.assertNoAvoidable()).toThrow(/Fixes, most impact first:\n 1\. /);
  });

  it('budgets: check, init and assert', () => {
    const collector = collectSample(3);
    expect(checkBudget(collector.reports, 0).ok).toBe(false);
    expect(checkBudget(collector.reports, 0).violations.map((v) => [v.component, v.avoidable]).sort()).toEqual([
      ['Plain', 3],
      ['Row', 3],
    ]);
    const budget = toBudget(collector.reports);
    expect(budget).toEqual({ '*': 0, Plain: 3, Row: 3 });
    expect(checkBudget(collector.reports, budget).ok).toBe(true);
    expect(checkBudget(collector.reports, { '*': 0, Plain: 5, Row: 3 }).slack).toEqual([{ component: 'Plain', avoidable: 3, allowed: 5 }]);
    expect(() => collector.assertWithinBudget({ '*': 0, Row: 3 })).toThrow(/<Plain>: 3 avoidable re-renders \(budget 0\)/);
    expect(collector.assertWithinBudget(budget).ok).toBe(true);
  });

  it('summaries compare before and after a fix, flagging regressions and resolved fixes', () => {
    const before = summarizeReports(collectSample(3).reports, { name: 'before' });
    const after = summarizeReports(collectSample(1).reports, { name: 'after' });
    const cmp = compareSummaries(before, after);
    expect(cmp.avoidable).toEqual({ before: 6, after: 2, delta: -4 });
    expect(cmp.rows.map((r) => [r.component, r.delta])).toEqual([
      ['Plain', -2],
      ['Row', -2],
    ]);
    expect(cmp.regressions).toEqual([]);
    expect(compareSummaries(after, before).regressions).toHaveLength(2);
    const text = formatComparison(cmp);
    expect(text).toContain('all components');
    expect(text).toMatch(/<Plain>\s+3\s+1\s+-2/);
    expect(parseExport({ rerenderLens: true, reports: [] }).reports).toEqual([]);
    expect(parseExport(before).summary).toBe(before);
    expect(() => parseExport({ nope: 1 })).toThrow();
  });

  it('CLI: fixes, summary, compare (exit 1 on regressions) and budget (exit 1 on violations)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-cli-'));
    const before = join(dir, 'before.json');
    const after = join(dir, 'after.json');
    writeFileSync(before, JSON.stringify({ rerenderLens: true, reports: collectSample(3).reports }));
    writeFileSync(after, JSON.stringify({ rerenderLens: true, reports: collectSample(1).reports }));
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    const error = vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
    try {
      expect(main(['fixes', before])).toBe(0);
      expect(out.join('\n')).toContain('1. useCallback(onSelect) in <Parent>');
      out.length = 0;
      const summaryFile = join(dir, 'summary.json');
      expect(main(['summary', before, '--out', summaryFile])).toBe(0);
      expect(JSON.parse(readFileSync(summaryFile, 'utf8')).avoidable).toBe(6);
      expect(main(['compare', before, after])).toBe(0);
      expect(main(['compare', after, before])).toBe(1);
      expect(err.join('\n')).toContain('2 components regressed');
      out.length = 0;
      expect(main(['budget', after, '--init'])).toBe(0);
      const budgetFile = join(dir, 'budget.json');
      writeFileSync(budgetFile, out.join('\n'));
      expect(main(['budget', after, budgetFile])).toBe(0);
      expect(main(['budget', before, budgetFile])).toBe(1);
      expect(main(['compare', summaryFile, after])).toBe(0); // a summary file works as a baseline too
      expect(main(['nope'])).toBe(1);
      expect(main(['compare'])).toBe(1);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
