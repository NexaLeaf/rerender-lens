import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { disable, track } from '../src/index';
import { installScript, installRerenderLens, pullReports, clearReports, expectWithinBudget, type PageLike } from '../src/playwright';
import RerenderLensReporter, { OUT_ENV, readRun, setupRerenderLens } from '../src/vitest';
import { h, mount } from './helpers';
import { act } from './react-act';

afterEach(() => {
  disable();
  delete process.env[OUT_ENV];
  process.exitCode = undefined;
});

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => act(bump) };
}

describe('rerender-lens/playwright', () => {
  it('installs the bundle at document start with the options, pulls reports and asserts a budget', async () => {
    // The packaged bundle is a build output (gitignored); the test stays hermetic with a stand-in.
    const bundle = '/* stand-in bundle */ window.RerenderLens = {};';
    const script = installScript({ bundle, include: ['Row', '/^Grid/i'], relay: 'http://127.0.0.1:4141' });
    expect(script.startsWith(bundle)).toBe(true);
    expect(script).toContain('"include":["Row","/^Grid/i"]');
    expect(script).toContain('"silent":true');
    expect(script).toContain('createDevtoolsNotifier({"relay":"http://127.0.0.1:4141"})');
    expect(installScript({ bundle })).toContain('createDevtoolsNotifier({})');
    // The real IIFE bundle exists only after `npm run build` (dist/rerender-lens.iife.js or extension/vendor/rerender-lens.js).
    const built = existsSync(join(__dirname, '..', 'extension', 'vendor', 'rerender-lens.js'));
    if (built) expect(installScript()).toContain('RerenderLens');
    else expect(() => installScript()).toThrow(/bundle not found/);

    const calls: string[] = [];
    let running = false;
    const page: PageLike = {
      async addInitScript(s) {
        calls.push(typeof s === 'string' ? s : s.content ?? '');
        running = true;
      },
      async evaluate(fn) {
        const src = String(fn);
        if (!running) return null as never;
        if (src.includes('.clear()')) return undefined as never;
        return { reports: [{ component: 'Row', avoidable: true, propChanges: [], stateChanges: [], hookChanges: [], reasons: [] }] } as never;
      },
    };
    await expect(pullReports(page)).rejects.toThrow(/installRerenderLens/);
    await installRerenderLens(page, { bundle, trackAllComponents: true });
    expect(calls[0]).toContain('"trackAllComponents":true');
    const reports = await pullReports(page);
    expect(reports.map((r) => r.component)).toEqual(['Row']);
    expect(() => expectWithinBudget(reports, { '*': 0 })).toThrow(/Row/);
    expect(expectWithinBudget(reports, { Row: 1 }).ok).toBe(true);
    await clearReports(page);
  });
});

describe('rerender-lens/vitest', () => {
  it('setup collects per file and flushes to the reporter file; the reporter prints fixes and enforces the budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-vitest-'));
    const lines: string[] = [];
    const reporter = new RerenderLensReporter({ budget: join(dir, 'budget.json'), exportTo: join(dir, 'export.json'), write: (l) => lines.push(l) });
    const file = process.env[OUT_ENV]!;
    expect(file).toMatch(/run-\d+-\d+\.jsonl$/);
    writeFileSync(join(dir, 'budget.json'), JSON.stringify({ '*': 0 }));

    const after: (() => void)[] = [];
    const lens = setupRerenderLens({ failFast: true }, { afterAll: (fn) => after.push(fn), testPath: () => 'grid.test.tsx' });
    const Child = track((p: { n: number; style?: object }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1, style: { color: 'red' } }));
    const hn = mount(h(Parent));
    rerender();
    expect(lens.collector.reports).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(() => after[0]!()).toThrow(/1 avoidable re-render in this file/);
    expect(lens.collector.reports).toHaveLength(0);
    hn.unmount();

    const run = readRun(file);
    expect(run).toHaveLength(1);
    expect(run[0]!.component).toBe('Child');
    expect(run[0]!.propChanges[0]).toMatchObject({ path: 'style', prev: {}, next: {} });
    expect(JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!).file).toBe('grid.test.tsx');

    reporter.onTestRunEnd();
    reporter.onFinished(); // idempotent
    expect(lines.join('\n')).toMatch(/1 report, 1 avoidable/);
    expect(lines.join('\n')).toMatch(/<Child>/);
    expect(lines.join('\n')).toMatch(/budget exceeded: <Child> 1 avoidable \(allowed 0\)/);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'export.json'), 'utf8')).reports).toHaveLength(1);
    expect(readRun(file)).toEqual([]); // removed
  });

  it('without a reporter, flush keeps nothing on disk and readRun tolerates partial lines', () => {
    const lens = setupRerenderLens();
    lens.flush();
    const dir = mkdtempSync(join(tmpdir(), 'lens-vitest-'));
    const file = join(dir, 'run.jsonl');
    writeFileSync(file, JSON.stringify({ reports: [{ component: 'A' }] }) + '\n{"reports": [{"compo');
    expect(readRun(file).map((r) => r.component)).toEqual(['A']);
    expect(readRun(join(dir, 'missing.jsonl'))).toEqual([]);
  });
});

describe('two copies of the library', () => {
  it('only the first attach wraps the hook, so a second bundle does not double every report', async () => {
    const { attach, ensureDevtoolsHook } = await import('../src/fiber');
    const hook = ensureDevtoolsHook();
    const detach = attach();
    const wrapped = hook.onCommitFiberRoot;
    const detachAgain = attach();
    expect(hook.onCommitFiberRoot).toBe(wrapped);
    detachAgain();
    expect(hook.onCommitFiberRoot).toBe(wrapped);
    detach();
    expect(hook.onCommitFiberRoot).not.toBe(wrapped);
  });
});
