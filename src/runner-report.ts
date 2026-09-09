/**
 * The parts of the test-runner integrations that do not depend on a runner: the per-file setup, the
 * JSONL hand-off between workers and the reporter, and the reporter's finish logic.
 *
 * `rerender-lens/vitest` (src/vitest.ts) and `rerender-lens/jest` (src/jest.ts) are thin wrappers
 * around this: they only differ in how the runner names its hooks and constructs a reporter.
 *
 * Workers cannot talk to the reporter directly, so each test file appends its reports as one JSON
 * line to a file the reporter created (path shared through RERENDER_LENS_OUT, which workers inherit
 * because reporters are constructed in the main process before any worker spawns); the reporter
 * reads it when the run ends.
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

/** Environment variable carrying the path of the run's JSONL file from the reporter to the workers. */
export const OUT_ENV = 'RERENDER_LENS_OUT';

export interface SetupOptions extends Omit<Options, 'notifier'> {
  /** Also fail each test file that recorded avoidable re-renders (default false: the reporter decides). */
  failFast?: boolean;
}

/** How the setup ties into the test runner (`{ afterAll }` from the runner's globals). */
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
 * Call from a setup file. Creates the DevTools hook before react-dom loads, starts the library with
 * a collector, and appends this file's reports to the shared output when it ends. The collector is
 * returned for per-test assertions (`assertNoAvoidable`, `assertWithinBudget`).
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

export interface RunResult {
  /** Every report of the run, from every worker. */
  reports: RenderReport[];
  /** Set when a budget file was given and exceeded; the run must fail. */
  error: Error | null;
}

/** Create the run's JSONL file and publish its path so workers spawned after this inherit it. */
export function createRunFile(): string {
  const dir = join(tmpdir(), 'rerender-lens');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `run-${process.pid}-${Date.now()}.jsonl`);
  writeFileSync(file, '');
  process.env[OUT_ENV] = file; // workers inherit it
  return file;
}

/** Print the run's summary and fixes, write the export, check the budget, then remove the file. */
export function finishRun(file: string, options: ReporterOptions = {}): RunResult {
  const reports = readRun(file);
  const log = options.write ?? ((line: string): void => void process.stdout.write(line + '\n'));
  const avoidable = reports.filter((r) => r.avoidable).length;
  let error: Error | null = null;
  log('');
  log(`rerender-lens: ${reports.length} report${reports.length === 1 ? '' : 's'}, ${avoidable} avoidable across the run`);
  if (avoidable) log(formatFixes(reports, options.limit ?? 10));
  if (options.exportTo) writeFileSync(options.exportTo, JSON.stringify({ rerenderLens: true, version: 2, exportedAt: new Date().toISOString(), reports }, null, 2));
  if (options.budget) {
    const budget = JSON.parse(readFileSync(options.budget, 'utf8')) as Budget;
    const result = checkBudget(reports, budget);
    if (!result.ok) {
      const lines = result.violations.map((v) => `  budget exceeded: <${v.component}> ${v.avoidable} avoidable (allowed ${v.allowed})`);
      for (const line of lines) log(line);
      error = new Error(`rerender-lens: re-render budget exceeded (${options.budget})\n${lines.join('\n')}`);
    } else log(`  within budget (${options.budget})`);
  }
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
  if (process.env[OUT_ENV] === file) delete process.env[OUT_ENV];
  return { reports, error };
}

/**
 * What a reporter class needs, whatever the runner: the run file, re-arming the environment variable
 * when the runner starts, and a finish that runs once.
 */
export class RunReporterCore {
  readonly file: string;
  readonly options: ReporterOptions;
  private done = false;
  constructor(options: ReporterOptions = {}) {
    this.options = options;
    this.file = createRunFile();
  }
  /** Publish the path again (the runner may have replaced `process.env` since the constructor ran). */
  arm(): void {
    process.env[OUT_ENV] = this.file;
  }
  /** The run's result, or null when the run was already finished (runners fire two "done" events). */
  finish(): RunResult | null {
    if (this.done) return null;
    this.done = true;
    return finishRun(this.file, this.options);
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
