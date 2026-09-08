/**
 * Concrete fixes derived from reports, ranked by how many avoidable re-renders each one removes.
 * The same logic drives the extension's Fixes view; here it is typed on `RenderReport` for tests,
 * CI budgets and the CLI. Pure.
 */
import type { Change, HookChange, RenderReport } from './types';
import { storeAdvice } from './report';

export type FixKind = 'memo' | 'useCallback' | 'useMemo' | 'useMemoElement' | 'children' | 'contextValue' | 'splitContext' | 'storeSnapshot' | 'bailout';

export interface Fix {
  kind: FixKind;
  /** Where the change goes (the component that must be edited, or `<Ctx>.Provider`). */
  owner: string;
  /** The component whose re-render this removes. */
  target: string;
  prop: string | null;
  label: string;
  detail: string;
}

export interface RankedFix extends Fix {
  key: string;
  /** Avoidable re-renders this fix removes. */
  count: number;
  components: Record<string, number>;
}

const AVOIDABLE = new Set<string>(['deep-equal', 'function', 'element']);
const rootOf = (path: string): string => path.split(/[.[]/)[0] || path;

export function fixesFor(r: RenderReport): Fix[] {
  const out: Fix[] = [];
  const owner = r.owner || (r.parent && r.parent.name) || '?';
  const changes: Change[] = [...r.propChanges, ...r.stateChanges, ...r.hookChanges];
  if (r.avoidable && (changes.length === 0 || r.memoized === false)) {
    out.push({
      kind: 'memo',
      owner: r.component,
      target: r.component,
      prop: null,
      label: `Wrap <${r.component}> in React.memo`,
      detail: changes.length === 0 ? `<${r.component}> re-rendered with identical props because <${(r.parent && r.parent.name) || 'its parent'}> re-rendered.` : `<${r.component}> is not memoized: fixing its props alone will not stop the re-render.`,
    });
  }
  for (const c of r.propChanges) {
    if (!AVOIDABLE.has(c.kind)) continue;
    const root = rootOf(c.path);
    if (root === 'children' && (c.kind === 'element' || c.kind === 'deep-equal')) {
      out.push({ kind: 'children', owner, target: r.component, prop: 'children', label: `memoize children of <${r.component}> in <${owner}>`, detail: `<${owner}> re-creates the children of <${r.component}> on every render.` });
    } else if (c.kind === 'function') {
      out.push({ kind: 'useCallback', owner, target: r.component, prop: root, label: `useCallback(${root}) in <${owner}>`, detail: `prop "${c.path}" of <${r.component}> is a new function on every render of <${owner}>.` });
    } else if (c.kind === 'element') {
      out.push({ kind: 'useMemoElement', owner, target: r.component, prop: root, label: `memoize element prop ${root} in <${owner}>`, detail: `prop "${c.path}" of <${r.component}> is a new element with the same type and props on every render of <${owner}>.` });
    } else {
      out.push({ kind: 'useMemo', owner, target: r.component, prop: root, label: `useMemo(${root}) in <${owner}>`, detail: `prop "${c.path}" of <${r.component}> is a new ${Array.isArray(c.next) ? 'array' : 'object'} with the same contents on every render of <${owner}>.` });
    }
  }
  for (const c of [...r.stateChanges, ...r.hookChanges] as (Change & Partial<HookChange>)[]) {
    const isContext = c.hook === 'useContext';
    const ctxName = isContext ? (/useContext\((.*)\)/.exec(c.path) || [])[1] || 'Context' : '';
    const providerOwner = isContext && c.provider && c.provider.component ? c.provider.component : null;
    if (isContext && c.kind === 'different' && c.changedKeys && typeof c.totalKeys === 'number' && c.changedKeys.length > 0 && c.changedKeys.length < c.totalKeys) {
      out.push({
        kind: 'splitContext',
        owner: providerOwner || `${ctxName}.Provider`,
        target: r.component,
        prop: ctxName,
        label: `split ${ctxName}${providerOwner ? ` in <${providerOwner}>` : ''}: only ${c.changedKeys.join(', ')} changed`,
        detail: `${c.changedKeys.length} of ${c.totalKeys} keys changed in ${ctxName}, yet every consumer re-rendered.`,
      });
      continue;
    }
    if (!AVOIDABLE.has(c.kind)) continue;
    if (isContext) {
      out.push({ kind: 'contextValue', owner: providerOwner || `${ctxName}.Provider`, target: r.component, prop: ctxName, label: `memoize the ${ctxName} provider value${providerOwner ? ` in <${providerOwner}>` : ''}`, detail: `${ctxName} produced a new value that is deep-equal to the previous one.` });
    } else if (c.hook === 'useSyncExternalStore') {
      const chain = c.custom || [];
      const redux = chain.some((n) => /^use(App)?Selector$/.test(n));
      const zustand = !redux && chain.some((n) => /^use[A-Z]\w*Store$/.test(n) || n === 'useStore' || n === 'useBoundStore');
      out.push({ kind: 'storeSnapshot', owner: r.component, target: r.component, prop: c.path, label: redux ? `memoize the selector in <${r.component}>` : zustand ? `useShallow in <${r.component}>` : `stable getSnapshot in <${r.component}>`, detail: storeAdvice(c.custom) });
    } else {
      out.push({ kind: 'bailout', owner: r.component, target: r.component, prop: c.path, label: `bail out before setting ${c.path} in <${r.component}>`, detail: `${c.path} was set to a value deep-equal to the current one (new reference).` });
    }
  }
  return out;
}

export const fixKey = (f: Fix): string => `${f.kind}|${f.owner}|${f.prop || f.target}`;

/** Every fix across `reports`, most re-renders removed first. */
export function rankFixes(reports: RenderReport[]): RankedFix[] {
  const byKey = new Map<string, RankedFix>();
  for (const r of reports) {
    if (!r.avoidable) continue;
    for (const f of fixesFor(r)) {
      const key = fixKey(f);
      let agg = byKey.get(key);
      if (!agg) {
        agg = { ...f, key, count: 0, components: {} };
        byKey.set(key, agg);
      }
      agg.count++;
      agg.components[r.component] = (agg.components[r.component] || 0) + 1;
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Multi-line text for a test failure or a CI log. */
export function formatFixes(reports: RenderReport[], limit = 10): string {
  const ranked = rankFixes(reports);
  if (!ranked.length) return 'No avoidable re-renders.';
  const lines = ranked.slice(0, limit).map((f, i) => `${String(i + 1).padStart(2)}. ${f.label}  (removes ${f.count}: ${Object.entries(f.components).map(([c, n]) => `<${c}>${n > 1 ? ' x' + n : ''}`).join(', ')})`);
  if (ranked.length > limit) lines.push(`    … ${ranked.length - limit} more`);
  return lines.join('\n');
}
