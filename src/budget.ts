/**
 * Re-render budgets for CI: a JSON baseline of allowed avoidable re-renders per component, checked
 * against a collector's reports (like a bundle-size budget). Pure; reading and writing the file is
 * up to the test runner (`fs`), so this works in Node and in the browser.
 */
import type { RenderReport } from './types';
import { formatFixes } from './fixes';

/** `{ "*": 0, "ProductRow": 3 }`: max avoidable re-renders per component; `*` is the default. */
export type Budget = Record<string, number>;

export interface BudgetViolation {
  component: string;
  avoidable: number;
  allowed: number;
}

export interface BudgetResult {
  ok: boolean;
  violations: BudgetViolation[];
  /** Components with headroom left, so budgets can be tightened. */
  slack: { component: string; avoidable: number; allowed: number }[];
  counts: Record<string, number>;
}

export function avoidableCounts(reports: RenderReport[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of reports) if (r.avoidable) counts[r.component] = (counts[r.component] || 0) + 1;
  return counts;
}

export function checkBudget(reports: RenderReport[], budget: Budget | number): BudgetResult {
  const b: Budget = typeof budget === 'number' ? { '*': budget } : budget;
  const fallback = typeof b['*'] === 'number' ? b['*'] : 0;
  const counts = avoidableCounts(reports);
  const violations: BudgetViolation[] = [];
  const slack: BudgetResult['slack'] = [];
  const names = new Set([...Object.keys(counts), ...Object.keys(b).filter((k) => k !== '*')]);
  for (const component of names) {
    const allowed = typeof b[component] === 'number' ? b[component]! : fallback;
    const avoidable = counts[component] || 0;
    if (avoidable > allowed) violations.push({ component, avoidable, allowed });
    else if (avoidable < allowed) slack.push({ component, avoidable, allowed });
  }
  violations.sort((x, y) => y.avoidable - y.allowed - (x.avoidable - x.allowed));
  return { ok: violations.length === 0, violations, slack, counts };
}

/** A budget that exactly matches the current counts (the baseline to commit). */
export function toBudget(reports: RenderReport[]): Budget {
  return { '*': 0, ...avoidableCounts(reports) };
}

/** Throws with the violations and the ranked fixes; use it from a test. */
export function assertWithinBudget(reports: RenderReport[], budget: Budget | number): BudgetResult {
  const result = checkBudget(reports, budget);
  if (result.ok) return result;
  const lines = result.violations.map((v) => `  <${v.component}>: ${v.avoidable} avoidable re-render${v.avoidable === 1 ? '' : 's'} (budget ${v.allowed})`);
  throw new Error(`Re-render budget exceeded:\n${lines.join('\n')}\n\nFixes, most impact first:\n${formatFixes(reports)}`);
}
