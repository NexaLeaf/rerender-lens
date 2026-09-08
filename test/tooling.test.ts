import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeCommit, checkBudget, compareSummaries, createCollector, disable, formatComparison, formatFixes, formatRootCauses, groupByCommit, init, parseExport, rankFixes, rankRootCauses, rootCauseOf, rootCauseSummary, summarizeReports, toBudget, track } from '../src/index';
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

  it('root causes: commits group by commitId and trace back to the component whose state changed', () => {
    const collector = collectSample(2);
    const commits = groupByCommit(collector.reports);
    expect([...commits.values()].map((c) => c.map((r) => r.component))).toEqual([
      ['Row', 'Plain'],
      ['Row', 'Plain'],
    ]);
    const [first] = [...commits.values()];
    // <Parent> is not tracked, so the walk stops at the parent link itself
    expect(rootCauseOf(first![0]!, first!)).toEqual({ name: 'Parent', trigger: 'state', report: null });
    const a = analyzeCommit(first!);
    expect(a.id).toBe(first![0]!.commitId);
    expect(a.avoidable).toBe(2);
    expect(a.roots).toEqual([{ name: 'Parent', trigger: 'state', count: 2, components: new Map([['Row', 1], ['Plain', 1]]) }]);
    expect(a.rootByReport.get(first![1]!)).toBe('Parent');
    const s = rootCauseSummary('Parent', commits);
    expect(s.total).toBe(4);
    expect(s.commits.map((c) => c.key)).toEqual([...commits.keys()].reverse());
    expect(s.affected).toHaveLength(4);
    expect(rankRootCauses(collector.reports)).toEqual([{ name: 'Parent', trigger: 'state', commits: 2, count: 4, components: new Map([['Row', 2], ['Plain', 2]]) }]);
    expect(formatRootCauses(collector.reports)).toBe(' 1. <Parent> (state) started 2 commits, 4 avoidable re-renders  (<Row> x2, <Plain> x2)');
    // a tracked ancestor in the same commit becomes the root; the walk follows parent links through it
    const page = { ...first![0]!, component: 'Page', path: ['App'], trigger: 'state' as const, avoidable: false, parent: null };
    const list = { ...first![0]!, component: 'List', path: ['App', 'Page'], parent: { name: 'Page', trigger: 'state' as const } };
    const row = { ...first![1]!, component: 'Row', path: ['App', 'Page', 'List'], parent: { name: 'List', trigger: 'parent' as const } };
    expect(rootCauseOf(row, [page, list, row])).toMatchObject({ name: 'Page', trigger: 'state', report: page });
    expect(rootCauseOf(page, [page, list, row])).toBeNull();
    // no commit ids (useWhyRerender reports): nothing to rank
    expect(rankRootCauses(collector.reports.map((r) => ({ ...r, commitId: 0 })))).toEqual([]);
    expect(formatRootCauses([])).toBe('');
  });

  it('formatFixes appends the root causes after the fixes when reports carry commit ids', () => {
    const collector = collectSample(3);
    const text = formatFixes(collector.reports);
    const [fixes, roots] = text.split('\n\nRoot causes:\n');
    expect(fixes).toMatch(/^ 1\. useCallback\(onSelect\) in <Parent>  \(removes 3: <Row> x3\)\n 2\. /);
    expect(fixes).not.toContain('Root causes');
    expect(roots).toBe(' 1. <Parent> (state) started 3 commits, 6 avoidable re-renders  (<Row> x3, <Plain> x3)');
    expect(formatFixes(collector.reports.map((r) => ({ ...r, commitId: 0 })))).not.toContain('Root causes');
    expect(() => collector.assertNoAvoidable()).toThrow(/Root causes:\n 1\. <Parent> \(state\) started 3 commits/);
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
      expect(out.join('\n')).toContain('Root causes:\n 1. <Parent> (state) started 3 commits, 6 avoidable re-renders');
      out.length = 0;
      expect(main(['causes', before])).toBe(0);
      expect(out.join('\n')).toBe(' 1. <Parent> (state) started 3 commits, 6 avoidable re-renders  (<Row> x3, <Plain> x3)');
      out.length = 0;
      expect(main(['causes', before, '--limit', '0'])).toBe(0);
      expect(out.join('\n')).toBe('    … 1 more');
      out.length = 0;
      expect(main(['causes'])).toBe(1);
      expect(err.join('\n')).toContain('usage: rerender-lens causes');
      err.length = 0;
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
