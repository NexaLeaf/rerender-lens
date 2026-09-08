/**
 * Commit and root-cause analysis: which component's own change started each render cascade, which
 * contexts fanned out to how many consumers, and a nested view of one commit. Reports carry a
 * `commitId` (every report from one React commit shares it) and `parent` links (the nearest ancestor
 * that rendered in the same commit); following those links inside a commit finds the root cause.
 * One implementation for the library (the CLI, the Vitest reporter, `formatFixes`) and the DevTools
 * panel, which adds its own per-commit memoization on top. Typed over `ReportLike`. Pure.
 */
import { AVOIDABLE_KINDS } from './diff';
import type { RenderReport, ReportLike } from './types';

export interface RootCause {
  name: string;
  trigger: string;
  /** Avoidable re-renders in the commit that trace back to this component. */
  count: number;
  components: Map<string, number>;
}

export interface ContextStat {
  name: string;
  consumers: number;
  avoidable: number;
  components: Map<string, number>;
  commits: Set<number>;
  /** Components rendering the Provider (usually one). */
  providers: Map<string, number>;
  /** Keys that changed in object values, and the largest key count seen. */
  changedKeys: Set<string>;
  totalKeys: number;
}

export interface CommitAnalysis<R extends ReportLike = RenderReport> {
  /** The commit id (`commitId` of its reports), 0 when the reports carry none. */
  id: number;
  total: number;
  avoidable: number;
  /** Sum of `selfDuration` over the avoidable reports, in ms. */
  wasted: number;
  roots: RootCause[];
  /** Root cause name of every avoidable report (what `roots` was aggregated from). */
  rootByReport: Map<R, string>;
  contexts: ContextStat[];
  reports: R[];
}

export interface CascadeNode<R extends ReportLike = RenderReport> {
  name: string;
  children: Map<string, CascadeNode<R>>;
  report: R | null;
  count?: number;
  avoidable?: number;
}

export interface RootSummary<R extends ReportLike = RenderReport, A extends CommitAnalysis<R> = CommitAnalysis<R>> {
  name: string;
  trigger: string;
  /** Newest first. */
  commits: { key: number; analysis: A; count: number; components: Map<string, number> }[];
  /** Avoidable re-renders across every commit. */
  total: number;
  components: Map<string, number>;
  /** The avoidable reports that trace back to this root cause. */
  affected: R[];
}

/** One root cause across a whole run: how many commits it started and what those cost. */
export interface RankedRootCause {
  name: string;
  trigger: string;
  commits: number;
  /** Avoidable re-renders it caused. */
  count: number;
  components: Map<string, number>;
}

const isAncestorReport = (anc: ReportLike, r: ReportLike): boolean =>
  anc.path.length < r.path.length && r.path[anc.path.length] === anc.component && anc.path.every((p, i) => r.path[i] === p);

const bump = (m: Map<string, number>, key: string, n = 1): void => void m.set(key, (m.get(key) || 0) + n);

/** One commit's reports grouped by component name, so a parent lookup is O(same-named reports) instead of O(commit). */
export function indexByComponent<R extends ReportLike>(reports: readonly R[]): Map<string, R[]> {
  const index = new Map<string, R[]>();
  for (const r of reports) {
    const list = index.get(r.component);
    if (list) list.push(r);
    else index.set(r.component, [r]);
  }
  return index;
}

/**
 * Walk `parent` links inside one commit up to the component whose own change started the cascade.
 * Null when `r` started it itself; `report` is null when the root is an ancestor that is not in the
 * commit (untracked), in which case `name`/`trigger` come from the last `parent` link.
 */
