/**
 * Vitest integration: one `setupFiles` line collects every avoidable re-render across the run,
 * and a reporter prints the ranked fixes (and enforces a budget file) when the run ends.
 *
 *   // vitest.config.ts
 *   test: {
 *     setupFiles: ['rerender-lens/vitest/setup'],
 *     reporters: ['default', ['rerender-lens/vitest', { budget: 'rerender-budget.json' }]],
 *   }
 *
 * Custom options: write your own setup file and call `setupRerenderLens(options, { afterAll })`.
 *
 * Everything that is not Vitest-specific lives in `src/runner-report.ts`, shared with
 * `rerender-lens/jest`.
 */
import { RunReporterCore, type ReporterOptions } from './runner-report';
import { formatFixes } from './fixes';
import { checkBudget } from './budget';

export { OUT_ENV, setupRerenderLens, readRun } from './runner-report';
export type { SetupOptions, SetupHooks, LensSetup, ReporterOptions, RunResult } from './runner-report';

/** Vitest reporter (`reporters: [['rerender-lens/vitest', { budget }]]`). */
export default class RerenderLensReporter {
  private core: RunReporterCore;
  constructor(options: ReporterOptions = {}) {
    this.core = new RunReporterCore(options);
  }
  onInit(): void {
    this.core.arm();
  }
  onTestRunEnd(): void {
    this.finish();
  }
  /** Vitest < 3 name for the same event. */
  onFinished(): void {
    this.finish();
  }
  private finish(): void {
    const result = this.core.finish();
    if (result?.error) process.exitCode = 1;
  }
}

export { formatFixes, checkBudget };
