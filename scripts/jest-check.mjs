#!/usr/bin/env node
/**
 * `npm run test:jest` — the proof that `rerender-lens/jest` works in a real Jest run.
 *
 * Runs the app in `test/jest/` twice against the built package (so `npm run build` first):
 *   1. with a budget of zero: the tests pass, but the reporter must fail the run and print the
 *      ranked fixes and every violation;
 *   2. with a budget that fits: the same run must exit 0 and say it is within budget.
 *
 * Jest is not part of the Vitest suite (`test/**\/*.jest.test.tsx` matches nothing in
 * `vitest.config.ts`), so this script is what keeps the integration from rotting.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = join(root, 'test', 'jest', 'jest.config.cjs');
const jestBin = createRequire(import.meta.url).resolve('jest/bin/jest');
const exportTo = join(mkdtempSync(join(tmpdir(), 'rerender-lens-jest-')), 'export.json');

if (!existsSync(join(root, 'dist', 'jest.cjs'))) {
  console.error('test:jest: dist/jest.cjs is missing. Run `npm run build` first.');
  process.exit(1);
}

/** @param {{ budget: string, exportTo?: string }} options */
function runJest({ budget, exportTo: out }) {
  const result = spawnSync(process.execPath, [jestBin, '--config', config], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RERENDER_LENS_BUDGET: budget, ...(out ? { RERENDER_LENS_EXPORT: out } : {}), FORCE_COLOR: '0' },
  });
  return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

const failures = [];
/** @param {string} what @param {boolean} ok @param {string} [detail] */
const check = (what, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(detail ? `${what}\n${detail}` : what);
};

console.log('test:jest: run 1 of 2 — budget.fail.json (every avoidable re-render is a violation)');
const strict = runJest({ budget: join(root, 'test', 'jest', 'budget.fail.json'), exportTo });
check('the tests themselves pass', /Tests:\s+\d+ passed/.test(strict.output) && !/Tests:.*failed/.test(strict.output), strict.output);
check('the run fails on the budget', strict.status !== 0, `exit code ${strict.status}`);
check('the summary counts the reports', /rerender-lens: \d+ reports, \d+ avoidable across the run/.test(strict.output), strict.output);
check('the ranked fixes are printed', /Fixes|useCallback|useMemo|React\.memo/.test(strict.output), strict.output);
check('<Row> is over budget', /budget exceeded: <Row> \d+ avoidable \(allowed 0\)/.test(strict.output), strict.output);
check('<Label> is over budget', /budget exceeded: <Label> \d+ avoidable \(allowed 0\)/.test(strict.output), strict.output);
check('<Card> (stable props) is not reported at all', !/<Card>/.test(strict.output), strict.output);

const exported = existsSync(exportTo) ? JSON.parse(readFileSync(exportTo, 'utf8')) : null;
check('the export is a panel import file with the run\'s reports', Boolean(exported && exported.rerenderLens && exported.reports.length > 0));

console.log('\ntest:jest: run 2 of 2 — budget.pass.json (per-component allowances that fit)');
const loose = runJest({ budget: join(root, 'test', 'jest', 'budget.pass.json') });
check('the run passes', loose.status === 0, `exit code ${loose.status}\n${loose.output}`);
check('the reporter says it is within budget', /within budget \(.*budget\.pass\.json\)/.test(loose.output), loose.output);

if (failures.length) {
  console.error(`\ntest:jest: ${failures.length} check(s) failed:\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`\ntest:jest: all checks passed (${exported.reports.length} reports collected across ${new Set(exported.reports.map((r) => r.component)).size} components)`);