export function rootCauseOf<R extends ReportLike>(r: R, commitReports: readonly R[], index: Map<string, R[]> = indexByComponent(commitReports)): { name: string; trigger: string; report: R | null } | null {
  let cur = r;
  const seen = new Set<R>([r]);
  while (cur.trigger === 'parent' && cur.parent) {
    const parent = cur.parent;
    const candidates = index.get(parent.name);
    const p = candidates && candidates.find((x) => isAncestorReport(x, cur));
    if (!p || seen.has(p)) return { name: parent.name, trigger: parent.trigger, report: null };
    seen.add(p);
    cur = p;
  }
  return cur === r ? null : { name: cur.component, trigger: cur.trigger, report: cur };
}

/** Root causes of one commit's avoidable reports, most re-renders first. */
function rootCausesOf<R extends ReportLike>(reports: readonly R[]): Pick<CommitAnalysis<R>, 'roots' | 'rootByReport' | 'avoidable' | 'wasted'> {
  const roots = new Map<string, RootCause>();
  const rootByReport = new Map<R, string>();
  const index = indexByComponent(reports);
  let avoidable = 0;
  let wasted = 0;
  for (const r of reports) {
    if (!r.avoidable) continue;
    avoidable++;
    if (typeof r.selfDuration === 'number') wasted += r.selfDuration;
    const root = rootCauseOf(r, reports, index);
    const name = root ? root.name : (r.parent && r.parent.name) || '(unknown)';
    const trigger = root ? root.trigger : (r.parent && r.parent.trigger) || 'parent';
    rootByReport.set(r, name);
    let agg = roots.get(name);
    if (!agg) {
      agg = { name, trigger, count: 0, components: new Map() };
      roots.set(name, agg);
    }
    agg.count++;
    bump(agg.components, r.component);
  }
  return { roots: [...roots.values()].sort((a, b) => b.count - a.count), rootByReport, avoidable, wasted };
}

/** Analyze the reports of one commit: what started the cascade, which contexts changed, what it cost. */
export function analyzeCommit<R extends ReportLike>(reports: R[]): CommitAnalysis<R> {
  const first = reports[0];
  return {
    id: first && typeof first.commitId === 'number' ? first.commitId : 0,
    total: reports.length,
    ...rootCausesOf(reports),
    contexts: contextAttribution(reports),
    reports,
  };
}

/** Which contexts changed and how many consumers re-rendered because of them. */
export function contextAttribution(reports: readonly ReportLike[]): ContextStat[] {
  const byCtx = new Map<string, ContextStat>();
  for (const r of reports) {
    for (const c of r.hookChanges || []) {
      if (c.hook !== 'useContext' && !/^useContext/.test(c.path)) continue;
      const m = /useContext\((.*)\)/.exec(c.path);
      const name = m && m[1] ? m[1] : c.path;
      let agg = byCtx.get(name);
      if (!agg) {
        agg = { name, consumers: 0, avoidable: 0, components: new Map(), commits: new Set(), providers: new Map(), changedKeys: new Set(), totalKeys: 0 };
        byCtx.set(name, agg);
      }
      agg.consumers++;
      if (AVOIDABLE_KINDS.has(c.kind)) agg.avoidable++;
      bump(agg.components, r.component);
      agg.commits.add(typeof r.commitId === 'number' ? r.commitId : 0);
      if (c.provider && c.provider.component) bump(agg.providers, c.provider.component);
      if (c.changedKeys) for (const k of c.changedKeys) agg.changedKeys.add(k);
      if (typeof c.totalKeys === 'number') agg.totalKeys = Math.max(agg.totalKeys, c.totalKeys);
    }
  }
  return [...byCtx.values()].sort((a, b) => b.consumers - a.consumers);
}

/** Nested cascade for one commit: every report placed under its ancestors (untracked ancestors appear as plain names). */
export function cascadeTree<R extends ReportLike>(reports: readonly R[]): CascadeNode<R> {
  const root: CascadeNode<R> = { name: '', children: new Map(), report: null };
  for (const r of reports) {
    let node = root;
    for (const seg of r.path.concat([r.component])) {
      let next = node.children.get(seg);
      if (!next) {
        next = { name: seg, children: new Map(), report: null };
        node.children.set(seg, next);
      }
      node = next;
    }
    if (!node.report || r.avoidable) node.report = r;
    node.count = (node.count || 0) + 1;
    if (r.avoidable) node.avoidable = (node.avoidable || 0) + 1;
  }
  return root;
}

