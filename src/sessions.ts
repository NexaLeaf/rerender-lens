/**
 * Session summaries and before/after comparison, the same shape the extension records and exports,
 * so a session file committed next to the code can be compared in CI or with the CLI. Pure.
 */
import type { RenderReport, ReportLike } from './types';
import { rankFixes } from './fixes';

export interface SessionSummary {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  total: number;
  avoidable: number;
  wasted: number;
  byComponent: Record<string, { total: number; avoidable: number; wasted: number }>;
  fixes: { key: string; label: string; count: number }[];
}

export interface CompareRow {
  component: string;
  before: number;
  after: number;
  delta: number;
}

export interface Comparison {
  before: SessionSummary;
  after: SessionSummary;
  rows: CompareRow[];
  total: { before: number; after: number; delta: number };
  avoidable: { before: number; after: number; delta: number };
  wasted: { before: number; after: number; delta: number };
  resolvedFixes: SessionSummary['fixes'];
  newFixes: SessionSummary['fixes'];
  /** Components whose avoidable re-renders went up. */
  regressions: CompareRow[];
}

export function summarizeReports(reports: readonly ReportLike[], meta: Partial<Pick<SessionSummary, 'id' | 'name' | 'startedAt' | 'endedAt'>> = {}): SessionSummary {
  const byComponent: SessionSummary['byComponent'] = {};
  let avoidable = 0;
  let wasted = 0;
  for (const r of reports) {
    const c = (byComponent[r.component] ||= { total: 0, avoidable: 0, wasted: 0 });
    c.total++;
    if (r.avoidable) {
      c.avoidable++;
      avoidable++;
      if (typeof r.selfDuration === 'number') {
        c.wasted += r.selfDuration;
        wasted += r.selfDuration;
      }
    }
  }
  return {
    id: meta.id ?? `s${Date.now().toString(36)}`,
    name: meta.name ?? 'session',
    startedAt: meta.startedAt ?? (reports[0]?.time ?? 0),
    endedAt: meta.endedAt ?? (reports[reports.length - 1]?.time ?? null),
    total: reports.length,
    avoidable,
    wasted,
    byComponent,
    fixes: rankFixes(reports).map((f) => ({ key: f.key, label: f.label, count: f.count })),
  };
}

export function compareSummaries(before: SessionSummary, after: SessionSummary): Comparison {
  const names = new Set([...Object.keys(before.byComponent), ...Object.keys(after.byComponent)]);
  const rows: CompareRow[] = [];
  for (const component of names) {
    const b = before.byComponent[component]?.avoidable || 0;
    const a = after.byComponent[component]?.avoidable || 0;
    if (b || a) rows.push({ component, before: b, after: a, delta: a - b });
  }
  rows.sort((x, y) => x.delta - y.delta || y.before - x.before || x.component.localeCompare(y.component));
  const afterKeys = new Set(after.fixes.map((f) => f.key));
  const beforeKeys = new Set(before.fixes.map((f) => f.key));
  return {
    before,
    after,
    rows,
    total: { before: before.total, after: after.total, delta: after.total - before.total },
    avoidable: { before: before.avoidable, after: after.avoidable, delta: after.avoidable - before.avoidable },
    wasted: { before: before.wasted, after: after.wasted, delta: after.wasted - before.wasted },
    resolvedFixes: before.fixes.filter((f) => !afterKeys.has(f.key)),
    newFixes: after.fixes.filter((f) => !beforeKeys.has(f.key)),
    regressions: rows.filter((r) => r.delta > 0),
  };
}

/** The panel's spelling: summarize a recorded session (`id`/`name`/`startedAt`/`endedAt` come from the session). */
export const summarizeSession = (session: Pick<SessionSummary, 'id' | 'name' | 'startedAt' | 'endedAt'>, reports: readonly ReportLike[]): SessionSummary => summarizeReports(reports, session);

/** Alias of `compareSummaries` (the panel's name). */
export const compareSessions = compareSummaries;

/** Plain-text table of a comparison (CLI, CI logs). */
export function formatComparison(c: Comparison): string {
  const w = Math.max(14, ...c.rows.map((r) => r.component.length + 2));
  const line = (label: string, b: string | number, a: string | number, d: string): string => `${label.padEnd(w)} ${String(b).padStart(8)} ${String(a).padStart(8)} ${d.padStart(8)}`;
  const delta = (n: number, suffix = ''): string => (n === 0 ? '±0' : `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`);
  const out = [line('avoidable', c.before.name.slice(0, 8), c.after.name.slice(0, 8), 'Δ'), line('all components', c.avoidable.before, c.avoidable.after, delta(c.avoidable.delta))];
  if (c.wasted.before || c.wasted.after) out.push(line('wasted ms', c.wasted.before.toFixed(1), c.wasted.after.toFixed(1), delta(Number(c.wasted.delta.toFixed(1)))));
  for (const r of c.rows) out.push(line(`<${r.component}>`, r.before, r.after, delta(r.delta)));
  if (c.resolvedFixes.length) out.push('', 'no longer needed:', ...c.resolvedFixes.map((f) => `  - ${f.label}`));
  if (c.newFixes.length) out.push('', 'new:', ...c.newFixes.map((f) => `  - ${f.label}`));
  return out.join('\n');
}

/** Reports from a panel export (`{ rerenderLens: true, reports }`), a bare array, or a session summary file. */
export function parseExport(data: unknown): { reports: RenderReport[]; sessions: SessionSummary[]; summary: SessionSummary | null } {
  if (Array.isArray(data)) return { reports: data as RenderReport[], sessions: [], summary: null };
  if (data && typeof data === 'object') {
    const d = data as { reports?: unknown; sessions?: unknown; byComponent?: unknown };
    if (Array.isArray(d.reports)) return { reports: d.reports as RenderReport[], sessions: Array.isArray(d.sessions) ? (d.sessions as SessionSummary[]) : [], summary: null };
    if (d.byComponent && typeof d.byComponent === 'object') return { reports: [], sessions: [], summary: data as SessionSummary };
  }
  throw new Error('not a rerender-lens export or session summary');
}
