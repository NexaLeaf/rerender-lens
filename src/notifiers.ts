import type { Notifier, RenderReport } from './types';
import { formatFixes, rankFixes, type RankedFix } from './fixes';
import { summarizeReports, type SessionSummary } from './sessions';
import { assertWithinBudget, type Budget, type BudgetResult } from './budget';

export interface Collector {
  /** Ranked fixes for everything collected so far (most re-renders removed first). */
  fixes(): RankedFix[];
  /** A session summary of everything collected, comparable with `compareSummaries` or the CLI. */
  summary(name?: string): SessionSummary;
  /** Throws when a component exceeds its allowed avoidable re-renders (`{ "*": 0, "Row": 2 }` or a number). */
  assertWithinBudget(budget: Budget | number): BudgetResult;
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
      throw new Error(`${bad.length} avoidable re-render${bad.length === 1 ? '' : 's'} detected:\n${lines.join('\n')}\n\nFixes, most impact first:\n${formatFixes(reports)}`);
    },
    fixes: () => rankFixes(reports),
    summary: (name?: string) => summarizeReports(reports, name ? { name } : {}),
    assertWithinBudget: (budget) => assertWithinBudget(reports, budget),
  };
}

export function combineNotifiers(...notifiers: Array<Notifier | undefined | null | false>): Notifier {
  const list = notifiers.filter((n): n is Notifier => typeof n === 'function');
  return (report) => {
    for (const n of list) n(report);
  };
}
