/**
 * Concrete fixes derived from reports, ranked by how many avoidable re-renders each one removes.
 * One implementation for the library (tests, CI budgets, the CLI, typed on `RenderReport`) and the
 * DevTools panel (serialized reports): everything here reads only `ReportLike`. Pure.
 */
import type { ChangeLike, RenderReport, ReportLike } from './types';
import { AVOIDABLE_KINDS } from './diff';
import { formatRootCauses } from './causes';

export { AVOIDABLE_KINDS };

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
  /** Code sketch of the fix, `// <owner>` on the first line. */
  snippet: string;
}

export interface RankedFix<R extends ReportLike = RenderReport> extends Fix {
  key: string;
  /** Avoidable re-renders this fix removes. */
  count: number;
  components: Record<string, number>;
  /** The first (at most 50) reports the fix applies to. */
  reports: R[];
}

const MAX_FIX_REPORTS = 50;
const rootOf = (path: string): string => path.split(/[.[]/)[0] || path;
const identifier = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : 'value');

/** `JSON.stringify` cut to `max` characters, for snippets and markdown; never throws. */
export function shortValue(v: unknown, max = 60): string {
  let s: string | undefined;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

/** The concrete fixes one report suggests, each attributed to the component (file) that must change. */
export function fixesFor(r: ReportLike): Fix[] {
  const out: Fix[] = [];
  const ownerName = r.owner || (r.parent && r.parent.name) || null;
  const propChanges = r.propChanges || [];
  const changes: ChangeLike[] = [...propChanges, ...(r.stateChanges || []), ...(r.hookChanges || [])];
  // Not memoized: props alone will never stop the re-render, so React.memo comes first (in addition to
  // any prop fixes below). Reports from protocol-1 libraries have no `memoized`; assume memoized then.
  if (r.avoidable && (changes.length === 0 || r.memoized === false)) {
    const identical = changes.length === 0;
    out.push({
      kind: 'memo',
      owner: r.component,
      target: r.component,
      prop: null,
      label: `Wrap <${r.component}> in React.memo`,
      detail: identical
        ? `<${r.component}> re-rendered with identical props because <${(r.parent && r.parent.name) || 'its parent'}> re-rendered.`
        : `<${r.component}> is not memoized: fixing its props alone will not stop the re-render.`,
      snippet: `// ${r.component}\nimport { memo } from 'react';\n\nexport const ${r.component} = memo(function ${r.component}(props) {\n  // ...\n});\n// class components: extend PureComponent instead`,
    });
  }
  for (const c of propChanges) {
    if (!AVOIDABLE_KINDS.has(c.kind)) continue;
    const owner = ownerName || '?';
    const root = rootOf(c.path);
    const id = identifier(root);
    if (root === 'children' && (c.kind === 'element' || c.kind === 'deep-equal')) {
      out.push({
        kind: 'children',
        owner,
        target: r.component,
        prop: 'children',
        label: `memoize children of <${r.component}> in <${owner}>`,
        detail: `<${owner}> re-creates the children of <${r.component}> on every render; they have the same types and props each time.`,
        snippet:
          `// ${owner}\nimport { useMemo } from 'react';\n\nconst children = useMemo(() => (\n  <>{/* the same elements */}</>\n), [/* deps */]);\n\n<${r.component}>{children}</${r.component}>\n\n` +
          `// static children: hoist them to module scope\nconst STATIC = <em>hi</em>;`,
      });
    } else if (c.kind === 'function') {
      out.push({
        kind: 'useCallback',
        owner,
        target: r.component,
        prop: root,
        label: `useCallback(${root}) in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new function on every render of <${owner}>.`,
        snippet: `// ${owner}\nimport { useCallback } from 'react';\n\nconst ${id} = useCallback((/* args */) => {\n  // ...\n}, [/* deps */]);\n\n<${r.component} ${root}={${id}} />`,
      });
    } else if (c.kind === 'element') {
      out.push({
        kind: 'useMemoElement',
        owner,
        target: r.component,
        prop: root,
        label: `memoize element prop ${root} in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new element with the same type and props on every render of <${owner}>.`,
        snippet: `// ${owner}\nimport { useMemo } from 'react';\n\nconst ${id} = useMemo(() => ${shortValue(c.next, 40)}, [/* deps */]);\n// or pass it as children from a component that does not re-render`,
      });
    } else {
      const isArray = Array.isArray(c.next);
      out.push({
        kind: 'useMemo',
        owner,
        target: r.component,
        prop: root,
        label: `useMemo(${root}) in <${owner}>`,
        detail: `prop "${c.path}" of <${r.component}> is a new ${isArray ? 'array' : 'object'} with the same contents on every render of <${owner}>.`,
        snippet:
          `// ${owner}\nimport { useMemo } from 'react';\n\nconst ${id} = useMemo(() => (${shortValue(c.next, 80)}), [/* deps */]);\n\n` +
          `// or, when it never changes, hoist it to module scope:\nconst ${id.toUpperCase()} = ${shortValue(c.next, 80)};`,
      });
    }
  }
  for (const c of [...(r.stateChanges || []), ...(r.hookChanges || [])]) {
    const isContext = c.hook === 'useContext' || /^useContext/.test(c.path);
    const ctxName = isContext ? (/useContext\((.*)\)/.exec(c.path) || [])[1] || 'Context' : '';
    const providerOwner = isContext && c.provider && c.provider.component ? c.provider.component : null;
    // A genuine change of a few keys in an object context still re-renders every consumer.
    if (isContext && c.kind === 'different' && c.changedKeys && typeof c.totalKeys === 'number' && c.changedKeys.length > 0 && c.changedKeys.length < c.totalKeys) {
      out.push({
        kind: 'splitContext',
        owner: providerOwner || `${ctxName}.Provider`,
        target: r.component,
        prop: ctxName,
        label: `split ${ctxName}${providerOwner ? ` in <${providerOwner}>` : ''}: only ${c.changedKeys.join(', ')} changed`,
        detail: `${c.changedKeys.map((k) => `"${k}"`).join(', ')} of ${c.totalKeys} keys changed in ${ctxName}, yet every consumer (like <${r.component}>) re-rendered. Consumers that read the other keys re-render for nothing.`,
        snippet:
          `// ${providerOwner || 'Provider'}\n// one context per independently-changing slice\nconst ${identifier(ctxName)}Static = createContext(...);\nconst ${identifier(ctxName)}${c.changedKeys.map((k) => k[0]!.toUpperCase() + k.slice(1)).join('')} = createContext(...);\n\n` +
          `// or keep one context and let consumers select a slice:\nconst ${c.changedKeys[0]} = useContextSelector(${ctxName}, (v) => v.${c.changedKeys[0]});`,
      });
      continue;
    }
    if (!AVOIDABLE_KINDS.has(c.kind)) continue;
    if (isContext) {
      out.push({
        kind: 'contextValue',
        owner: providerOwner || `${ctxName}.Provider`,
        target: r.component,
        prop: ctxName,
        label: `memoize the ${ctxName} provider value${providerOwner ? ` in <${providerOwner}>` : ''}`,
        detail: `<${r.component}> re-rendered because ${ctxName} produced a new value that is deep-equal to the previous one${providerOwner ? ` (Provider rendered by <${providerOwner}>)` : ''}.`,
        snippet: `// ${providerOwner || `where <${ctxName}.Provider> is rendered`}\nconst value = useMemo(() => ({ /* ... */ }), [/* deps */]);\n<${ctxName}.Provider value={value}>`,
      });
    } else if (c.hook === 'useSyncExternalStore') {
      const chain = c.custom || [];
      const redux = chain.some((n) => /^use(App)?Selector$/.test(n));
      const zustand = !redux && chain.some((n) => /^use[A-Z]\w*Store$/.test(n) || n === 'useStore' || n === 'useBoundStore');
      const via = chain.length ? ` via ${chain.join(' › ')}` : '';
      out.push({
        kind: 'storeSnapshot',
        owner: r.component,
        target: r.component,
        prop: c.path,
        label: redux ? `memoize the selector in <${r.component}>` : zustand ? `useShallow in <${r.component}>` : `stable getSnapshot in <${r.component}>`,
        detail: redux
          ? `the selector${via} returns a new object on every call, so the component re-renders on every store change.`
          : zustand
            ? `the store selector${via} returns a new object on every call, so the component re-renders on every store change.`
            : `${c.path}${via} returned a new reference with the same contents; getSnapshot must return a cached value.`,
        snippet: redux
          ? `// ${r.component}\nimport { shallowEqual } from 'react-redux';\nconst slice = useSelector(selectSlice, shallowEqual);\n// or memoize: const selectSlice = createSelector([selectA, selectB], (a, b) => ({ a, b }));`
          : zustand
            ? `// ${r.component}\nimport { useShallow } from 'zustand/react/shallow';\nconst { a, b } = useStore(useShallow((s) => ({ a: s.a, b: s.b })));\n// or select a primitive: const a = useStore((s) => s.a);`
            : `// ${r.component}\n// getSnapshot must return the same reference while the data is unchanged\nconst snapshot = useSyncExternalStore(subscribe, store.getSnapshot /* cached */);`,
      });
    } else {
      out.push({
        kind: 'bailout',
        owner: r.component,
        target: r.component,
        prop: c.path,
        label: `bail out before setting ${c.path} in <${r.component}>`,
        detail: `${c.path} was set to a value deep-equal to the current one (new reference).`,
        snippet: `// ${r.component}\nsetState((prev) => (deepEqual(prev, next) ? prev : next));`,
      });
    }
  }
  return out;
}

export const fixKey = (f: Fix): string => `${f.kind}|${f.owner}|${f.prop || f.target}`;

/** Every fix across `reports`, most avoidable re-renders removed first. */
export function rankFixes<R extends ReportLike>(reports: readonly R[]): RankedFix<R>[] {
  const byKey = new Map<string, RankedFix<R>>();
  for (const r of reports) {
    if (!r.avoidable) continue;
    for (const f of fixesFor(r)) {
      const key = fixKey(f);
      let agg = byKey.get(key);
      if (!agg) {
        agg = { ...f, key, count: 0, components: {}, reports: [] };
        byKey.set(key, agg);
      }
      agg.count++;
      agg.components[r.component] = (agg.components[r.component] || 0) + 1;
      if (agg.reports.length < MAX_FIX_REPORTS) agg.reports.push(r);
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Multi-line text for a test failure or a CI log: the ranked fixes, then (when the reports carry
 * `commitId`) a "Root causes" section naming the components whose own changes started the cascades.
 */
export function formatFixes(reports: readonly ReportLike[], limit = 10): string {
  const ranked = rankFixes(reports);
  if (!ranked.length) return 'No avoidable re-renders.';
  const lines = ranked.slice(0, limit).map((f, i) => `${String(i + 1).padStart(2)}. ${f.label}  (removes ${f.count}: ${Object.entries(f.components).map(([c, n]) => `<${c}>${n > 1 ? ' x' + n : ''}`).join(', ')})`);
  if (ranked.length > limit) lines.push(`    … ${ranked.length - limit} more`);
  const roots = formatRootCauses(reports, 5);
  if (roots) lines.push('', 'Root causes:', roots);
  return lines.join('\n');
}
