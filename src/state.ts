import type { Options, RenderReport } from './types';
import { printReport } from './report';

export interface LensState {
  options: Options;
  enabled: boolean;
  /** Per-component print counts for `maxReportsPerComponent`. */
  printed: Map<string, number>;
  /** Restores the previous `onCommitFiberRoot`. */
  detach: (() => void) | null;
  nextInstanceId: number;
  nextCommitId: number;
  warnedOnce: Set<string>;
  /** Roots React scheduled work for (dev only, via `onScheduleFiberRoot`) and commits observed. Their gap hints at renders that never committed. */
  scheduled: number;
  commits: number;
  /** Time spent inspecting commits (ms), to show the library's own cost. */
  overheadMs: number;
  maxCommitMs: number;
  /** Reports skipped by the per-commit cap / time budget (see `onCommit`). */
  truncated: number;
  /** Distinct component names seen rendering since `init` (capped), and the subset of those that were tracked. */
  seen: Set<string>;
  seenTracked: Set<string>;
  /** True once a name was dropped because `seen` hit the cap: the counts are then a floor. */
  seenOverflow: boolean;
}

/** Distinct component names `noteRendered` remembers; enough to describe a page, bounded for a huge one. */
export const MAX_SEEN_COMPONENTS = 500;

const KEY = Symbol.for('rerender-lens.state');

/** State lives on globalThis so the ESM and CJS builds share one instance. */
export function getState(): LensState {
  const g = globalThis as unknown as Record<symbol, LensState | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { options: {}, enabled: false, printed: new Map(), detach: null, nextInstanceId: 1, nextCommitId: 1, warnedOnce: new Set(), scheduled: 0, commits: 0, overheadMs: 0, maxCommitMs: 0, truncated: 0, seen: new Set(), seenTracked: new Set(), seenOverflow: false };
    g[KEY] = s;
  }
  return s;
}

/**
 * Remember that a component with this display name rendered, and whether it was tracked. Two set
 * operations per rendered component per commit; the answer feeds `info().tracking`, which tells a
 * user whose panel is empty how much of their app the current options actually cover.
 */
export function noteRendered(s: LensState, name: string, tracked: boolean): void {
  if (!s.seen.has(name)) {
    if (s.seen.size >= MAX_SEEN_COMPONENTS) {
      s.seenOverflow = true;
      return;
    }
    s.seen.add(name);
  }
  if (tracked) s.seenTracked.add(name);
}

export function warnOnce(key: string, message: string): void {
  const s = getState();
  if (s.warnedOnce.has(key)) return;
  s.warnedOnce.add(key);
  (s.options.console ?? console).warn(`[rerender-lens] ${message}`);
}

/** Print (unless silent / not avoidable / muted) and forward to the notifier. */
export function dispatch(report: RenderReport, override?: Options): void {
  const s = getState();
  const options: Options = override ? { ...s.options, ...override } : s.options;
  if (!options.silent && (report.avoidable || options.logAll)) {
    const max = options.maxReportsPerComponent ?? 0;
    const n = (s.printed.get(report.component) ?? 0) + 1;
    s.printed.set(report.component, n);
    if (max <= 0 || n <= max) {
      printReport(report, options);
    } else if (n === max + 1) {
      (options.console ?? console).log(
        `[rerender-lens] <${report.component}> reached maxReportsPerComponent (${max}); further reports are not printed.`,
      );
    }
  }
  if (options.notifier) {
    try {
      options.notifier(report);
    } catch (err) {
      warnOnce('notifier', `notifier threw: ${String(err)}`);
    }
  }
}