/**
 * Every commit a component started (as the root cause), across the whole session.
 * `analyze` lets a caller (the panel) pass its per-commit memoized analysis.
 */
export function rootCauseSummary<R extends ReportLike>(name: string, commits: Iterable<[number, R[]]>): RootSummary<R>;
export function rootCauseSummary<R extends ReportLike, A extends CommitAnalysis<R>>(name: string, commits: Iterable<[number, R[]]>, analyze: (key: number, reports: R[]) => A): RootSummary<R, A>;
export function rootCauseSummary<R extends ReportLike, A extends CommitAnalysis<R>>(name: string, commits: Iterable<[number, R[]]>, analyze?: (key: number, reports: R[]) => A): RootSummary<R, A> {
  const analyzeFn = analyze || ((_: number, reports: R[]): A => analyzeCommit(reports) as A);
  const out: RootSummary<R, A> = { name, trigger: 'parent', commits: [], total: 0, components: new Map(), affected: [] };
  for (const [key, reports] of commits) {
    const analysis = analyzeFn(key, reports);
    const root = analysis.roots.find((x) => x.name === name);
    if (!root) continue;
    out.trigger = root.trigger;
    out.commits.push({ key, analysis, count: root.count, components: root.components });
    out.total += root.count;
    for (const [c, n] of root.components) bump(out.components, c, n);
    for (const r of reports) if (r.avoidable && analysis.rootByReport.get(r) === name) out.affected.push(r);
  }
  out.commits.reverse();
  return out;
}

/** Reports grouped by `commitId` in first-seen order. Reports without one (`useWhyRerender`, protocol 1) are left out. */
export function groupByCommit<R extends ReportLike>(reports: readonly R[]): Map<number, R[]> {
  const out = new Map<number, R[]>();
  for (const r of reports) {
    if (typeof r.commitId !== 'number' || r.commitId <= 0) continue;
    const list = out.get(r.commitId);
    if (list) list.push(r);
    else out.set(r.commitId, [r]);
  }
  return out;
}

/** Root causes across every commit in `reports`, most avoidable re-renders caused first. */
export function rankRootCauses(reports: readonly ReportLike[]): RankedRootCause[] {
  const byName = new Map<string, RankedRootCause>();
  for (const commit of groupByCommit(reports).values()) {
    for (const root of rootCausesOf(commit).roots) {
      let agg = byName.get(root.name);
      if (!agg) {
        agg = { name: root.name, trigger: root.trigger, commits: 0, count: 0, components: new Map() };
        byName.set(root.name, agg);
      }
      agg.commits++;
      agg.count += root.count;
      for (const [c, n] of root.components) bump(agg.components, c, n);
    }
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || b.commits - a.commits || a.name.localeCompare(b.name));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Multi-line root-cause table for a test failure or a CI log, one line per root cause:
 * `<Page> (state) started 3 commits, 12 avoidable re-renders  (<Row> x10, <Toolbar> x2)`.
 * Empty when nothing is avoidable or the reports carry no `commitId`.
 */
export function formatRootCauses(reports: readonly ReportLike[], limit = 5): string {
  const ranked = rankRootCauses(reports);
  const lines = ranked
    .slice(0, limit)
    .map((root, i) => `${String(i + 1).padStart(2)}. <${root.name}> (${root.trigger}) started ${plural(root.commits, 'commit')}, ${plural(root.count, 'avoidable re-render')}  (${[...root.components].map(([c, n]) => `<${c}>${n > 1 ? ' x' + n : ''}`).join(', ')})`);
  if (ranked.length > limit) lines.push(`    … ${ranked.length - limit} more`);
  return lines.join('\n');
}
