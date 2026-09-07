import type { Notifier, RenderReport } from './types';

export interface Collector {
  /** Every report received, in order. */
  readonly reports: RenderReport[];
  /** Reports where `avoidable` is true. */
  readonly avoidable: RenderReport[];
  /** Pass this to `init({ notifier })`. */
  readonly notifier: Notifier;
  clear(): void;
  /** Throws with a readable message if any avoidable re-render was recorded. */
  assertNoAvoidable(): void;
}

/** Collect reports in memory. Meant for tests. */
export function createCollector(): Collector {
  const reports: RenderReport[] = [];
  return {
    reports,
    get avoidable() {
      return reports.filter((r) => r.avoidable);
    },
    notifier: (r) => {
      reports.push(r);
    },
    clear: () => {
      reports.length = 0;
    },
    assertNoAvoidable() {
      const bad = reports.filter((r) => r.avoidable);
      if (bad.length === 0) return;
      const lines = bad.map((r) => `  <${r.component}> render #${r.renderCount}:\n${r.reasons.map((x) => `    - ${x}`).join('\n')}`);
      throw new Error(`${bad.length} avoidable re-render${bad.length === 1 ? '' : 's'} detected:\n${lines.join('\n')}`);
    },
  };
}

export function combineNotifiers(...notifiers: Array<Notifier | undefined | null | false>): Notifier {
  const list = notifiers.filter((n): n is Notifier => typeof n === 'function');
  return (report) => {
    for (const n of list) n(report);
  };
}
