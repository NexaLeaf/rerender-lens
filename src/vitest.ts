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
 * Workers cannot talk to the reporter directly, so each test file appends its reports as one JSON
 * line to a file the reporter created (path shared through RERENDER_LENS_OUT); the reporter reads
 * it when the run ends.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, RenderReport } from './types';
import { ensureDevtoolsHook } from './fiber';
import { init } from './tracker';
import { createCollector, type Collector } from './notifiers';
import { formatFixes } from './fixes';
import { checkBudget, type Budget } from './budget';

export const OUT_ENV = 'RERENDER_LENS_OUT';

export interface SetupOptions extends Omit<Options, 'notifier'> {
  /** Also fail each test file that recorded avoidable re-renders (default false: the reporter decides). */
  failFast?: boolean;
}

/** How the setup ties into the test runner (`{ afterAll }` from 'vitest'; `rerender-lens/vitest/setup` does this). */
export interface SetupHooks {
  afterAll?: (fn: () => void) => void;
  /** Path of the current test file, for the reporter's output. */
  testPath?: () => string | undefined;
}

export interface LensSetup {
  collector: Collector;
  /** Append this file's reports to the shared output and clear the collector; registered with `afterAll` when given. */
  flush(): void;
}

/**
 * Call from a `setupFiles` entry. Creates the DevTools hook before react-dom loads, starts the
 * library with a collector, and appends this file's reports to the shared output when it ends.
 * The collector is returned for per-test assertions (`assertNoAvoidable`, `assertWithinBudget`).
 */
export function setupRerenderLens(options: SetupOptions = {}, hooks: SetupHooks = {}): LensSetup {
  ensureDevtoolsHook();
  const { failFast, ...rest } = options;
  const collector = createCollector();
  init({ trackAllMemoized: true, silent: true, ...rest, notifier: collector.notifier });
  const flush = (): void => {
    const reports = collector.reports.slice();
    if (!reports.length) return;
    const file = process.env[OUT_ENV];
    if (file) appendFileSync(file, JSON.stringify({ file: hooks.testPath?.() ?? '', reports: reports.map(slim) }) + '\n');
    collector.clear();
    if (failFast) {
      const avoidable = reports.filter((r) => r.avoidable);
      if (avoidable.length) throw new Error(`rerender-lens: ${avoidable.length} avoidable re-render${avoidable.length === 1 ? '' : 's'} in this file\n${formatFixes(avoidable, 5)}`);
    }
  };
  hooks.afterAll?.(flush);
  return { collector, flush };
}

/** Keep what the reporter needs and drop prop/state values (they can be large and are not serializable). */
function slim(r: RenderReport): RenderReport {
  const value = (v: unknown): unknown => (Array.isArray(v) ? [] : typeof v === 'function' ? `ƒ ${(v as { name?: string }).name || ''}` : v && typeof v === 'object' ? {} : v);
  return {
    ...r,
    propChanges: r.propChanges.map((c) => ({ ...c, prev: value(c.prev), next: value(c.next) })),
    stateChanges: r.stateChanges.map((c) => ({ ...c, prev: value(c.prev), next: value(c.next) })),
    hookChanges: r.hookChanges.map((c) => ({ ...c, prev: value(c.prev), next: value(c.next) })),
    props: { prev: {}, next: {} },
    hookState: undefined,
    contexts: undefined,
    state: undefined,
  };
}

export interface ReporterOptions {
  /** Path to a budget JSON (`{ "*": 0, "Row": 2 }`). When set, the run fails on violations. */
  budget?: string;
  /** Print at most this many fixes. Default 10. */
  limit?: number;
  /** Also write the collected reports here as a panel-compatible export (`Sessions > Import`). */
  exportTo?: string;
  /** Where the lines go. Default `process.stdout`. */
  write?: (line: string) => void;
}

/** Vitest reporter (`reporters: [['rerender-lens/vitest', { budget }]]`). */
export default class RerenderLensReporter {
  private options: ReporterOptions;
  private file: string;
  private done = false;
  constructor(options: ReporterOptions = {}) {
    this.options = options;
    const dir = join(tmpdir(), 'rerender-lens');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `run-${process.pid}-${Date.now()}.jsonl`);
    writeFileSync(this.file, '');
    process.env[OUT_ENV] = this.file; // workers inherit it
  }
  onInit(): void {
    process.env[OUT_ENV] = this.file;
  }
  onTestRunEnd(): void {
    this.finish();
  }
  /** Vitest < 3 name for the same event. */
  onFinished(): void {
    this.finish();
  }
  private finish(): void {
    if (this.done) return;
    this.done = true;
    const reports = readRun(this.file);
    const log = this.options.write ?? ((line: string): void => void process.stdout.write(line + '\n'));
    const avoidable = reports.filter((r) => r.avoidable).length;
    log('');
    log(`rerender-lens: ${reports.length} report${reports.length === 1 ? '' : 's'}, ${avoidable} avoidable across the run`);
    if (avoidable) log(formatFixes(reports, this.options.limit ?? 10));
    if (this.options.exportTo) writeFileSync(this.options.exportTo, JSON.stringify({ rerenderLens: true, version: 2, exportedAt: new Date().toISOString(), reports }, null, 2));
    if (this.options.budget) {
      const budget = JSON.parse(readFileSync(this.options.budget, 'utf8')) as Budget;
      const result = checkBudget(reports, budget);
      if (!result.ok) {
        for (const v of result.violations) log(`  budget exceeded: <${v.component}> ${v.avoidable} avoidable (allowed ${v.allowed})`);
        process.exitCode = 1;
      } else log(`  within budget (${this.options.budget})`);
    }
    try {
      rmSync(this.file, { force: true });
    } catch {
      /* ignore */
    }
    if (process.env[OUT_ENV] === this.file) delete process.env[OUT_ENV];
  }
}

/** Reports from every worker of a run. */
export function readRun(file: string): RenderReport[] {
  if (!existsSync(file)) return [];
  const out: RenderReport[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { reports?: RenderReport[] };
      if (Array.isArray(parsed.reports)) out.push(...parsed.reports);
    } catch {
      /* partial line */
    }
  }
  return out;
}

export { formatFixes, checkBudget };
