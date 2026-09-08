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
}

const KEY = Symbol.for('rerender-lens.state');

/** State lives on globalThis so the ESM and CJS builds share one instance. */
export function getState(): LensState {
  const g = globalThis as unknown as Record<symbol, LensState | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { options: {}, enabled: false, printed: new Map(), detach: null, nextInstanceId: 1, nextCommitId: 1, warnedOnce: new Set(), scheduled: 0, commits: 0 };
    g[KEY] = s;
  }
  return s;
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
      (options.console ?? console).warn('[rerender-lens] notifier threw', err);
    }
  }
}
