/**
 * Jest integration: one `setupFilesAfterEnv` line collects every avoidable re-render across the run,
 * and a reporter prints the ranked fixes (and enforces a budget file) when the run ends.
 *
 *   // jest.config.js
 *   module.exports = {
 *     setupFilesAfterEnv: ['rerender-lens/jest/setup'],
 *     reporters: ['default', ['rerender-lens/jest', { budget: 'rerender-budget.json' }]],
 *   };
 *
 * Custom options: write your own setup file and call `setupRerenderLens(options, { afterAll })`.
 *
 * Same JSONL hand-off as the Vitest reporter (`src/runner-report.ts`): the reporter is constructed
 * in the main process before any worker spawns, so RERENDER_LENS_OUT is inherited by the workers.
 * Two things differ from Vitest: Jest constructs reporters with `(globalConfig, options, context)`,
 * and a reporter fails the run by returning an error from `getLastError()`.
 */
import { RunReporterCore, type ReporterOptions } from './runner-report';
import { formatFixes } from './fixes';
import { checkBudget } from './budget';

export { OUT_ENV, setupRerenderLens, readRun } from './runner-report';
export type { SetupOptions, SetupHooks, LensSetup, ReporterOptions, RunResult } from './runner-report';

/** Jest hands the reporter its global config first; ours is the second argument. */
function reporterOptionsOf(a: unknown, b: unknown): ReporterOptions {
  if (b && typeof b === 'object') return b as ReporterOptions;
  // Constructed directly (`new RerenderLensJestReporter({ budget })`) rather than by Jest.
  const first = a as Record<string, unknown> | undefined;
  if (first && typeof first === 'object' && !('rootDir' in first) && ('budget' in first || 'limit' in first || 'exportTo' in first || 'write' in first)) return first as ReporterOptions;
  return {};
}

/**
 * Jest reporter (`reporters: [['rerender-lens/jest', { budget }]]`).
 *
 * `require('rerender-lens/jest')` gives the module namespace; Jest applies the standard
 * `__esModule` interop and instantiates this default export.
 */
export default class RerenderLensJestReporter {
  private core: RunReporterCore;
  private error: Error | null = null;
  /** Jest: `new Reporter(globalConfig, reporterOptions, reporterContext)`. */
  constructor(globalConfigOrOptions?: unknown, options?: unknown) {
    this.core = new RunReporterCore(reporterOptionsOf(globalConfigOrOptions, options));
  }
  onRunStart(): void {
    this.core.arm();
  }
  onRunComplete(): void {
    const result = this.core.finish();
    if (result?.error) {
      this.error = result.error;
      process.exitCode = 1; // in case the run is not exited through Jest's own result handling
    }
  }
  /** Jest fails the run when a reporter reports an error. */
  getLastError(): Error | undefined {
    return this.error ?? undefined;
  }
}

export { formatFixes, checkBudget };
