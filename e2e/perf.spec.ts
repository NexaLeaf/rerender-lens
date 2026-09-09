import { expect, test } from '@playwright/test';
import { appendFileSync } from 'node:fs';

/**
 * What the library costs on a big tree, at two sizes, so a regression shows up before a user hits
 * it. Runs nightly (`.github/workflows/perf.yml`) and on demand: `npm run e2e:perf`.
 * `PERF_ROWS=3000,10000` overrides the sizes.
 */
const SIZES = (process.env.PERF_ROWS || '3000,10000').split(',').map((n) => Number(n.trim())).filter(Boolean);

/**
 * Worst single commit, in ms, allowed at each size. The cost is flat in the number of rows because
 * `onCommit` stops after its time budget (about 32 ms at both sizes on a laptop), so these are
 * headroom for a slower machine, not a scaling curve: if they start failing, the cap is broken.
 */
const BUDGET_MS: Record<number, number> = { 3000: 150, 10000: 200 };
const budgetFor = (rows: number): number => BUDGET_MS[rows] ?? 200;

interface Info {
  commits: number;
  truncated: number;
  overhead: { totalMs: number; maxCommitMs: number };
}

const rows: string[] = [];

test.afterAll(() => {
  const table = ['| rows | worst commit | total overhead | commits | reports skipped |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
  process.stdout.write(`\n${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### rerender-lens: cost per commit\n\n${table}\n`);
});

for (const size of SIZES) {
  test(`${size} memoized rows: the worst commit stays under ${budgetFor(size)} ms`, async ({ page }) => {
    await page.goto(`/scale.html?rows=${size}`);
    await expect(page.getByRole('heading', { name: 'rerender-lens scale test' })).toBeVisible();
    const button = page.getByRole('button', { name: /Re-render everything/ });
    for (let i = 0; i < 3; i++) await button.click();
    await expect(page.getByRole('button', { name: `Re-render everything (3)` })).toBeVisible();
    const info = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info() as unknown as Info);
    rows.push(`| ${size} | ${info.overhead.maxCommitMs.toFixed(1)} ms | ${info.overhead.totalMs.toFixed(1)} ms | ${info.commits} | ${info.truncated} |`);
    // The page must also still answer promptly: nothing is queued behind the commit hook.
    const start = Date.now();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    expect(Date.now() - start, 'event loop latency').toBeLessThan(2000);
    expect(info.overhead.maxCommitMs, `worst commit at ${size} rows`).toBeLessThan(budgetFor(size));
  });
}
