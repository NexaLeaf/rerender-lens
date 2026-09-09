/* Built from extension/src/panel.ts by `npm run build`; do not edit by hand. */
"use strict";
(() => {
  // src/diff.ts
  var REACT_ELEMENT = /* @__PURE__ */ Symbol.for("react.element");
  var REACT_TRANSITIONAL_ELEMENT = /* @__PURE__ */ Symbol.for("react.transitional.element");
  function isReactElement(v) {
    if (typeof v !== "object" || v === null) return false;
    const t = v.$$typeof;
    return t === REACT_ELEMENT || t === REACT_TRANSITIONAL_ELEMENT;
  }
  function isPlainObject(v) {
    if (typeof v !== "object" || v === null) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }
  function remember(seen, a, b) {
    let set = seen.get(a);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      seen.set(a, set);
    }
    if (set.has(b)) return true;
    set.add(b);
    return false;
  }
  var scope = null;
  var DEFAULT_DIFF_BUDGET = 5e4;
  function beginDiffScope(budget = 2e5) {
    const previous = scope;
    scope = { cache: /* @__PURE__ */ new WeakMap(), remaining: budget, exhausted: false };
    return () => {
      scope = previous;
    };
  }
  function deepEqual(a, b, seen = /* @__PURE__ */ new Map()) {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object" || a === null || b === null) return false;
    if (!scope) {
      const end = beginDiffScope(DEFAULT_DIFF_BUDGET);
      try {
        return deepEqual(a, b, seen);
      } finally {
        end();
      }
    }
    const sc = scope;
    const objA = a;
    const objB = b;
    const hit = sc.cache.get(objA)?.get(objB);
    if (hit !== void 0) return hit;
    if (--sc.remaining < 0) {
      sc.exhausted = true;
      return false;
    }
    const result = deepEqualObjects(objA, objB, seen);
    let m = sc.cache.get(objA);
    if (!m) {
      m = /* @__PURE__ */ new WeakMap();
      sc.cache.set(objA, m);
    }
    m.set(objB, result);
    return result;
  }
  function deepEqualObjects(a, b, seen) {
    const objA = a;
    const objB = b;
    if (remember(seen, objA, objB)) return true;
    if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();
    if (a instanceof RegExp) return b instanceof RegExp && a.source === b.source && a.flags === b.flags;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], seen)) return false;
      return true;
    }
    if (Array.isArray(b)) return false;
    if (ArrayBuffer.isView(a)) {
      if (!ArrayBuffer.isView(b) || a.constructor !== b.constructor) return false;
      const ta = a;
      const tb = b;
      if (ta.length !== tb.length) return false;
      for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return false;
      return true;
    }
    if (a instanceof Map) {
      if (!(b instanceof Map) || a.size !== b.size) return false;
      for (const [k, v] of a) {
        if (!b.has(k) || !deepEqual(v, b.get(k), seen)) return false;
      }
      return true;
    }
    if (a instanceof Set) {
      if (!(b instanceof Set) || a.size !== b.size) return false;
      if (a.size > 50) {
        for (const v of a) if (!b.has(v)) return false;
        return true;
      }
      outer: for (const v of a) {
        if (b.has(v)) continue;
        for (const w of b) if (deepEqual(v, w, seen)) continue outer;
        return false;
      }
      return true;
    }
    if (isReactElement(a)) {
      if (!isReactElement(b)) return false;
      return a.type === b.type && a.key === b.key && deepEqual(a.props, b.props, seen);
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      const rb = b;
      for (const k of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!deepEqual(a[k], rb[k], seen)) return false;
      }
      return true;
    }
    return false;
  }
  var AVOIDABLE_KINDS = /* @__PURE__ */ new Set(["deep-equal", "function", "element"]);
  function joinPath(base, key) {
    if (typeof key === "number") return `${base}[${key}]`;
    if (base === "") return key;
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
  }
  function firstDifferentPath(a, b, path = "", depth = 0) {
    if (depth > 8) return path || "(value)";
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return path ? `${path}.length` : "length";
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return firstDifferentPath(a[i], b[i], joinPath(path, i), depth + 1);
      }
      return null;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (!deepEqual(a[k], b[k])) return firstDifferentPath(a[k], b[k], joinPath(path, k), depth + 1);
      }
      return null;
    }
    return deepEqual(a, b) ? null : path || "(value)";
  }
  function diffLeaves(a, b, limit = 20, path = "", out = []) {
    if (out.length >= limit || Object.is(a, b)) return out;
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n && out.length < limit; i++) diffLeaves(a[i], b[i], limit, joinPath(path, i), out);
      return out;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const k of /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (out.length >= limit) break;
        diffLeaves(a[k], b[k], limit, joinPath(path, k), out);
      }
      return out;
    }
    if (!deepEqual(a, b)) out.push({ path: path || "(value)", prev: a, next: b });
    return out;
  }

  // src/causes.ts
  var isAncestorReport = (anc, r) => anc.path.length < r.path.length && r.path[anc.path.length] === anc.component && anc.path.every((p, i) => r.path[i] === p);
  var bump = (m, key, n = 1) => void m.set(key, (m.get(key) || 0) + n);
  function indexByComponent(reports) {
    const index = /* @__PURE__ */ new Map();
    for (const r of reports) {
      const list = index.get(r.component);
      if (list) list.push(r);
      else index.set(r.component, [r]);
    }
    return index;
  }
  function rootCauseOf(r, commitReports, index = indexByComponent(commitReports)) {
    let cur = r;
    const seen = /* @__PURE__ */ new Set([r]);
    while (cur.trigger === "parent" && cur.parent) {
      const parent = cur.parent;
      const candidates = index.get(parent.name);
      const p = candidates && candidates.find((x) => isAncestorReport(x, cur));
      if (!p || seen.has(p)) return { name: parent.name, trigger: parent.trigger, report: null };
      seen.add(p);
      cur = p;
    }
    return cur === r ? null : { name: cur.component, trigger: cur.trigger, report: cur };
  }
  function rootCausesOf(reports) {
    const roots = /* @__PURE__ */ new Map();
    const rootByReport = /* @__PURE__ */ new Map();
    const index = indexByComponent(reports);
    let avoidable = 0;
    let wasted = 0;
    for (const r of reports) {
      if (!r.avoidable) continue;
      avoidable++;
      if (typeof r.selfDuration === "number") wasted += r.selfDuration;
      const root = rootCauseOf(r, reports, index);
      const name = root ? root.name : r.parent && r.parent.name || "(unknown)";
      const trigger = root ? root.trigger : r.parent && r.parent.trigger || "parent";
      rootByReport.set(r, name);
      let agg = roots.get(name);
      if (!agg) {
        agg = { name, trigger, count: 0, components: /* @__PURE__ */ new Map() };
        roots.set(name, agg);
      }
      agg.count++;
      bump(agg.components, r.component);
    }
    return { roots: [...roots.values()].sort((a, b) => b.count - a.count), rootByReport, avoidable, wasted };
  }
  function analyzeCommit(reports) {
    const first = reports[0];
    return {
      id: first && typeof first.commitId === "number" ? first.commitId : 0,
      total: reports.length,
      ...rootCausesOf(reports),
      contexts: contextAttribution(reports),
      reports
    };
  }
  function contextAttribution(reports) {
    const byCtx = /* @__PURE__ */ new Map();
    for (const r of reports) {
      for (const c of r.hookChanges || []) {
        if (c.hook !== "useContext" && !/^useContext/.test(c.path)) continue;
        const m = /useContext\((.*)\)/.exec(c.path);
        const name = m && m[1] ? m[1] : c.path;
        let agg = byCtx.get(name);
        if (!agg) {
          agg = { name, consumers: 0, avoidable: 0, components: /* @__PURE__ */ new Map(), commits: /* @__PURE__ */ new Set(), providers: /* @__PURE__ */ new Map(), changedKeys: /* @__PURE__ */ new Set(), totalKeys: 0 };
          byCtx.set(name, agg);
        }
        agg.consumers++;
        if (AVOIDABLE_KINDS.has(c.kind)) agg.avoidable++;
        bump(agg.components, r.component);
        agg.commits.add(typeof r.commitId === "number" ? r.commitId : 0);
        if (c.provider && c.provider.component) bump(agg.providers, c.provider.component);
        if (c.changedKeys) for (const k of c.changedKeys) agg.changedKeys.add(k);
        if (typeof c.totalKeys === "number") agg.totalKeys = Math.max(agg.totalKeys, c.totalKeys);
      }
    }
    return [...byCtx.values()].sort((a, b) => b.consumers - a.consumers);
  }
  function cascadeTree(reports) {
    const root = { name: "", children: /* @__PURE__ */ new Map(), report: null };
    for (const r of reports) {
      let node = root;
      for (const seg of r.path.concat([r.component])) {
        let next = node.children.get(seg);
        if (!next) {
          next = { name: seg, children: /* @__PURE__ */ new Map(), report: null };
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
  function rootCauseSummary(name, commits, analyze) {
    const analyzeFn = analyze || ((_, reports) => analyzeCommit(reports));
    const out = { name, trigger: "parent", commits: [], total: 0, components: /* @__PURE__ */ new Map(), affected: [] };
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

  // src/fixes.ts
  var MAX_FIX_REPORTS = 50;
  var rootOf = (path) => path.split(/[.[]/)[0] || path;
  var identifier = (name) => /^[A-Za-z_$][\w$]*$/.test(name) ? name : "value";
  function shortValue(v, max = 60) {
    let s;
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
    if (s === void 0) s = String(v);
    return s.length > max ? s.slice(0, max - 3) + "..." : s;
  }
  function fixesFor(r) {
    const out = [];
    const ownerName = r.owner || r.parent && r.parent.name || null;
    const propChanges = r.propChanges || [];
    const changes = [...propChanges, ...r.stateChanges || [], ...r.hookChanges || []];
    if (r.avoidable && (changes.length === 0 || r.memoized === false)) {
      const identical = changes.length === 0;
      out.push({
        kind: "memo",
        owner: r.component,
        target: r.component,
        prop: null,
        label: `Wrap <${r.component}> in React.memo`,
        detail: identical ? `<${r.component}> re-rendered with identical props because <${r.parent && r.parent.name || "its parent"}> re-rendered.` : `<${r.component}> is not memoized: fixing its props alone will not stop the re-render.`,
        snippet: `// ${r.component}
import { memo } from 'react';

export const ${r.component} = memo(function ${r.component}(props) {
  // ...
});
// class components: extend PureComponent instead`
      });
    }
    for (const c of propChanges) {
      if (!AVOIDABLE_KINDS.has(c.kind)) continue;
      const owner = ownerName || "?";
      const root = rootOf(c.path);
      const id = identifier(root);
      if (root === "children" && (c.kind === "element" || c.kind === "deep-equal")) {
        out.push({
          kind: "children",
          owner,
          target: r.component,
          prop: "children",
          label: `memoize children of <${r.component}> in <${owner}>`,
          detail: `<${owner}> re-creates the children of <${r.component}> on every render; they have the same types and props each time.`,
          snippet: `// ${owner}
import { useMemo } from 'react';

const children = useMemo(() => (
  <>{/* the same elements */}</>
), [/* deps */]);

<${r.component}>{children}</${r.component}>

// static children: hoist them to module scope
const STATIC = <em>hi</em>;`
        });
      } else if (c.kind === "function") {
        out.push({
          kind: "useCallback",
          owner,
          target: r.component,
          prop: root,
          label: `useCallback(${root}) in <${owner}>`,
          detail: `prop "${c.path}" of <${r.component}> is a new function on every render of <${owner}>.`,
          snippet: `// ${owner}
import { useCallback } from 'react';

const ${id} = useCallback((/* args */) => {
  // ...
}, [/* deps */]);

<${r.component} ${root}={${id}} />`
        });
      } else if (c.kind === "element") {
        out.push({
          kind: "useMemoElement",
          owner,
          target: r.component,
          prop: root,
          label: `memoize element prop ${root} in <${owner}>`,
          detail: `prop "${c.path}" of <${r.component}> is a new element with the same type and props on every render of <${owner}>.`,
          snippet: `// ${owner}
import { useMemo } from 'react';

const ${id} = useMemo(() => ${shortValue(c.next, 40)}, [/* deps */]);
// or pass it as children from a component that does not re-render`
        });
      } else {
        const isArray = Array.isArray(c.next);
        out.push({
          kind: "useMemo",
          owner,
          target: r.component,
          prop: root,
          label: `useMemo(${root}) in <${owner}>`,
          detail: `prop "${c.path}" of <${r.component}> is a new ${isArray ? "array" : "object"} with the same contents on every render of <${owner}>.`,
          snippet: `// ${owner}
import { useMemo } from 'react';

const ${id} = useMemo(() => (${shortValue(c.next, 80)}), [/* deps */]);

// or, when it never changes, hoist it to module scope:
const ${id.toUpperCase()} = ${shortValue(c.next, 80)};`
        });
      }
    }
    for (const c of [...r.stateChanges || [], ...r.hookChanges || []]) {
      const isContext = c.hook === "useContext" || /^useContext/.test(c.path);
      const ctxName = isContext ? (/useContext\((.*)\)/.exec(c.path) || [])[1] || "Context" : "";
      const providerOwner = isContext && c.provider && c.provider.component ? c.provider.component : null;
      if (isContext && c.kind === "different" && c.changedKeys && typeof c.totalKeys === "number" && c.changedKeys.length > 0 && c.changedKeys.length < c.totalKeys) {
        out.push({
          kind: "splitContext",
          owner: providerOwner || `${ctxName}.Provider`,
          target: r.component,
          prop: ctxName,
          label: `split ${ctxName}${providerOwner ? ` in <${providerOwner}>` : ""}: only ${c.changedKeys.join(", ")} changed`,
          detail: `${c.changedKeys.map((k) => `"${k}"`).join(", ")} of ${c.totalKeys} keys changed in ${ctxName}, yet every consumer (like <${r.component}>) re-rendered. Consumers that read the other keys re-render for nothing.`,
          snippet: `// ${providerOwner || "Provider"}
// one context per independently-changing slice
const ${identifier(ctxName)}Static = createContext(...);
const ${identifier(ctxName)}${c.changedKeys.map((k) => k[0].toUpperCase() + k.slice(1)).join("")} = createContext(...);

// or keep one context and let consumers select a slice:
const ${c.changedKeys[0]} = useContextSelector(${ctxName}, (v) => v.${c.changedKeys[0]});`
        });
        continue;
      }
      if (!AVOIDABLE_KINDS.has(c.kind)) continue;
      if (isContext) {
        out.push({
          kind: "contextValue",
          owner: providerOwner || `${ctxName}.Provider`,
          target: r.component,
          prop: ctxName,
          label: `memoize the ${ctxName} provider value${providerOwner ? ` in <${providerOwner}>` : ""}`,
          detail: `<${r.component}> re-rendered because ${ctxName} produced a new value that is deep-equal to the previous one${providerOwner ? ` (Provider rendered by <${providerOwner}>)` : ""}.`,
          snippet: `// ${providerOwner || `where <${ctxName}.Provider> is rendered`}
const value = useMemo(() => ({ /* ... */ }), [/* deps */]);
<${ctxName}.Provider value={value}>`
        });
      } else if (c.hook === "useSyncExternalStore") {
        const chain = c.custom || [];
        const redux = chain.some((n) => /^use(App)?Selector$/.test(n));
        const zustand = !redux && chain.some((n) => /^use[A-Z]\w*Store$/.test(n) || n === "useStore" || n === "useBoundStore");
        const via = chain.length ? ` via ${chain.join(" \u203A ")}` : "";
        out.push({
          kind: "storeSnapshot",
          owner: r.component,
          target: r.component,
          prop: c.path,
          label: redux ? `memoize the selector in <${r.component}>` : zustand ? `useShallow in <${r.component}>` : `stable getSnapshot in <${r.component}>`,
          detail: redux ? `the selector${via} returns a new object on every call, so the component re-renders on every store change.` : zustand ? `the store selector${via} returns a new object on every call, so the component re-renders on every store change.` : `${c.path}${via} returned a new reference with the same contents; getSnapshot must return a cached value.`,
          snippet: redux ? `// ${r.component}
import { shallowEqual } from 'react-redux';
const slice = useSelector(selectSlice, shallowEqual);
// or memoize: const selectSlice = createSelector([selectA, selectB], (a, b) => ({ a, b }));` : zustand ? `// ${r.component}
import { useShallow } from 'zustand/react/shallow';
const { a, b } = useStore(useShallow((s) => ({ a: s.a, b: s.b })));
// or select a primitive: const a = useStore((s) => s.a);` : `// ${r.component}
// getSnapshot must return the same reference while the data is unchanged
const snapshot = useSyncExternalStore(subscribe, store.getSnapshot /* cached */);`
        });
      } else {
        out.push({
          kind: "bailout",
          owner: r.component,
          target: r.component,
          prop: c.path,
          label: `bail out before setting ${c.path} in <${r.component}>`,
          detail: `${c.path} was set to a value deep-equal to the current one (new reference).`,
          snippet: `// ${r.component}
setState((prev) => (deepEqual(prev, next) ? prev : next));`
        });
      }
    }
    return out;
  }
  var fixKey = (f) => `${f.kind}|${f.owner}|${f.prop || f.target}`;
  function rankFixes(reports) {
    const byKey = /* @__PURE__ */ new Map();
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

  // src/report.ts
  var KIND_LABEL = {
    "deep-equal": "equal by value",
    function: "new function",
    element: "equal element",
    different: "changed",
    added: "added",
    removed: "removed"
  };
  function summarize(report) {
    const counts = /* @__PURE__ */ new Map();
    for (const c of [...report.propChanges || [], ...report.stateChanges || [], ...report.hookChanges || []]) {
      counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    }
    const parts = [...counts].map(([kind, n]) => `${n} ${KIND_LABEL[kind] || kind}`);
    if (parts.length === 0) parts.push("no changes");
    return parts.join(", ");
  }

  // src/sessions.ts
  function summarizeReports(reports, meta = {}) {
    var _a;
    const byComponent = {};
    let avoidable = 0;
    let wasted = 0;
    for (const r of reports) {
      const c = byComponent[_a = r.component] || (byComponent[_a] = { total: 0, avoidable: 0, wasted: 0 });
      c.total++;
      if (r.avoidable) {
        c.avoidable++;
        avoidable++;
        if (typeof r.selfDuration === "number") {
          c.wasted += r.selfDuration;
          wasted += r.selfDuration;
        }
      }
    }
    return {
      id: meta.id ?? `s${Date.now().toString(36)}`,
      name: meta.name ?? "session",
      startedAt: meta.startedAt ?? (reports[0]?.time ?? 0),
      endedAt: meta.endedAt ?? (reports[reports.length - 1]?.time ?? null),
      total: reports.length,
      avoidable,
      wasted,
      byComponent,
      fixes: rankFixes(reports).map((f) => ({ key: f.key, label: f.label, count: f.count }))
    };
  }
  function compareSummaries(before, after) {
    const names = /* @__PURE__ */ new Set([...Object.keys(before.byComponent), ...Object.keys(after.byComponent)]);
    const rows = [];
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
      regressions: rows.filter((r) => r.delta > 0)
    };
  }
  var summarizeSession = (session, reports) => summarizeReports(reports, session);
  var compareSessions = compareSummaries;

  // extension/src/panel.ts
  var PROTOCOL = 2;
  var FN_PREFIX = "\u0192 ";
  var MAX_REPORTS = 2e3;
  var MAX_PER_NODE = 200;
  var MAX_COMMITS = 500;
  var MAX_PER_COMMIT = 500;
  var THROTTLE_MIN_REPORTS = 200;
  var BEST_FIX_INTERVAL = 500;
  var LEFT_RENDER_INTERVAL = 250;
  var SYNC_RETRY_MIN = 500;
  var SYNC_RETRY_MAX = 5e3;
  var SYNC_RETRIES = 20;
  var NAVIGATION_SETTLE = 1200;
  var INFO_REFRESH_MS = 3e3;
  var ROW_H = 22;
  var ITEM_H = 20;
  var OVERSCAN = 8;
  var FALLBACK_VIEWPORT = 800;
  var MAX_STRIP_BARS = 200;
  var MIN_BAR_PCT = 8;
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === "class") node.className = String(v);
        else if (k === "text") node.textContent = String(v);
        else if (k.startsWith("on")) {
          if (typeof v === "function") node.addEventListener(k.slice(2), v);
        } else if (v === true) node.setAttribute(k, "");
        else if (v !== void 0 && v !== null && v !== false) node.setAttribute(k, String(v));
      }
    }
    if (children) {
      for (const c of [].concat(children)) if (c != null) node.append(c);
    }
    return node;
  }
  function fmtTime(ms) {
    const d = new Date(ms);
    const p = (n, w) => String(n).padStart(w, "0");
    return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`;
  }
  var fmtMs = (n) => typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)} ms` : "";
  var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  var fmtSpan = (ms) => ms < 1e3 ? `${Math.round(ms)}ms` : ms < 6e4 ? `${(ms / 1e3).toFixed(1)}s` : `${(ms / 6e4).toFixed(1)}m`;
  var spokenAgo = (ms) => ms < 1e3 ? "just now" : ms < 6e4 ? `${Math.round(ms / 1e3)} seconds ago` : `${Math.round(ms / 6e4)} minutes ago`;
  var componentList = (m) => (m instanceof Map ? [...m] : Object.entries(m)).map(([c, n]) => `<${c}>${n > 1 ? " \xD7" + n : ""}`).join(", ");
  function changesOf(report) {
    return [].concat(report.propChanges || [], report.stateChanges || [], report.hookChanges || []);
  }
  var isRecord = (v) => typeof v === "object" && v !== null;
  function normalizeReport(p) {
    if (!isRecord(p) || typeof p.component !== "string") return null;
    const arr = (x) => Array.isArray(x) ? x.filter((c) => isRecord(c) && typeof c.path === "string") : [];
    const props = isRecord(p.props) ? p.props : {};
    const parent = isRecord(p.parent) && typeof p.parent.name === "string" ? { name: p.parent.name, trigger: typeof p.parent.trigger === "string" ? p.parent.trigger : "parent" } : null;
    const r = {
      component: p.component,
      instanceId: typeof p.instanceId === "number" ? p.instanceId : 0,
      commitId: typeof p.commitId === "number" ? p.commitId : 0,
      renderCount: typeof p.renderCount === "number" ? p.renderCount : 0,
      trigger: typeof p.trigger === "string" ? p.trigger : "parent",
      avoidable: !!p.avoidable,
      props: { prev: isRecord(props.prev) ? props.prev : {}, next: isRecord(props.next) ? props.next : {} },
      propChanges: arr(p.propChanges),
      stateChanges: arr(p.stateChanges),
      hookChanges: arr(p.hookChanges),
      parent,
      owner: typeof p.owner === "string" ? p.owner : null,
      path: Array.isArray(p.path) ? p.path.filter((x) => typeof x === "string") : [],
      reasons: Array.isArray(p.reasons) ? p.reasons.filter((x) => typeof x === "string") : [],
      time: typeof p.time === "number" ? p.time : 0,
      receivedAt: typeof p.receivedAt === "number" ? p.receivedAt : 0
    };
    if (typeof p.selfDuration === "number") r.selfDuration = p.selfDuration;
    if (typeof p.treeDuration === "number") r.treeDuration = p.treeDuration;
    if (typeof p.memoized === "boolean") r.memoized = p.memoized;
    if (p.compiled === true) r.compiled = true;
    if (typeof p.commitPriority === "string") r.commitPriority = p.commitPriority;
    if (Array.isArray(p.hookState)) r.hookState = p.hookState.filter((h) => isRecord(h) && typeof h.path === "string");
    if (Array.isArray(p.contexts)) r.contexts = p.contexts.filter((c) => isRecord(c) && typeof c.name === "string");
    if (isRecord(p.state)) r.state = p.state;
    if (Array.isArray(p.updaters)) r.updaters = p.updaters.filter((u) => typeof u === "string");
    if (p.commitCause === "effect-after-commit" || p.commitCause === "suspense-resolved") r.commitCause = p.commitCause;
    if (typeof p.afterCommit === "number") r.afterCommit = p.afterCommit;
    if (typeof p.key === "string") r.key = p.key;
    if (isRecord(p.source) && typeof p.source.fileName === "string") r.source = p.source;
    return r;
  }
  function valueNode(v, depth = 0) {
    if (v === null || v === void 0) return el("span", { class: "v nil", text: String(v) });
    const t = typeof v;
    if (typeof v === "string") {
      if (v.startsWith(FN_PREFIX)) return el("span", { class: "v fn", text: v });
      if (/^<[^>]+>$/.test(v)) return el("span", { class: "v", text: v });
      return el("span", { class: "v str", text: JSON.stringify(v) });
    }
    if (t === "number" || t === "bigint") return el("span", { class: "v num", text: String(v) });
    if (t === "boolean") return el("span", { class: "v bool", text: String(v) });
    if (Array.isArray(v)) {
      const short = v.length <= 4 && v.every((x) => typeof x !== "object" || x === null);
      if (short) {
        const s = el("span", { class: "v" }, "[");
        v.forEach((x, i) => {
          if (i) s.append(", ");
          s.append(valueNode(x, depth + 1));
        });
        s.append("]");
        return s;
      }
      return objectDetails(`Array(${v.length})`, v);
    }
    const o = v;
    if (o.$type === "element") {
      const props = isRecord(o.props) ? o.props : {};
      const label2 = `<${String(o.name)}${o.key !== void 0 ? ` key=${JSON.stringify(o.key)}` : ""}>`;
      return Object.keys(props).length ? objectDetails(label2, props) : el("span", { class: "v", text: label2 });
    }
    if (o.$type === "Date") return el("span", { class: "v", text: `Date(${String(o.value)})` });
    if (o.$type === "RegExp") return el("span", { class: "v", text: String(o.value) });
    if (o.$type === "Map" && Array.isArray(o.entries)) return objectDetails(`Map(${o.entries.length})`, o.entries);
    if (o.$type === "Set" && Array.isArray(o.values)) return objectDetails(`Set(${o.values.length})`, o.values);
    const keys = Object.keys(o).filter((k) => k !== "$type");
    const label = `${o.$type ? String(o.$type) + " " : ""}{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""}}`;
    return objectDetails(label, o);
  }
  function objectDetails(label, obj) {
    const d = el("details", { class: "obj" }, [el("summary", { text: label })]);
    d.addEventListener(
      "toggle",
      () => {
        if (d.open && !d.querySelector("pre")) d.append(el("pre", { text: JSON.stringify(obj, null, 2) }));
      },
      { once: true }
    );
    return d;
  }
  function analyzeCommit2(reports) {
    const first = reports[0];
    return { ...analyzeCommit(reports), receivedAt: first ? first.receivedAt : 0, fixes: rankFixes(reports) };
  }
  function rootCauseSummary2(name, commits, analyze = (_, reports) => analyzeCommit2(reports)) {
    const s = rootCauseSummary(name, commits, analyze);
    return { ...s, fixes: rankFixes(s.affected) };
  }
  var PRIORITY_LABEL = { immediate: "discrete input", "user-blocking": "continuous input", normal: "transition / async", low: "low", idle: "idle" };
  function sourceContext(text, line, around = 3) {
    const lines = text.split("\n");
    const from = Math.max(1, line - around);
    const to = Math.min(lines.length, line + around);
    const out = [];
    for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1] ?? "", hit: n === line });
    return out;
  }
  function reportToMarkdown(r) {
    const lines = [];
    lines.push(`### <${r.component}> ${r.avoidable ? "avoidable re-render" : `re-render (${r.trigger})`} #${r.renderCount}`);
    lines.push("");
    for (const x of r.reasons || []) lines.push(`- ${x}`);
    if (r.path && r.path.length) lines.push("", `**Path:** ${r.path.concat([r.component]).join(" > ")}`);
    if (r.parent) lines.push(`**Triggered by:** <${r.parent.name}> (${r.parent.trigger})`);
    if (r.owner) lines.push(`**Created by:** <${r.owner}>`);
    if (r.source) lines.push(`**Source:** ${r.source.fileName}${r.source.lineNumber ? ":" + r.source.lineNumber : ""}`);
    const changes = changesOf(r);
    if (changes.length) {
      lines.push("", "| path | kind | prev | next |", "| --- | --- | --- | --- |");
      for (const c of changes) lines.push(`| ${c.path} | ${KIND_LABEL[c.kind] || c.kind} | \`${shortValue(c.prev, 40)}\` | \`${shortValue(c.next, 40)}\` |`);
    }
    if (r.hookState && r.hookState.length) {
      lines.push("", "**Hooks**", "");
      for (const h of r.hookState) lines.push(`- ${h.path}: \`${shortValue(h.value, 60)}\``);
    }
    if (r.state && Object.keys(r.state).length) lines.push("", `**State:** \`${shortValue(r.state, 120)}\``);
    if (r.contexts && r.contexts.length) {
      lines.push("", "**Contexts**", "");
      for (const c of r.contexts) lines.push(`- ${c.name}: \`${shortValue(c.value, 60)}\``);
    }
    const fixes = fixesFor(r);
    if (fixes.length) {
      lines.push("", "**Fix**", "");
      for (const f of fixes) lines.push(`- ${f.label}`);
      lines.push("", "```jsx", fixes[0].snippet, "```");
    }
    return lines.join("\n");
  }
  function changeRow(label, c, suffix = "") {
    const tr = el("tr", { class: "changed" + (AVOIDABLE_KINDS.has(c.kind) ? "" : " real") });
    tr.append(el("td", { class: "k", text: label }));
    const td = el("td");
    td.append(valueNode(c.prev), el("span", { class: "arrow", text: "\u2192" }));
    td.append(c.kind === "removed" ? el("span", { class: "v nil", text: "(removed)" }) : valueNode(c.next));
    let kind = (KIND_LABEL[c.kind] || c.kind) + suffix;
    const objectDiff = c.kind === "different" && isRecord(c.prev) && isRecord(c.next);
    if (objectDiff) {
      const p = firstDifferentPath(c.prev, c.next, c.path);
      if (p) kind += ` at ${p}`;
    }
    td.append(el("span", { class: "kind", text: kind }));
    if (objectDiff) {
      const leaves = diffLeaves(c.prev, c.next, 20, c.path);
      if (leaves.length) {
        const d = el("details", { class: "diff" }, [el("summary", { text: `${leaves.length}${leaves.length >= 20 ? "+" : ""} differing ${leaves.length === 1 ? "leaf" : "leaves"}` })]);
        const table = el("table", { class: "kv leaves" });
        for (const leaf of leaves) {
          const row = el("tr");
          row.append(el("td", { class: "k", text: leaf.path }));
          const cell = el("td");
          cell.append(valueNode(leaf.prev), el("span", { class: "arrow", text: "\u2192" }), valueNode(leaf.next));
          row.append(cell);
          table.append(row);
        }
        d.append(table);
        td.append(d);
      }
    }
    tr.append(td);
    return tr;
  }
  function kvSection(title, next, changes) {
    const byKey = new Map(changes.map((c) => [c.path.split(/[.[]/)[0], c]));
    const table = el("table", { class: "kv" });
    for (const k of Object.keys(next || {})) {
      const c = byKey.get(k);
      if (c) {
        table.append(changeRow(k, c, c.path !== k ? ` at ${c.path}` : ""));
      } else {
        const tr = el("tr");
        tr.append(el("td", { class: "k", text: k }));
        const td = el("td");
        td.append(valueNode(next[k]));
        tr.append(td);
        table.append(tr);
      }
    }
    for (const c of changes) if (c.kind === "removed") table.append(changeRow(c.path, c));
    if (!table.children.length) table.append(el("tr", null, [el("td", { class: "v nil", text: "no props" })]));
    return el("div", { class: "section" }, [el("h3", { text: title }), table]);
  }
  function sourceLabel(src) {
    const file = src.fileName.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    return `${file}${src.lineNumber ? ":" + src.lineNumber : ""}`;
  }
  function reportView(r, actions = {}) {
    const frag = document.createDocumentFragment();
    const duration = typeof r.selfDuration === "number" ? ` \xB7 ${fmtMs(r.selfDuration)} self${typeof r.treeDuration === "number" && r.treeDuration > r.selfDuration ? `, ${fmtMs(r.treeDuration)} with children` : ""}` : "";
    const head = el("div", { class: "section" }, [
      el("h3", { text: "Why did this render?" }),
      el("div", null, [
        el("span", { class: "verdict " + (r.avoidable ? "avoid" : "ok"), text: r.avoidable ? "Avoidable re-render" : `Re-render (${r.trigger})` }),
        el("span", { class: "meta", text: `  #${r.renderCount} \xB7 ${summarize(r)}${duration}` })
      ]),
      el("ul", { class: "reasons" }, (r.reasons || []).map((x) => el("li", { text: x })))
    ]);
    if (!actions.compact) {
      const bar = el("div", { class: "actions" });
      const src = r.source;
      if (src && actions.openSource) {
        const open = actions.openSource;
        bar.append(el("button", { title: src.fileName, onclick: () => open(src) }, `\u2197 ${sourceLabel(src)}`));
      } else if (src) bar.append(el("span", { class: "meta", title: src.fileName, text: sourceLabel(src) }));
      if (actions.highlight && r.instanceId) {
        const highlight = actions.highlight;
        bar.append(el("button", { onclick: () => highlight(r.instanceId) }, "\u25A3 Highlight"));
      }
      if (actions.copy) {
        const copy = actions.copy;
        bar.append(el("button", { onclick: () => copy(reportToMarkdown(r)) }, "\u2398 Copy as Markdown"));
      }
      if (bar.children.length) head.append(bar);
      const loc = r.source;
      if (loc && loc.lineNumber && actions.readSource) {
        const box = el("pre", { class: "source-context", text: "loading source\u2026" });
        head.append(box);
        const line = loc.lineNumber;
        void actions.readSource(loc.fileName).then((text) => {
          box.textContent = "";
          if (!text) {
            box.textContent = "source not available";
            return;
          }
          for (const l of sourceContext(text, line)) box.append(el("span", { class: "line" + (l.hit ? " hit" : "") }, [el("span", { class: "ln", text: String(l.n).padStart(4) }), " ", l.text, "\n"]));
        }).catch(() => {
          box.textContent = "source not available";
        });
      }
    }
    frag.append(head);
    const by = el("div", { class: "section" }, [el("h3", { text: "Rendered by" })]);
    const crumbs = el("div", { class: "crumbs" });
    const parts = [].concat(r.path || []);
    parts.forEach((p, i) => {
      if (i) crumbs.append(" \u203A ");
      crumbs.append(p);
    });
    if (parts.length) crumbs.append(" \u203A ");
    crumbs.append(el("b", { text: r.component }));
    by.append(crumbs);
    if (r.parent) by.append(el("div", { text: `Triggered by <${r.parent.name}> (${r.parent.trigger})` }));
    else by.append(el("div", { text: "Update started in this component" }));
    if (r.owner) by.append(el("div", { class: "meta", text: `Created by <${r.owner}>` }));
    if (r.compiled) by.append(el("div", { class: "meta", text: "Compiled by React Compiler (output memoized per input; identical inputs make the render cheap)" }));
    else if (r.memoized === false) by.append(el("div", { class: "meta", text: "Not memoized (re-renders whenever its parent does)" }));
    else if (r.memoized === true) by.append(el("div", { class: "meta", text: "Memoized (React.memo / PureComponent)" }));
    if (r.updaters && r.updaters.length) by.append(el("div", { text: `Update scheduled by ${r.updaters.map((u) => `<${u}>`).join(", ")}` }));
    if (r.commitCause === "effect-after-commit") by.append(el("div", { class: "cause effect", text: `Effect loop: state set right after commit #${r.afterCommit ?? "?"}` }));
    else if (r.commitCause === "suspense-resolved") by.append(el("div", { class: "cause suspense", text: "Suspense boundary resolved in this commit" }));
    if (r.commitId) by.append(el("div", { class: "meta", text: `Commit #${r.commitId}${r.commitPriority ? ` \xB7 ${PRIORITY_LABEL[r.commitPriority] || r.commitPriority} priority` : ""}` }));
    frag.append(by);
    frag.append(kvSection("Props", r.props ? r.props.next : {}, r.propChanges || []));
    const hookChanges = new Map((r.hookChanges || []).map((c) => [c.path, c]));
    const stateChanges = r.stateChanges || [];
    if (r.hookState || r.contexts || r.state) {
      if (r.hookState && r.hookState.length) {
        const table = el("table", { class: "kv" });
        for (const h of r.hookState) {
          const c = hookChanges.get(h.path);
          const label = h.custom && h.custom.length ? `${h.custom.join(" \u203A ")} \u203A ${h.path}` : h.path;
          if (c) table.append(changeRow(label, c));
          else {
            const tr = el("tr");
            tr.append(el("td", { class: "k", text: label }));
            const td = el("td");
            td.append(valueNode(h.value));
            tr.append(td);
            table.append(tr);
          }
        }
        frag.append(el("div", { class: "section" }, [el("h3", { text: "Hooks" }), table]));
      }
      if (r.state) frag.append(kvSection("State", r.state, stateChanges));
      if (r.contexts && r.contexts.length) {
        const table = el("table", { class: "kv" });
        for (const ctx of r.contexts) {
          const c = hookChanges.get(`useContext(${ctx.name})`);
          if (c) table.append(changeRow(ctx.name, c));
          else {
            const tr = el("tr");
            tr.append(el("td", { class: "k", text: ctx.name }));
            const td = el("td");
            td.append(valueNode(ctx.value));
            tr.append(td);
            table.append(tr);
          }
        }
        frag.append(el("div", { class: "section" }, [el("h3", { text: "Contexts" }), table]));
      }
      const leftover = [...hookChanges.values()].filter((c) => !(r.hookState || []).some((h) => h.path === c.path) && !(r.contexts || []).some((x) => `useContext(${x.name})` === c.path));
      if (leftover.length) {
        const table = el("table", { class: "kv" });
        for (const c of leftover) table.append(changeRow(c.path, c));
        frag.append(el("div", { class: "section" }, [el("h3", { text: "Other hooks that changed" }), table]));
      }
      return frag;
    }
    const hooks = [].concat(r.hookChanges || [], stateChanges);
    if (hooks.length) {
      const table = el("table", { class: "kv" });
      for (const c of hooks) table.append(changeRow(c.custom && c.custom.length ? `${c.custom.join(" \u203A ")} \u203A ${c.path}` : c.path, c));
      frag.append(el("div", { class: "section" }, [el("h3", { text: "State & hooks that changed" }), table]));
    }
    return frag;
  }
  function fixView(fixes, actions = {}) {
    const frag = document.createDocumentFragment();
    if (!fixes.length) {
      frag.append(el("div", { class: "section" }, [el("h3", { text: "Fix" }), el("div", { class: "meta", text: "Nothing to fix: this render was caused by a genuine change." })]));
      return frag;
    }
    for (const f of fixes) {
      const ranked = "count" in f ? f : null;
      const sec = el("div", { class: "section fix" }, [
        el("h3", { text: f.label }),
        el("div", { text: f.detail }),
        ranked ? el("div", { class: "meta", text: `removes ${plural(ranked.count, "avoidable re-render")}: ${componentList(ranked.components)}` }) : null,
        el("pre", { class: "snippet", text: f.snippet })
      ]);
      if (actions.copy) {
        const copy = actions.copy;
        sec.append(el("button", { onclick: () => copy(f.snippet) }, "\u2398 Copy snippet"));
      }
      frag.append(sec);
    }
    return frag;
  }
  function virtualList(container, rowHeight, rowFor, opts = {}) {
    const inner = el("div", { class: "virtual-inner", role: "list" });
    if (opts.attach !== false) container.append(inner);
    let items = [];
    const mounted = /* @__PURE__ */ new Map();
    let raf = 0;
    const render = () => {
      raf = 0;
      if (!inner.isConnected) return;
      const height = container.clientHeight || FALLBACK_VIEWPORT;
      const top = container.scrollTop - (opts.headerHeight ? opts.headerHeight() : 0);
      const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
      const end = Math.min(items.length, Math.ceil((top + height) / rowHeight) + OVERSCAN);
      inner.style.height = `${items.length * rowHeight}px`;
      const keep = /* @__PURE__ */ new Set();
      for (let i = start; i < end; i++) {
        const row = rowFor(items[i], i);
        row.style.top = `${i * rowHeight}px`;
        if (row.parentNode !== inner) inner.append(row);
        mounted.set(row, i);
        keep.add(row);
      }
      for (const row of [...mounted.keys()]) {
        if (!keep.has(row)) {
          row.remove();
          mounted.delete(row);
        }
      }
    };
    container.addEventListener("scroll", () => {
      if (!raf) raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(render) : setTimeout(render, 0);
    });
    return {
      container,
      inner,
      get items() {
        return items;
      },
      setItems(next) {
        items = next;
        render();
      },
      render,
      scrollTo(index) {
        const height = container.clientHeight || FALLBACK_VIEWPORT;
        const top = index * rowHeight;
        if (top < container.scrollTop) container.scrollTop = top;
        else if (top + rowHeight > container.scrollTop + height) container.scrollTop = top + rowHeight - height;
        render();
      }
    };
  }
  function createPanel(root, transport, options = {}) {
    const state = {
      tree: { name: "", children: /* @__PURE__ */ new Map(), reports: [], total: 0, avoidable: 0, wasted: 0, expanded: true, path: [], key: "" },
      nodesByKey: /* @__PURE__ */ new Map(),
      reports: [],
      commits: /* @__PURE__ */ new Map(),
      commitOrder: [],
      apps: [],
      appId: null,
      selectedKey: null,
      selectedReport: null,
      selectedCommit: null,
      selectedFix: null,
      selectedRoot: null,
      view: "tree",
      tab: "latest",
      paused: false,
      avoidableOnly: false,
      filter: "",
      relay: false,
      library: null,
      polling: false,
      streamCollapsed: false,
      collapsed: /* @__PURE__ */ new Set(),
      sort: { key: "avoidable", dir: -1 },
      flashOn: false,
      settingsOpen: false,
      origin: null,
      tabLabel: transport.tabLabel ?? null,
      compact: false,
      sessions: [],
      recording: null,
      selectedSession: null,
      compareWith: null,
      byInstance: false,
      timeWindow: null,
      stripCollapsed: false
    };
    let persistTimer = null;
    let queue = [];
    let flushScheduled = false;
    const schedule = typeof requestAnimationFrame === "function" ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);
    const copyText = (text) => {
      if (transport.copy) transport.copy(text);
      else if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {
      });
      toast("Copied");
    };
    root.textContent = "";
    const search = el("input", {
      type: "search",
      placeholder: "Search components (text or /regex/)",
      oninput: () => {
        state.filter = search.value;
        renderLeft();
        renderStream();
        persist();
      }
    });
    const iconButton = (glyph, label, title, onclick, extra = {}) => el("button", { class: "ib", title, onclick, "aria-label": label, ...extra }, [el("span", { class: "glyph", text: glyph }), el("span", { class: "label", text: label })]);
    const pauseBtn = iconButton("\u23F8", "Pause", "Pause / resume (reports keep buffering in the page)", () => {
      state.paused = !state.paused;
      pauseBtn.classList.toggle("active", state.paused);
      pauseBtn.querySelector(".glyph").textContent = state.paused ? "\u25B6" : "\u23F8";
      pauseBtn.querySelector(".label").textContent = state.paused ? "Resume" : "Pause";
    });
    const clearBtn = iconButton("\u2298", "Clear", "Clear the panel and the page buffer", () => {
      clearAll();
      transport.clear?.();
      transport.badge?.(0);
    });
    const replayBtn = iconButton("\u21BB", "Replay", "Replay buffered reports from the page", () => transport.replay?.());
    const recordBtn = iconButton("\u23FA", "Record", "Record a session to compare before and after a fix", () => {
      if (state.recording) stopRecording();
      else startRecording();
    });
    const exportBtn = iconButton("\u2913", "Export", "Export reports as JSON", exportJson);
    const importInput = el("input", { type: "file", accept: "application/json,.json", class: "hidden-file" });
    importInput.addEventListener("change", () => {
      const f = importInput.files && importInput.files[0];
      if (f) importFile(f);
      importInput.value = "";
    });
    const importBtn = iconButton("\u2912", "Import", "Import a JSON export", () => importInput.click());
    const avoidCheck = el("input", {
      type: "checkbox",
      onchange: () => {
        state.avoidableOnly = avoidCheck.checked;
        renderLeft();
        renderStream();
        persist();
      }
    });
    const settingsBtn = iconButton("\u2699", "Settings", "Settings", () => toggleSettings());
    const status = el("span", { class: "status", title: "" }, [el("span", { class: "dot" }), el("span", { class: "status-text", text: "no page" })]);
    const tabChip = el("span", { class: "tab-chip", hidden: true, title: "The tab this panel follows" });
    const appPicker = el("select", { class: "app-picker", hidden: true, title: "Which connected app this panel watches", "aria-label": "App" });
    appPicker.addEventListener("change", () => transport.selectApp?.(appPicker.value));
    const undock = transport.undock ? [
      el("span", { class: "sep" }),
      iconButton("\u2AFF", "Side panel", "Show this panel next to the page (Chrome side panel)", () => void transport.undock("sidepanel").catch((e) => toast(String(e.message || e)))),
      iconButton("\u29C9", "Window", "Show this panel in its own window", () => void transport.undock("window").catch((e) => toast(String(e.message || e))))
    ] : [];
    const toolbar = el("div", { class: "toolbar" }, [
      search,
      el("span", { class: "sep" }),
      pauseBtn,
      clearBtn,
      replayBtn,
      recordBtn,
      el("span", { class: "sep" }),
      exportBtn,
      importBtn,
      importInput,
      el("span", { class: "sep" }),
      el("label", { class: "check" }, [avoidCheck, el("span", { class: "label", text: "Avoidable only" })]),
      ...undock,
      el("span", { class: "spacer" }),
      tabChip,
      appPicker,
      status,
      settingsBtn
    ]);
    const summary = el("div", { class: "summary" });
    const banner = el("div", { class: "banner", hidden: true });
    const stripChevron = el("span", { class: "chevron", text: "\u25BE" });
    const stripCount = el("span", { class: "count", text: "0 commits" });
    const stripChip = el("button", {
      class: "chip",
      hidden: true,
      title: "Clear the time window (Esc)",
      onclick: (e) => {
        e.stopPropagation();
        clearWindow();
      }
    });
    const stripBars = el("div", { class: "bars" });
    const stripFrom = el("span", { class: "from", text: "" });
    const stripTo = el("span", { class: "to", text: "now" });
    const stripHeader = el("div", { class: "timeline-header", onclick: () => toggleStrip() }, [stripChevron, el("span", { class: "title", text: "Timeline" }), stripChip, stripCount]);
    const timeline = el("div", { class: "timeline", hidden: true, role: "group", "aria-label": "Commit timeline" }, [
      stripHeader,
      el("div", { class: "timeline-body" }, [stripBars, el("div", { class: "timeline-axis" }, [stripFrom, stripTo])])
    ]);
    const viewsBar = el("div", { class: "views" });
    const VIEWS = [
      ["tree", "Tree"],
      ["offenders", "Offenders"],
      ["commits", "Commits"],
      ["fixes", "Fixes"],
      ["sessions", "Sessions"]
    ];
    const viewButtons = /* @__PURE__ */ new Map();
    for (const [id, label] of VIEWS) {
      const b = el("button", { "data-view": id, onclick: () => setView(id) }, label);
      viewButtons.set(id, b);
      viewsBar.append(b);
    }
    const instancesBtn = el(
      "button",
      {
        class: "instances",
        title: "Group the tree by instance (key or id) instead of by component name",
        onclick: () => {
          state.byInstance = !state.byInstance;
          instancesBtn.classList.toggle("active", state.byInstance);
          rebuildTree();
          persist();
        }
      },
      "\u205D Instances"
    );
    viewsBar.append(el("span", { class: "spacer" }), instancesBtn);
    const tree = el("div", { class: "tree", tabindex: "0", onkeydown: onTreeKey, role: "tree" });
    const table = el("div", { class: "table-wrap", hidden: true });
    const left = el("div", { class: "left" }, [viewsBar, tree, table]);
    const resizer = el("div", { class: "resizer", title: "Drag to resize" });
    const details = el("div", { class: "details" });
    const settings = el("div", { class: "drawer", hidden: true });
    const main = el("div", { class: "main" }, [left, resizer, details, settings]);
    const streamList = el("div", { class: "stream-list" });
    const streamCount = el("span", { class: "count", text: "0 reports" });
    const stream = el("div", { class: "stream" }, [
      el(
        "div",
        {
          class: "stream-header",
          onclick: () => {
            state.streamCollapsed = !state.streamCollapsed;
            stream.classList.toggle("collapsed", state.streamCollapsed);
            persist();
          }
        },
        [el("span", { text: "\u25BE Live stream" }), streamCount]
      ),
      streamList
    ]);
    const toastEl = el("div", { class: "toast", hidden: true, role: "status", "aria-live": "polite" });
    root.classList.add("rl");
    search.setAttribute("aria-label", "Search components; prefix with ~ to search values");
    search.placeholder = "Search components (text, /regex/, ~value)";
    streamList.setAttribute("aria-label", "Live stream of reports");
    details.setAttribute("role", "region");
    details.setAttribute("aria-label", "Details");
    settings.setAttribute("role", "dialog");
    settings.setAttribute("aria-label", "Settings");
    stripBars.setAttribute("role", "group");
    stripBars.setAttribute("aria-label", "Commits over time; arrow keys move between commits, Enter selects, drag to filter every view to a time window");
    root.append(toolbar, summary, banner, timeline, main, stream, toastEl);
    root.addEventListener("keydown", onGlobalKey);
    function setCompact(on) {
      if (state.compact === on) return;
      state.compact = on;
      root.classList.toggle("compact", on);
      treeList.render();
      streamItems.render();
    }
    const measure = () => setCompact(root.clientWidth > 0 && root.clientWidth < 720);
    if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(root);
    else window.addEventListener("resize", measure);
    const totals = { avoidable: 0, wasted: 0, perComponent: /* @__PURE__ */ new Map() };
    let bestFix;
    let bestFixAt = 0;
    let bestFixGen = -1;
    let bestFixTimer = null;
    const throttled = () => state.reports.length >= THROTTLE_MIN_REPORTS;
    function refreshBestFix() {
      if (!totals.avoidable) {
        bestFix = void 0;
        bestFixGen = dataGen;
        return;
      }
      if (bestFixGen === dataGen) return;
      const now = Date.now();
      if (throttled() && now - bestFixAt < BEST_FIX_INTERVAL) {
        if (!bestFixTimer) {
          bestFixTimer = setTimeout(() => {
            bestFixTimer = null;
            renderSummary();
          }, BEST_FIX_INTERVAL - (now - bestFixAt));
        }
        return;
      }
      bestFixAt = now;
      bestFixGen = dataGen;
      bestFix = rankFixes(state.reports)[0];
    }
    function renderSummary() {
      summary.textContent = "";
      const total = state.reports.length;
      if (!total) {
        summary.hidden = true;
        return;
      }
      summary.hidden = false;
      const { avoidable, wasted } = totals;
      let top;
      for (const entry of totals.perComponent) if (!top || entry[1] > top[1]) top = entry;
      refreshBestFix();
      const fix = bestFix;
      const stat = (value, label, cls = "") => el("span", { class: "stat " + cls }, [el("b", { text: value }), el("span", { class: "label", text: label })]);
      summary.append(stat(String(total), plural(total, "render").replace(/^\d+ /, "")), stat(String(avoidable), "avoidable", avoidable ? "bad" : "good"));
      if (wasted) summary.append(stat(fmtMs(wasted), "wasted", "bad"));
      if (top) {
        summary.append(
          el("button", { class: "stat link", title: "Select the component with the most avoidable re-renders", onclick: () => panelApi.select(top[0]) }, [
            el("span", { class: "label", text: "top" }),
            el("b", { class: "mono", text: `<${top[0]}>` }),
            el("span", { class: "label", text: `\xD7${top[1]}` })
          ])
        );
      }
      if (fix) {
        summary.append(
          el(
            "button",
            {
              class: "stat link",
              title: "Open the Fixes view",
              onclick: () => {
                state.selectedFix = fix.key;
                state.tab = "fixlist";
                setView("fixes");
              }
            },
            [el("span", { class: "label", text: "best fix" }), el("b", { class: "mono", text: fix.label }), el("span", { class: "label", text: `\u2212${fix.count}` })]
          )
        );
      }
    }
    let toastTimer = null;
    function toast(text) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, 1200);
    }
    let drag = null;
    resizer.addEventListener("mousedown", (e) => {
      drag = { x: e.clientX, w: left.getBoundingClientRect().width };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const w = Math.max(180, Math.min(drag.w + e.clientX - drag.x, root.clientWidth - 240));
      left.style.width = w + "px";
      state.treeWidth = w;
    });
    window.addEventListener("mouseup", () => {
      if (drag) persist();
      drag = null;
    });
    function persist() {
      if (!transport.storage) return;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        const saved = {
          filter: state.filter,
          avoidableOnly: state.avoidableOnly,
          view: state.view,
          tab: state.tab === "history" || state.tab === "fix" ? state.tab : "latest",
          streamCollapsed: state.streamCollapsed,
          collapsed: [...state.collapsed],
          treeWidth: state.treeWidth,
          flashOn: state.flashOn,
          byInstance: state.byInstance,
          stripCollapsed: state.stripCollapsed
        };
        transport.storage.set("panel", saved);
      }, 150);
    }
    function restoreSessions(raw) {
      if (!Array.isArray(raw)) return;
      for (const s of raw) {
        if (!isRecord(s) || typeof s.id !== "string" || typeof s.name !== "string" || !isRecord(s.byComponent)) continue;
        if (state.sessions.some((x) => x.id === s.id)) continue;
        state.sessions.push({
          id: s.id,
          name: s.name,
          startedAt: typeof s.startedAt === "number" ? s.startedAt : 0,
          endedAt: typeof s.endedAt === "number" ? s.endedAt : 0,
          total: typeof s.total === "number" ? s.total : 0,
          avoidable: typeof s.avoidable === "number" ? s.avoidable : 0,
          wasted: typeof s.wasted === "number" ? s.wasted : 0,
          byComponent: s.byComponent,
          fixes: Array.isArray(s.fixes) ? s.fixes : [],
          reports: []
        });
      }
      state.sessions.sort((a, b) => a.startedAt - b.startedAt);
      if (state.view === "sessions") renderLeft();
    }
    function restore(raw) {
      if (!isRecord(raw)) return;
      const saved = raw;
      if (typeof saved.filter === "string") {
        state.filter = saved.filter;
        search.value = saved.filter;
      }
      if (typeof saved.avoidableOnly === "boolean") {
        state.avoidableOnly = saved.avoidableOnly;
        avoidCheck.checked = saved.avoidableOnly;
      }
      if (Array.isArray(saved.collapsed)) state.collapsed = new Set(saved.collapsed.filter((x) => typeof x === "string"));
      if (typeof saved.streamCollapsed === "boolean") {
        state.streamCollapsed = saved.streamCollapsed;
        stream.classList.toggle("collapsed", state.streamCollapsed);
      }
      if (typeof saved.treeWidth === "number" && saved.treeWidth > 100) {
        state.treeWidth = saved.treeWidth;
        left.style.width = saved.treeWidth + "px";
      }
      if (typeof saved.flashOn === "boolean") state.flashOn = saved.flashOn;
      if (typeof saved.byInstance === "boolean" && saved.byInstance !== state.byInstance) {
        state.byInstance = saved.byInstance;
        instancesBtn.classList.toggle("active", state.byInstance);
        rebuildTree();
      }
      if (typeof saved.stripCollapsed === "boolean" && saved.stripCollapsed !== state.stripCollapsed) toggleStrip(saved.stripCollapsed);
      if (saved.tab === "history" || saved.tab === "fix") state.tab = saved.tab;
      if (saved.view && viewButtons.has(saved.view)) state.view = saved.view;
      for (const n of state.nodesByKey.values()) n.expanded = !state.collapsed.has(n.key);
      setView(state.view);
      renderStream();
    }
    const keyOf = (path) => path.join(" ");
    function nodeFor(path) {
      const key = keyOf(path);
      const found = state.nodesByKey.get(key);
      if (found) return found;
      let parent = state.tree;
      for (let i = 0; i < path.length; i++) {
        const name = path[i];
        const k = keyOf(path.slice(0, i + 1));
        let n = state.nodesByKey.get(k);
        if (!n) {
          n = { name, children: /* @__PURE__ */ new Map(), reports: [], total: 0, avoidable: 0, wasted: 0, expanded: !state.collapsed.has(k), path: path.slice(0, i + 1), key: k };
          state.nodesByKey.set(k, n);
          parent.children.set(name, n);
        }
        parent = n;
      }
      return parent;
    }
    const instanceLabel = (r) => r.key ? `${r.component} key=${JSON.stringify(r.key)}` : `${r.component} #${r.instanceId}`;
    const nodeOfReport = (r) => nodeFor(r.path.concat([state.byInstance ? instanceLabel(r) : r.component]));
    function rebuildTree() {
      state.tree.children.clear();
      state.nodesByKey.clear();
      rowEls.clear();
      state.selectedKey = null;
      for (const r of state.reports) {
        const node = nodeOfReport(r);
        node.reports.push(r);
        node.total++;
        if (r.avoidable) {
          node.avoidable++;
          if (typeof r.selfDuration === "number") node.wasted += r.selfDuration;
        }
        node.lastReport = r;
      }
      for (const node of state.nodesByKey.values()) trimNode(node);
      renderLeft();
      renderDetails();
    }
    function trimNode(node) {
      const excess = node.reports.length - MAX_PER_NODE;
      if (excess > 0) node.reports.splice(0, excess);
    }
    const commitAnalyses = /* @__PURE__ */ new Map();
    function analysisFor(key, reports) {
      const cached = commitAnalyses.get(key);
      if (cached && cached.len === reports.length) return cached.analysis;
      const analysis = analyzeCommit2(reports);
      commitAnalyses.set(key, { len: reports.length, analysis });
      return analysis;
    }
    const commitMember = /* @__PURE__ */ new WeakSet();
    function forgetCommit(key) {
      state.commits.delete(key);
      commitAnalyses.delete(key);
    }
    function ingest(report) {
      if (!report.receivedAt) report.receivedAt = Date.now();
      state.reports.push(report);
      const node = nodeOfReport(report);
      node.reports.push(report);
      node.total++;
      if (report.avoidable) {
        node.avoidable++;
        totals.avoidable++;
        totals.perComponent.set(report.component, (totals.perComponent.get(report.component) || 0) + 1);
        if (typeof report.selfDuration === "number") {
          node.wasted += report.selfDuration;
          totals.wasted += report.selfDuration;
        }
      }
      node.lastReport = report;
      node.flash = true;
      node.flashAt = Date.now();
      const ck = report.commitId;
      let list = state.commits.get(ck);
      if (!list) {
        list = [];
        state.commits.set(ck, list);
        state.commitOrder.push(ck);
        if (state.commitOrder.length > MAX_COMMITS) forgetCommit(state.commitOrder.shift());
      }
      if (list.length < MAX_PER_COMMIT) {
        list.push(report);
        commitMember.add(report);
      }
      return node;
    }
    function evict() {
      const excess = state.reports.length - MAX_REPORTS;
      if (excess <= 0) return;
      for (const r of state.reports.splice(0, excess)) {
        if (r.avoidable) {
          totals.avoidable--;
          const n = (totals.perComponent.get(r.component) || 0) - 1;
          if (n > 0) totals.perComponent.set(r.component, n);
          else totals.perComponent.delete(r.component);
          if (typeof r.selfDuration === "number") totals.wasted -= r.selfDuration;
        }
        if (!commitMember.has(r)) continue;
        const list = state.commits.get(r.commitId);
        if (!list || list[0] !== r) continue;
        list.shift();
        if (!list.length) {
          forgetCommit(r.commitId);
          const i = state.commitOrder.indexOf(r.commitId);
          if (i >= 0) state.commitOrder.splice(i, 1);
        }
      }
      if (totals.wasted < 0) totals.wasted = 0;
    }
    function flush() {
      flushScheduled = false;
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      let touchedSelected = false;
      let avoidableCount = 0;
      const touched = /* @__PURE__ */ new Set();
      for (const r of batch) {
        const node = ingest(r);
        touched.add(node);
        if (state.recording && state.recording.reports.length < MAX_REPORTS) state.recording.reports.push(r);
        if (r.avoidable) avoidableCount++;
        if (state.selectedKey === node.key) {
          touchedSelected = true;
          if (state.tab === "latest") state.selectedReport = r;
        }
      }
      for (const node of touched) trimNode(node);
      evict();
      dataGen++;
      renderStream(batch);
      renderSummary();
      const heavy = state.view === "commits" || state.view === "fixes" || state.tab === "root" || !!(state.recording && state.tab === "session");
      if (state.view === "tree") {
        renderTree();
        if (touchedSelected && !heavy) renderDetails();
      }
      scheduleHeavy(heavy || touchedSelected && state.view !== "tree");
      if (state.polling && avoidableCount) transport.badge?.(totals.avoidable);
    }
    let heavyAt = 0;
    let heavyTimer = null;
    let heavyDetailsPending = false;
    function renderHeavy(details2) {
      heavyAt = Date.now();
      if (state.view !== "tree") renderLeft();
      renderStrip();
      if (details2) renderDetails();
    }
    function scheduleHeavy(details2) {
      const wait = throttled() ? LEFT_RENDER_INTERVAL - (Date.now() - heavyAt) : 0;
      if (wait <= 0) {
        if (heavyTimer) clearTimeout(heavyTimer);
        heavyTimer = null;
        heavyDetailsPending = false;
        renderHeavy(details2);
        return;
      }
      heavyDetailsPending = heavyDetailsPending || details2;
      if (!heavyTimer) {
        heavyTimer = setTimeout(() => {
          heavyTimer = null;
          const d = heavyDetailsPending;
          heavyDetailsPending = false;
          renderHeavy(d);
        }, wait);
      }
    }
    function enqueue(report) {
      queue.push(report);
      if (!flushScheduled) {
        flushScheduled = true;
        schedule(flush);
      }
    }
    function clearAll() {
      state.tree.children.clear();
      state.nodesByKey.clear();
      state.reports = [];
      state.commits.clear();
      state.commitOrder = [];
      commitAnalyses.clear();
      totals.avoidable = 0;
      totals.wasted = 0;
      totals.perComponent.clear();
      bestFix = void 0;
      bestFixAt = 0;
      dataGen++;
      state.selectedKey = null;
      state.selectedReport = null;
      state.selectedCommit = null;
      state.selectedFix = null;
      state.selectedRoot = null;
      state.timeWindow = null;
      if (state.tab === "commit" || state.tab === "fixlist" || state.tab === "root") state.tab = "latest";
      queue = [];
      renderLeft();
      renderDetails();
      renderStream();
      renderSummary();
      renderStrip();
    }
    let filterCache = { filter: "", value: null, regex: null, text: "" };
    function parsedFilter() {
      if (filterCache.filter === state.filter) return filterCache;
      const f = state.filter.trim();
      const value = f.startsWith("~") ? f.slice(1).toLowerCase() : null;
      let regex = null;
      const m = value === null ? /^\/(.+)\/([a-z]*)$/.exec(f) : null;
      if (m && m[1] !== void 0) {
        try {
          regex = new RegExp(m[1], (m[2] || "").replace(/[gy]/g, ""));
        } catch {
        }
      }
      filterCache = { filter: state.filter, value, regex, text: f.toLowerCase() };
      return filterCache;
    }
    const valueQuery = () => parsedFilter().value;
    function matchesFilter(name) {
      const f = parsedFilter();
      if (!f.filter || f.value !== null) return true;
      if (f.regex) return f.regex.test(name);
      return name.toLowerCase().includes(f.text);
    }
    const valueCache = /* @__PURE__ */ new WeakMap();
    function matchesValues(r) {
      const q = valueQuery();
      if (q === null) return true;
      if (!q) return true;
      let text = valueCache.get(r);
      if (text === void 0) {
        try {
          text = JSON.stringify({ p: r.props.next, h: (r.hookState || []).map((x) => x.value), c: (r.contexts || []).map((x) => x.value), s: r.state ?? null }).toLowerCase();
        } catch {
          text = "";
        }
        valueCache.set(r, text);
      }
      return text.includes(q);
    }
    const inWindow = (r) => {
      const w = state.timeWindow;
      return !w || r.receivedAt >= w.from && r.receivedAt <= w.to;
    };
    const windowKey = () => {
      const w = state.timeWindow;
      return w ? `${w.from}-${w.to}` : "";
    };
    const NO_COUNTS = { total: 0, avoidable: 0 };
    let windowNodes = null;
    function nodeCounts(node) {
      if (!state.timeWindow) return node;
      const key = `${dataGen}|${windowKey()}|${state.byInstance}`;
      if (!windowNodes || windowNodes.key !== key) {
        const map = /* @__PURE__ */ new Map();
        for (const r of state.reports) {
          if (!inWindow(r)) continue;
          const k = nodeOfReport(r).key;
          let c = map.get(k);
          if (!c) map.set(k, c = { total: 0, avoidable: 0 });
          c.total++;
          if (r.avoidable) c.avoidable++;
        }
        windowNodes = { key, map };
      }
      return windowNodes.map.get(node.key) || NO_COUNTS;
    }
    function visible(node) {
      const c = nodeCounts(node);
      const own = (!state.avoidableOnly || c.avoidable > 0) && matchesFilter(node.name) && c.total > 0 && (valueQuery() === null || node.reports.some(matchesValues));
      if (own) return true;
      for (const child of node.children.values()) if (visible(child)) return true;
      return false;
    }
    const passes = (r) => inWindow(r) && (!state.avoidableOnly || r.avoidable) && matchesFilter(r.component) && matchesValues(r);
    let dataGen = 0;
    let filtered = { key: "", reports: [], fixes: null };
    function filteredReports() {
      const key = `${dataGen}|${state.avoidableOnly}|${state.filter}|${windowKey()}`;
      if (filtered.key !== key) filtered = { key, reports: state.reports.filter(passes), fixes: null };
      return filtered.reports;
    }
    function filteredFixes() {
      const reports = filteredReports();
      if (!filtered.fixes) filtered.fixes = rankFixes(reports);
      return filtered.fixes;
    }
    function setView(view) {
      state.view = view;
      for (const [id, b] of viewButtons) b.classList.toggle("active", id === view);
      tree.hidden = view !== "tree";
      table.hidden = view === "tree";
      renderLeft();
      renderDetails();
      persist();
    }
    let bars = [];
    const barEls = /* @__PURE__ */ new Map();
    const barNodes = () => [...stripBars.children];
    function renderStrip() {
      const order = state.commitOrder;
      const next = [];
      let max = 1;
      for (let i = Math.max(0, order.length - MAX_STRIP_BARS); i < order.length; i++) {
        const key = order[i];
        const reports = state.commits.get(key);
        if (!reports || !reports.length) continue;
        let avoidable = 0;
        let from = Infinity;
        let to = 0;
        for (const r of reports) {
          if (r.avoidable) avoidable++;
          if (r.receivedAt < from) from = r.receivedAt;
          if (r.receivedAt > to) to = r.receivedAt;
        }
        next.push({ key, total: reports.length, avoidable, from, to });
        if (reports.length > max) max = reports.length;
      }
      bars = next;
      if (!bars.length) {
        timeline.hidden = true;
        stripBars.textContent = "";
        barEls.clear();
        return;
      }
      timeline.hidden = false;
      const now = bars[bars.length - 1].to;
      const win = state.timeWindow;
      const live = /* @__PURE__ */ new Set();
      const frag = document.createDocumentFragment();
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        live.add(b.key);
        let node = barEls.get(b.key);
        if (!node) {
          node = el("button", { class: "bar", type: "button", "data-commit": String(b.key) }, [el("span", { class: "avoid" })]);
          barEls.set(b.key, node);
        }
        node.setAttribute("data-index", String(i));
        node.style.height = `${Math.max(MIN_BAR_PCT, Math.round(100 * Math.sqrt(b.total / max)))}%`;
        node.firstElementChild.style.height = `${Math.round(100 * b.avoidable / b.total)}%`;
        node.classList.toggle("has-avoid", b.avoidable > 0);
        node.classList.toggle("selected", state.selectedCommit === b.key && state.tab === "commit");
        node.classList.toggle("in-window", !!win && b.to >= win.from && b.from <= win.to);
        node.setAttribute("aria-label", `commit ${b.key}, ${plural(b.total, "render")}, ${b.avoidable} avoidable, ${spokenAgo(Math.max(0, now - b.to))}`);
        node.title = `#${b.key} \xB7 ${plural(b.total, "render")} \xB7 ${b.avoidable} avoidable`;
        frag.append(node);
      }
      stripBars.textContent = "";
      stripBars.append(frag);
      for (const key of [...barEls.keys()]) if (!live.has(key)) barEls.delete(key);
      const span = now - bars[0].from;
      stripFrom.textContent = span > 0 ? `-${fmtSpan(span)}` : "0ms";
      stripTo.textContent = "now";
      stripCount.textContent = plural(bars.length, "commit") + (order.length > bars.length ? ` of ${order.length}` : "");
      if (win) {
        let n = 0;
        for (const r of state.reports) if (inWindow(r)) n++;
        stripChip.textContent = `${fmtSpan(win.to - win.from)} window, ${plural(n, "report")} \xB7 Clear`;
        stripChip.hidden = false;
      } else stripChip.hidden = true;
    }
    function toggleStrip(value) {
      state.stripCollapsed = value === void 0 ? !state.stripCollapsed : value;
      timeline.classList.toggle("collapsed", state.stripCollapsed);
      stripChevron.textContent = state.stripCollapsed ? "\u25B8" : "\u25BE";
      if (value === void 0) persist();
    }
    function setWindow(from, to) {
      state.timeWindow = from <= to ? { from, to } : { from: to, to: from };
      afterWindowChange();
    }
    function clearWindow() {
      if (!state.timeWindow) return;
      state.timeWindow = null;
      afterWindowChange();
    }
    function afterWindowChange() {
      renderLeft();
      renderStream();
      renderDetails();
      renderStrip();
    }
    const barAt = (target) => {
      const node = target && typeof target.closest === "function" ? target.closest(".bar") : null;
      const i = node ? Number(node.getAttribute("data-index")) : -1;
      return Number.isInteger(i) && i >= 0 && i < bars.length ? i : -1;
    };
    let brush = null;
    let swallowClick = false;
    const paintBrush = () => {
      const lo = brush ? Math.min(brush.a, brush.b) : -1;
      const hi = brush ? Math.max(brush.a, brush.b) : -2;
      const nodes = barNodes();
      for (let i = 0; i < nodes.length; i++) nodes[i].classList.toggle("brushing", i >= lo && i <= hi);
    };
    stripBars.addEventListener("mousedown", (e) => {
      swallowClick = false;
      const i = barAt(e.target);
      if (i < 0) return;
      brush = { a: i, b: i };
    });
    stripBars.addEventListener("mousemove", (e) => {
      if (!brush) return;
      const i = barAt(e.target);
      if (i < 0 || i === brush.b) return;
      brush.b = i;
      paintBrush();
    });
    window.addEventListener("mouseup", (e) => {
      if (!brush) return;
      const i = barAt(e.target);
      if (i >= 0) brush.b = i;
      const { a, b } = brush;
      brush = null;
      paintBrush();
      if (a === b) return;
      swallowClick = true;
      setWindow(bars[Math.min(a, b)].from, bars[Math.max(a, b)].to);
    });
    stripBars.addEventListener("click", (e) => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      const i = barAt(e.target);
      if (i >= 0) selectCommitBar(bars[i].key);
    });
    stripBars.addEventListener("keydown", (e) => {
      swallowClick = false;
      const key = e.key;
      if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
      const nodes = barNodes();
      const i = nodes.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const to = key === "ArrowLeft" ? Math.max(0, i - 1) : key === "ArrowRight" ? Math.min(nodes.length - 1, i + 1) : key === "Home" ? 0 : nodes.length - 1;
      nodes[to].focus();
    });
    function selectCommitBar(key) {
      showCommit(key);
      if (state.view !== "commits") setView("commits");
      renderStrip();
    }
    function renderLeft() {
      if (state.view === "tree") renderTree();
      else if (state.view === "offenders") renderOffenders();
      else if (state.view === "commits") renderCommits();
      else if (state.view === "sessions") renderSessions();
      else renderFixes();
    }
    const rowEls = /* @__PURE__ */ new Map();
    const treeList = virtualList(tree, ROW_H, ({ node, depth }) => rowFor(node, depth));
    const emptyEl = el("div", { class: "empty" });
    function trackingSentence(t) {
      const what = t.mode === "all" ? "Tracking every component" : t.mode === "memoized" ? "Tracking every React.memo and PureComponent" : "Tracking only components marked with track()";
      const parts = [what];
      if (t.include.length) parts.push(`${t.mode === "marked" ? "and" : "plus"} names matching ${t.include.join(", ")}`);
      if (t.exclude.length) parts.push(`except ${t.exclude.join(", ")}`);
      const rendered = `${t.renderedCount}${t.overflow ? "+" : ""} component${t.renderedCount === 1 ? "" : "s"} rendered`;
      return `${parts.join(", ")}; ${rendered}, ${t.trackedCount} of them tracked.`;
    }
    function renderEmpty() {
      emptyEl.textContent = "";
      emptyEl.append(el("div", { class: "empty-head", text: "No re-renders reported yet." }));
      const t = state.library?.tracking;
      if (!t) {
        emptyEl.append(
          el("div", null, ["Call ", el("code", { text: "init({ notifier: createDevtoolsNotifier() })" }), " in the page, or enable injection in Settings, then interact with it."])
        );
        return;
      }
      emptyEl.append(el("div", { class: "empty-tracking", text: trackingSentence(t) }));
      if (t.mode === "all") {
        emptyEl.append(el("div", { text: "Every component is tracked, so this is waiting for a re-render: interact with the page. The first render of a component is never reported." }));
        return;
      }
      const untracked = t.renderedCount - t.trackedCount;
      emptyEl.append(
        el("div", {
          text: untracked > 0 ? `${untracked} component${untracked === 1 ? "" : "s"} rendered without being tracked. Widen what is tracked, or interact with the page if the tracked ones simply have not re-rendered yet.` : "Interact with the page: the first render of a component is never reported, only re-renders."
        })
      );
      if (!transport.configure) return;
      const trackAll = el("button", { class: "primary", onclick: () => void applyTracking({ trackAllComponents: true }) }, "Track every component");
      const match = el("input", { class: "empty-match", type: "text", placeholder: "Name or /regex/", "aria-label": "Track components matching" });
      const addMatch = () => {
        const value = match.value.trim();
        if (!value) return;
        const include = (state.library?.tracking?.include || []).slice();
        if (!include.includes(value)) include.push(value);
        match.value = "";
        void applyTracking({ include });
      };
      match.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addMatch();
      });
      emptyEl.append(
        el("div", { class: "empty-actions" }, [trackAll, match, el("button", { onclick: addMatch }, "Track components matching\u2026")])
      );
    }
    async function applyTracking(patch) {
      if (!transport.configure) return;
      try {
        const applied = await transport.configure(patch);
        if (state.library) {
          if (applied) state.library.options = applied;
          const t = state.library.tracking;
          if (t) {
            if (patch.trackAllComponents) t.mode = "all";
            if (patch.include) t.include = patch.include;
          }
          transport.storage?.set("settings", Object.assign({}, state.library.options));
        }
        toast("Applied");
        renderTree();
      } catch (e) {
        toast(`Failed: ${e.message}`);
      }
    }
    function renderTree() {
      const flat = [];
      const walk = (node, depth) => {
        for (const child of node.children.values()) {
          if (!visible(child)) continue;
          flat.push({ node: child, depth });
          if (child.expanded) walk(child, depth + 1);
        }
      };
      walk(state.tree, 0);
      if (flat.length === 0) {
        renderEmpty();
        if (!emptyEl.parentNode) tree.append(emptyEl);
      } else emptyEl.remove();
      if (rowEls.size > flat.length * 2 + 64) {
        const live = new Set(flat.map((f) => f.node.key));
        for (const key of [...rowEls.keys()]) if (!live.has(key)) rowEls.delete(key);
      }
      treeList.setItems(flat);
    }
    function hoverHighlight(node, on) {
      const r = node.lastReport;
      if (!r || !r.instanceId) return;
      transport.highlight?.(on ? r.instanceId : null);
    }
    function rowFor(node, depth) {
      let row = rowEls.get(node.key);
      if (!row) {
        const created = el("div", {
          class: "row",
          "data-key": node.key,
          role: "treeitem",
          onclick: () => select(node),
          onmouseenter: () => hoverHighlight(node, true),
          onmouseleave: () => hoverHighlight(node, false),
          onanimationend: () => created.classList.remove("flash")
        });
        created.append(el("span", { class: "indent" }));
        created.append(
          el("span", {
            class: "chevron",
            onclick: (e) => {
              e.stopPropagation();
              toggleExpanded(node);
            }
          })
        );
        created.append(
          el("span", { class: "tag" }, [el("span", { class: "bracket", text: "<" }), el("span", { class: "name", text: node.name }), el("span", { class: "bracket", text: ">" })])
        );
        created.append(el("span", { class: "badges" }));
        rowEls.set(node.key, created);
        row = created;
      }
      row.classList.toggle("selected", state.selectedKey === node.key);
      row.setAttribute("aria-selected", state.selectedKey === node.key ? "true" : "false");
      row.setAttribute("aria-level", String(depth + 1));
      const indent = row.querySelector(".indent");
      if (indent.childElementCount !== depth) {
        indent.textContent = "";
        for (let i = 0; i < depth; i++) indent.append(el("span", { class: "guide" }));
      }
      const hasChildren = [...node.children.values()].some(visible);
      const chevron = row.querySelector(".chevron");
      chevron.classList.toggle("leaf", !hasChildren);
      chevron.textContent = node.expanded ? "\u25BE" : "\u25B8";
      const badges = row.querySelector(".badges");
      badges.textContent = "";
      const counts = nodeCounts(node);
      if (counts.avoidable) badges.append(el("span", { class: "badge avoid", title: "avoidable re-renders", text: String(counts.avoidable) }));
      if (counts.total) badges.append(el("span", { class: "badge", title: "re-renders", text: String(counts.total) }));
      if (node.flash) {
        node.flash = false;
        if (Date.now() - (node.flashAt || 0) < 1e3) {
          row.classList.remove("flash");
          void row.offsetWidth;
          row.classList.add("flash");
        }
      }
      return row;
    }
    function toggleExpanded(node, value) {
      node.expanded = value === void 0 ? !node.expanded : value;
      if (node.expanded) state.collapsed.delete(node.key);
      else state.collapsed.add(node.key);
      renderTree();
      persist();
    }
    function select(node, report) {
      state.selectedKey = node.key;
      state.selectedReport = report || node.lastReport || null;
      if (report && state.tab !== "fix") state.tab = "latest";
      if (state.tab === "commit" || state.tab === "fixlist" || state.tab === "root") state.tab = "latest";
      renderLeft();
      renderDetails();
      if (state.view === "tree") {
        const idx = treeList.items.findIndex((f) => f.node.key === node.key);
        if (idx >= 0) treeList.scrollTo(idx);
      }
    }
    function onTreeKey(e) {
      const rows = treeList.items;
      if (!rows.length) return;
      const idx = rows.findIndex((f) => f.node.key === state.selectedKey);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        select(rows[Math.min(rows.length - 1, idx + 1)].node);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        select(rows[Math.max(0, idx - 1)].node);
      } else if (e.key === "ArrowRight" && idx >= 0) {
        toggleExpanded(rows[idx].node, true);
      } else if (e.key === "ArrowLeft" && idx >= 0) {
        toggleExpanded(rows[idx].node, false);
      }
    }
    function onGlobalKey(e) {
      const target = e.target;
      const inField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (e.key === "Escape") {
        transport.highlight?.(null);
        if (state.settingsOpen && settings.contains(target)) {
          toggleSettings(false);
          return;
        }
        if (inField) {
          target.blur();
          return;
        }
        clearWindow();
        return;
      }
      if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        search.focus();
        search.select();
      } else if (e.key === "f" && state.selectedKey) {
        e.preventDefault();
        state.tab = "fix";
        renderDetails();
        persist();
      }
    }
    function sortableHeader(label, key, numeric = false) {
      const active = state.sort.key === key;
      return el(
        "th",
        {
          class: (active ? "sorted " : "") + (numeric ? "num" : ""),
          onclick: () => {
            state.sort = { key, dir: active ? -state.sort.dir : numeric ? -1 : 1 };
            renderLeft();
          }
        },
        label + (active ? state.sort.dir < 0 ? " \u25BE" : " \u25B4" : "")
      );
    }
    function offenderRows() {
      const byName = /* @__PURE__ */ new Map();
      for (const r of filteredReports()) {
        let o = byName.get(r.component);
        if (!o) {
          o = { component: r.component, total: 0, avoidable: 0, wasted: 0, paths: /* @__PURE__ */ new Set(), reports: [], fix: "" };
          byName.set(r.component, o);
        }
        o.total++;
        if (r.avoidable) {
          o.avoidable++;
          if (typeof r.selfDuration === "number") o.wasted += r.selfDuration;
        }
        o.paths.add(keyOf(r.path));
        o.reports.push(r);
      }
      const rows = [...byName.values()];
      for (const o of rows) {
        const fixes = o.avoidable ? rankFixes(o.reports) : [];
        o.fix = fixes.length ? fixes[0].label : "";
      }
      const { key, dir } = state.sort;
      rows.sort((a, b) => {
        const va = a[key];
        const vb = b[key];
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return c * dir || b.avoidable - a.avoidable;
      });
      return rows;
    }
    function offenderRow(o) {
      return el(
        "tr",
        {
          class: o.avoidable ? "has-avoid" : "",
          onclick: () => {
            const last = o.reports[o.reports.length - 1];
            state.tab = "fix";
            select(nodeOfReport(last), last);
          }
        },
        [
          el("td", { class: "c" }, [el("span", { class: "name", text: o.component }), o.paths.size > 1 ? el("span", { class: "meta", text: ` \xD7${o.paths.size} places` }) : null]),
          el("td", { class: "num" }, o.avoidable ? el("span", { class: "badge avoid", text: String(o.avoidable) }) : "0"),
          el("td", { class: "num", text: String(o.total) }),
          el("td", { class: "num", text: o.wasted ? fmtMs(o.wasted) : "" }),
          el("td", { class: "fix", text: o.fix })
        ]
      );
    }
    function renderOffenders() {
      table.textContent = "";
      const rows = offenderRows();
      if (!rows.length) {
        table.append(el("div", { class: "empty", text: "No re-renders reported yet." }));
        return;
      }
      const t = el("table", { class: "grid" });
      t.append(el("thead", null, el("tr", null, [sortableHeader("Component", "component"), sortableHeader("Avoidable", "avoidable", true), sortableHeader("Total", "total", true), sortableHeader("Wasted", "wasted", true), el("th", { text: "Top fix" })])));
      const body = el("tbody");
      for (const o of rows) body.append(offenderRow(o));
      t.append(body);
      table.append(t);
    }
    function commitSummaries() {
      const out = [];
      for (let i = state.commitOrder.length - 1; i >= 0; i--) {
        const key = state.commitOrder[i];
        const reports = state.commits.get(key);
        if (!reports || !reports.some(passes)) continue;
        out.push({ key, analysis: analysisFor(key, reports) });
      }
      return out;
    }
    function showCommit(key) {
      state.selectedCommit = key;
      state.tab = "commit";
      renderLeft();
      renderDetails();
      renderStrip();
    }
    function showRoot(name) {
      state.selectedRoot = name;
      state.tab = "root";
      renderDetails();
    }
    function renderCommits() {
      table.textContent = "";
      const items = commitSummaries();
      if (!items.length) {
        table.append(el("div", { class: "empty", text: "No commits yet." }));
        return;
      }
      const list = el("ul", { class: "commits" });
      for (const { key, analysis } of items) {
        const root2 = analysis.roots[0];
        list.append(
          el("li", { class: (state.selectedCommit === key && state.tab === "commit" ? "selected " : "") + (analysis.avoidable ? "has-avoid" : ""), onclick: () => showCommit(key) }, [
            el("span", { class: "id", text: `#${key}` }),
            el("span", { class: "t", text: fmtTime(analysis.receivedAt) }),
            el("span", { class: "n", text: plural(analysis.total, "render") }),
            analysis.avoidable ? el("span", { class: "badge avoid", text: `${analysis.avoidable} avoidable` }) : el("span", { class: "badge", text: "ok" }),
            analysis.reports[0]?.commitPriority ? el("span", { class: "prio " + analysis.reports[0].commitPriority, title: "commit priority", text: PRIORITY_LABEL[analysis.reports[0].commitPriority] || analysis.reports[0].commitPriority }) : null,
            analysis.reports[0]?.commitCause === "effect-after-commit" ? el("span", { class: "cause effect", title: "state set right after the previous commit (effect \u2192 setState)", text: `effect loop \u2190 #${analysis.reports[0].afterCommit ?? "?"}` }) : analysis.reports[0]?.commitCause === "suspense-resolved" ? el("span", { class: "cause suspense", text: "suspense resolved" }) : null,
            el("span", {
              class: "root",
              text: root2 ? `\u2190 <${root2.name}> (${root2.trigger})` : analysis.reports[0]?.updaters?.length ? `\u2190 set by ${analysis.reports[0].updaters.map((u) => `<${u}>`).join(", ")}` : ""
            })
          ])
        );
      }
      table.append(list);
    }
    function fixItem(f) {
      const selected = state.selectedFix === f.key && state.tab === "fixlist";
      return el(
        "li",
        {
          class: selected ? "selected" : "",
          "aria-selected": selected ? "true" : null,
          onclick: () => {
            state.selectedFix = f.key;
            state.tab = "fixlist";
            renderLeft();
            renderDetails();
          }
        },
        [
          el("span", { class: "badge avoid", title: "avoidable re-renders removed", text: String(f.count) }),
          el("span", { class: "label", text: f.label }),
          el("span", { class: "meta", text: componentList(f.components) })
        ]
      );
    }
    function renderFixes() {
      table.textContent = "";
      const reports = filteredReports();
      const fixes = filteredFixes();
      const contexts = contextAttribution(reports);
      if (!fixes.length && !contexts.length) {
        table.append(el("div", { class: "empty", text: "No avoidable re-renders, nothing to fix." }));
        return;
      }
      if (fixes.length) {
        const list = el("ol", { class: "fixes", role: "list" });
        for (const f of fixes) list.append(fixItem(f));
        table.append(el("div", { class: "section-title", text: "Ranked by avoidable re-renders removed" }), list);
      }
      if (contexts.length) {
        const list = el("ul", { class: "contexts" });
        for (const c of contexts) {
          const partial = c.changedKeys.size > 0 && c.totalKeys > c.changedKeys.size;
          list.append(
            el("li", null, [
              el("span", { class: "name", text: c.name }),
              c.providers.size ? el("span", { class: "meta", text: ` (provided by ${componentList(c.providers)})` }) : null,
              el("span", {
                class: "meta",
                text: ` changed in ${plural(c.commits.size, "commit")}, ${plural(c.consumers, "consumer re-render")}${c.avoidable ? `, ${c.avoidable} with an equal value` : ""}: ${componentList(c.components)}`
              }),
              partial ? el("div", { class: "meta hint", text: `only ${[...c.changedKeys].join(", ")} of ${c.totalKeys} keys changed: consumers of the other keys re-render for nothing. Split the context or select slices.` }) : null
            ])
          );
        }
        table.append(el("div", { class: "section-title", text: "Contexts" }), list);
      }
    }
    function renderDetails() {
      const openLabels = new Set([...details.querySelectorAll("details.obj[open] > summary")].map((x) => x.textContent));
      details.textContent = "";
      if (state.tab === "commit" && state.selectedCommit !== null) renderCommitDetails();
      else if (state.tab === "fixlist" && state.selectedFix) renderFixDetails();
      else if (state.tab === "root" && state.selectedRoot) renderRootDetails();
      else if (state.tab === "session" && state.selectedSession) renderSessionDetails();
      else renderNodeDetails(state.selectedKey ? state.nodesByKey.get(state.selectedKey) ?? null : null);
      if (openLabels.size) {
        for (const d of details.querySelectorAll("details.obj")) {
          if (openLabels.has(d.querySelector("summary").textContent)) d.open = true;
        }
      }
    }
    const reportActions = () => ({
      openSource: transport.openResource ? (src) => transport.openResource(src.fileName, src.lineNumber, src.columnNumber) : null,
      highlight: transport.highlight ? (id) => transport.highlight(id) : null,
      copy: copyText,
      readSource: transport.readSource ? (url) => transport.readSource(url) : null
    });
    const tabButton = (id, label, onclick) => el("button", { class: state.tab === id ? "active" : "", onclick }, label);
    function renderNodeDetails(node) {
      if (!node) {
        details.append(el("div", { class: "empty", text: "Select a component to see why it re-rendered." }));
        return;
      }
      const header = el("div", { class: "details-header" }, [
        el("span", { class: "title" }, [el("span", { class: "bracket", text: "<" }), el("span", { class: "name", text: node.name }), el("span", { class: "bracket", text: ">" })]),
        el("span", { class: "meta", text: `${plural(node.total, "re-render")}, ${node.avoidable} avoidable${node.wasted ? ", " + fmtMs(node.wasted) + " wasted" : ""}` }),
        el("span", { class: "tabs" }, [
          tabButton("latest", "Report", () => {
            state.tab = "latest";
            state.selectedReport = node.lastReport ?? null;
            renderDetails();
            persist();
          }),
          tabButton("history", `History (${node.reports.length})`, () => {
            state.tab = "history";
            renderDetails();
            persist();
          }),
          tabButton("fix", "Fix", () => {
            state.tab = "fix";
            renderDetails();
            persist();
          })
        ])
      ]);
      details.append(header);
      const body = el("div", { class: "details-body" });
      details.append(body);
      if (state.tab === "history") {
        const list = el("ul", { class: "history" });
        for (const r2 of [...node.reports].reverse()) {
          list.append(
            el(
              "li",
              {
                class: state.selectedReport === r2 ? "selected" : "",
                onclick: () => {
                  state.selectedReport = r2;
                  state.tab = "latest";
                  renderDetails();
                }
              },
              [
                el("span", { class: "t", text: fmtTime(r2.receivedAt) }),
                el("span", { class: "n", text: "#" + r2.renderCount }),
                el("span", { class: "verdict " + (r2.avoidable ? "avoid" : "ok"), text: r2.avoidable ? "avoidable" : r2.trigger }),
                el("span", { class: "sum", text: summarize(r2) })
              ]
            )
          );
        }
        body.append(list);
        return;
      }
      if (state.tab === "fix") {
        body.append(fixView(rankFixes(node.reports), { copy: copyText }));
        return;
      }
      const r = state.selectedReport || node.lastReport;
      if (!r) return;
      body.append(reportView(r, reportActions()));
    }
    function rootsList(roots) {
      return el(
        "ul",
        { class: "roots" },
        roots.map(
          (root2) => el("li", null, [
            el("a", { class: "root-link", href: "#", title: "Every commit this component started", onclick: (e) => (e.preventDefault(), showRoot(root2.name)) }, `<${root2.name}>`),
            ` (${root2.trigger}) \u2192 ${plural(root2.count, "avoidable re-render")}: `,
            el("span", { class: "meta", text: componentList(root2.components) })
          ])
        )
      );
    }
    function renderCommitDetails() {
      const key = state.selectedCommit;
      const reports = state.commits.get(key);
      if (!reports) {
        details.append(el("div", { class: "empty", text: "This commit is no longer buffered." }));
        return;
      }
      const a = analysisFor(key, reports);
      details.append(
        el("div", { class: "details-header" }, [
          el("span", { class: "title", text: `Commit #${key}` }),
          el("span", { class: "meta", text: `${plural(a.total, "render")}, ${a.avoidable} avoidable${a.wasted ? ", " + fmtMs(a.wasted) + " wasted" : ""} \xB7 ${fmtTime(a.receivedAt)}` })
        ])
      );
      const body = el("div", { class: "details-body" });
      details.append(body);
      if (a.roots.length) body.append(el("div", { class: "section" }, [el("h3", { text: "Root causes" }), rootsList(a.roots)]));
      if (a.contexts.length) {
        body.append(
          el("div", { class: "section" }, [
            el("h3", { text: "Contexts that changed" }),
            el("ul", { class: "roots" }, a.contexts.map((c) => el("li", null, [el("b", { text: c.name }), ` \u2192 ${plural(c.consumers, "consumer")} re-rendered${c.avoidable ? ` (${c.avoidable} with an equal value)` : ""}`])))
          ])
        );
      }
      const cascade = el("div", { class: "cascade" });
      const walk = (node, depth) => {
        for (const child of node.children.values()) {
          const r = child.report;
          const line = el(
            "div",
            {
              class: "cascade-row" + (r ? r.avoidable ? " avoid" : " ok" : " untracked"),
              style: `padding-left:${depth * 14}px`,
              onclick: r ? () => select(nodeOfReport(r), r) : null
            },
            [
              el("span", { class: "tag" }, [el("span", { class: "bracket", text: "<" }), el("span", { class: "name", text: child.name }), el("span", { class: "bracket", text: ">" })]),
              r ? el("span", { class: "verdict " + (r.avoidable ? "avoid" : "ok"), text: r.avoidable ? "avoidable" : r.trigger }) : el("span", { class: "meta", text: "did not render or untracked" }),
              child.count && child.count > 1 ? el("span", { class: "meta", text: ` \xD7${child.count}` }) : null,
              r && r.avoidable ? el("span", { class: "meta", text: " " + summarize(r) }) : null
            ]
          );
          cascade.append(line);
          walk(child, depth + 1);
        }
      };
      walk(cascadeTree(reports), 0);
      body.append(el("div", { class: "section" }, [el("h3", { text: "Render cascade" }), cascade]));
      if (a.fixes.length) {
        body.append(el("div", { class: "section-title", text: "Fixes for this commit" }));
        body.append(fixView(a.fixes, { copy: copyText }));
      }
    }
    function affectedList(reports) {
      const list = el("ul", { class: "history" });
      for (const r of reports.slice().reverse()) {
        list.append(
          el("li", { onclick: () => select(nodeOfReport(r), r) }, [
            el("span", { class: "t", text: fmtTime(r.receivedAt) }),
            el("span", { class: "comp", text: `<${r.component}>` }),
            el("span", { class: "sum", text: summarize(r) })
          ])
        );
      }
      return list;
    }
    function renderFixDetails() {
      const fix = filteredFixes().find((f) => f.key === state.selectedFix);
      if (!fix) {
        details.append(el("div", { class: "empty", text: "Select a fix." }));
        return;
      }
      details.append(el("div", { class: "details-header" }, [el("span", { class: "title", text: fix.label }), el("span", { class: "meta", text: `removes ${plural(fix.count, "avoidable re-render")}` })]));
      const body = el("div", { class: "details-body" });
      details.append(body);
      body.append(fixView([fix], { copy: copyText }));
      body.append(el("div", { class: "section" }, [el("h3", { text: "Affected re-renders" }), affectedList(fix.reports)]));
    }
    function renderRootDetails() {
      const name = state.selectedRoot;
      const s = rootCauseSummary2(name, state.commits, analysisFor);
      details.append(
        el("div", { class: "details-header" }, [
          el("span", { class: "title" }, ["Root cause ", el("span", { class: "name", text: `<${name}>` })]),
          el("span", { class: "meta", text: s.commits.length ? `started ${plural(s.commits.length, "commit")} with ${plural(s.total, "avoidable re-render")} (${s.trigger})` : "no commits in the buffer" })
        ])
      );
      const body = el("div", { class: "details-body" });
      details.append(body);
      if (!s.commits.length) return;
      body.append(el("div", { class: "section" }, [el("h3", { text: "Components that re-rendered avoidably because of it" }), el("div", { class: "meta", text: componentList(s.components) })]));
      const list = el("ul", { class: "commits root-commits" });
      for (const c of s.commits) {
        list.append(
          el("li", { onclick: () => showCommit(c.key) }, [
            el("span", { class: "id", text: `#${c.key}` }),
            el("span", { class: "t", text: fmtTime(c.analysis.receivedAt) }),
            el("span", { class: "badge avoid", text: `${c.count} avoidable` }),
            el("span", { class: "root", text: componentList(c.components) })
          ])
        );
      }
      body.append(el("div", { class: "section" }, [el("h3", { text: "Commits" }), list]));
      if (s.fixes.length) {
        body.append(el("div", { class: "section-title", text: "Fixes" }));
        body.append(fixView(s.fixes, { copy: copyText }));
      }
    }
    const sessionSummary = (s) => summarizeSession(s, s.reports);
    function persistSessions() {
      if (!transport.storage) return;
      const summaries = state.sessions.filter((s) => s.endedAt).slice(-20).map(sessionSummary);
      transport.storage.set("sessions", summaries);
    }
    function startRecording(name) {
      if (state.recording) stopRecording();
      const startedAt = Date.now();
      const session = {
        id: `s${startedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name || `Session ${state.sessions.length + 1}`,
        startedAt,
        endedAt: null,
        total: 0,
        avoidable: 0,
        wasted: 0,
        byComponent: {},
        fixes: [],
        reports: []
      };
      state.sessions.push(session);
      state.recording = session;
      recordBtn.classList.add("active", "rec");
      recordBtn.querySelector(".glyph").textContent = "\u23F9";
      recordBtn.querySelector(".label").textContent = "Stop";
      state.selectedSession = session.id;
      state.tab = "session";
      if (state.view === "sessions") renderLeft();
      renderDetails();
      toast(`Recording ${session.name}`);
      return session;
    }
    function stopRecording() {
      const session = state.recording;
      if (!session) return null;
      session.endedAt = Date.now();
      Object.assign(session, sessionSummary(session), { reports: session.reports });
      state.recording = null;
      recordBtn.classList.remove("active", "rec");
      recordBtn.querySelector(".glyph").textContent = "\u23FA";
      recordBtn.querySelector(".label").textContent = "Record";
      persistSessions();
      if (state.view === "sessions") renderLeft();
      if (state.tab === "session") renderDetails();
      toast(`${session.name}: ${plural(session.avoidable, "avoidable re-render")}`);
      return session;
    }
    const fmtDuration = (s) => {
      const ms = (s.endedAt || Date.now()) - s.startedAt;
      return ms < 6e4 ? `${(ms / 1e3).toFixed(ms < 1e4 ? 1 : 0)} s` : `${Math.round(ms / 6e4)} min`;
    };
    function renderSessions() {
      table.textContent = "";
      if (!state.sessions.length) {
        table.append(
          el("div", { class: "empty" }, [
            el("div", { text: "No sessions yet." }),
            el("div", null, ["Press ", el("code", { text: "Record" }), ", use the app, press ", el("code", { text: "Stop" }), ". Apply a fix, record again, and compare the two."])
          ])
        );
        return;
      }
      const list = el("ul", { class: "sessions" });
      for (const s of [...state.sessions].reverse()) {
        const live = s === state.recording;
        const summary2 = live ? sessionSummary(s) : s;
        list.append(
          el(
            "li",
            {
              class: (state.selectedSession === s.id && state.tab === "session" ? "selected " : "") + (live ? "live" : ""),
              onclick: () => {
                state.selectedSession = s.id;
                state.tab = "session";
                renderLeft();
                renderDetails();
              }
            },
            [
              el("span", { class: "name", text: s.name }),
              live ? el("span", { class: "badge rec", text: "recording" }) : el("span", { class: "t", text: fmtDuration(summary2) }),
              el("span", { class: "n", text: plural(summary2.total, "render") }),
              summary2.avoidable ? el("span", { class: "badge avoid", text: `${summary2.avoidable} avoidable` }) : el("span", { class: "badge", text: "clean" }),
              summary2.wasted ? el("span", { class: "meta", text: fmtMs(summary2.wasted) }) : null
            ]
          )
        );
      }
      table.append(list);
    }
    function deltaCell(n, suffix = "", decimals) {
      const cls = n < 0 ? "good" : n > 0 ? "bad" : "";
      const value = decimals !== void 0 ? n.toFixed(decimals) : Number.isInteger(n) ? String(n) : n.toFixed(1);
      return el("td", { class: "num delta " + cls, text: n === 0 ? "\xB10" : `${n > 0 ? "+" : ""}${value}${suffix}` });
    }
    function renderSessionDetails() {
      const session = state.sessions.find((s) => s.id === state.selectedSession);
      if (!session) {
        details.append(el("div", { class: "empty", text: "Select a session." }));
        return;
      }
      const live = session === state.recording;
      const summary2 = live ? sessionSummary(session) : session;
      const nameInput = el("input", { type: "text", class: "session-name", value: session.name, title: "Rename" });
      nameInput.addEventListener("change", () => {
        session.name = nameInput.value.trim() || session.name;
        nameInput.value = session.name;
        persistSessions();
        if (state.view === "sessions") renderLeft();
      });
      details.append(
        el("div", { class: "details-header" }, [
          nameInput,
          el("span", { class: "meta", text: `${live ? "recording \xB7 " : ""}${fmtDuration(summary2)} \xB7 ${plural(summary2.total, "render")}, ${summary2.avoidable} avoidable${summary2.wasted ? ", " + fmtMs(summary2.wasted) + " wasted" : ""}` }),
          live ? el("button", { class: "ib", onclick: () => stopRecording() }, "\u23F9 Stop") : null
        ])
      );
      const body = el("div", { class: "details-body" });
      details.append(body);
      const others = state.sessions.filter((s) => s !== session && s.endedAt);
      const compareSec = el("div", { class: "section compare" }, [el("h3", { text: "Compare" })]);
      if (!others.length) {
        compareSec.append(el("div", { class: "meta", text: "Record a second session (after a fix) to compare against this one." }));
      } else {
        const select2 = el("select", { class: "compare-select" });
        select2.append(el("option", { value: "", text: "Compare with\u2026" }));
        for (const o of others) select2.append(el("option", { value: o.id, text: o.name }));
        const baseline = state.compareWith && others.some((o) => o.id === state.compareWith) ? state.compareWith : others[others.length - 1].id;
        select2.value = baseline;
        select2.addEventListener("change", () => {
          state.compareWith = select2.value || null;
          renderDetails();
        });
        compareSec.append(el("div", { class: "meta" }, ["Baseline: ", select2, " \u2192 this session"]));
        const before = others.find((o) => o.id === baseline);
        const cmp = compareSessions(before, summary2);
        const t = el("table", { class: "grid compare-grid" });
        t.append(el("thead", null, el("tr", null, [el("th", { text: "Avoidable re-renders" }), el("th", { class: "num", text: before.name }), el("th", { class: "num", text: summary2.name }), el("th", { class: "num", text: "\u0394" })])));
        const tb = el("tbody");
        const totalRow = el("tr", { class: "total" }, [el("td", { text: "All components" }), el("td", { class: "num", text: String(cmp.avoidable.before) }), el("td", { class: "num", text: String(cmp.avoidable.after) })]);
        totalRow.append(deltaCell(cmp.avoidable.delta));
        tb.append(totalRow);
        if (cmp.wasted.before || cmp.wasted.after) {
          const w = el("tr", { class: "total" }, [el("td", { text: "Wasted time" }), el("td", { class: "num", text: fmtMs(cmp.wasted.before) }), el("td", { class: "num", text: fmtMs(cmp.wasted.after) })]);
          w.append(deltaCell(cmp.wasted.delta, " ms", 1));
          tb.append(w);
        }
        for (const row of cmp.rows) {
          const tr = el("tr", null, [el("td", { class: "c" }, el("span", { class: "name", text: row.component })), el("td", { class: "num", text: String(row.before) }), el("td", { class: "num", text: String(row.after) })]);
          tr.append(deltaCell(row.delta));
          tb.append(tr);
        }
        t.append(tb);
        compareSec.append(t);
        if (cmp.resolvedFixes.length) compareSec.append(el("div", { class: "meta" }, [el("b", { text: "No longer needed: " }), cmp.resolvedFixes.map((f) => f.label).join(" \xB7 ")]));
        if (cmp.newFixes.length) compareSec.append(el("div", { class: "meta" }, [el("b", { text: "New: " }), cmp.newFixes.map((f) => f.label).join(" \xB7 ")]));
      }
      body.append(compareSec);
      const comps = Object.entries(summary2.byComponent).sort((a, b) => b[1].avoidable - a[1].avoidable || b[1].total - a[1].total);
      if (comps.length) {
        const t = el("table", { class: "grid" });
        t.append(el("thead", null, el("tr", null, [el("th", { text: "Component" }), el("th", { class: "num", text: "Avoidable" }), el("th", { class: "num", text: "Total" }), el("th", { class: "num", text: "Wasted" })])));
        const tb = el("tbody");
        for (const [name, c] of comps.slice(0, 50)) {
          tb.append(
            el("tr", { onclick: () => panelApi.select(name) }, [
              el("td", { class: "c" }, el("span", { class: "name", text: name })),
              el("td", { class: "num" }, c.avoidable ? el("span", { class: "badge avoid", text: String(c.avoidable) }) : "0"),
              el("td", { class: "num", text: String(c.total) }),
              el("td", { class: "num", text: c.wasted ? fmtMs(c.wasted) : "" })
            ])
          );
        }
        t.append(tb);
        body.append(el("div", { class: "section" }, [el("h3", { text: "Components in this session" }), t]));
      }
      if (summary2.fixes.length) {
        body.append(el("div", { class: "section" }, [el("h3", { text: "Fixes suggested" }), el("ol", { class: "fix-list" }, summary2.fixes.slice(0, 10).map((f) => el("li", null, [el("span", { class: "badge avoid", text: String(f.count) }), " ", el("span", { class: "mono", text: f.label })])))]));
      }
    }
    const itemEls = /* @__PURE__ */ new WeakMap();
    const streamItems = virtualList(streamList, ITEM_H, (r) => {
      let li = itemEls.get(r);
      if (!li) {
        li = el("div", { class: "stream-item", onclick: () => select(nodeOfReport(r), r) }, [
          el("span", { class: "t", text: fmtTime(r.receivedAt) }),
          el("span", { class: "c", text: r.component }),
          el("span", { class: "v " + (r.avoidable ? "avoid" : "ok"), text: r.avoidable ? "avoidable" : r.trigger }),
          el("span", { class: "s", text: summarize(r) })
        ]);
        itemEls.set(r, li);
      }
      return li;
    });
    let streamShown = [];
    function renderStream(batch) {
      if (batch) {
        const fresh = batch.filter(passes).reverse();
        if (fresh.length) streamShown = fresh.concat(streamShown);
        if (streamShown.length > MAX_REPORTS) streamShown.length = MAX_REPORTS;
      } else {
        streamShown = filteredReports().reverse();
      }
      streamCount.textContent = plural(streamShown.length, "report");
      streamItems.setItems(streamShown);
    }
    function exportJson() {
      const data = {
        rerenderLens: true,
        version: PROTOCOL,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        origin: state.origin,
        reports: state.reports,
        sessions: state.sessions.filter((s) => s.endedAt).map(sessionSummary)
      };
      const text = JSON.stringify(data, null, 2);
      const name = `rerender-lens-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
      try {
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      } catch {
        copyText(text);
      }
    }
    function importData(data) {
      const reports = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.reports) ? data.reports : null;
      if (!reports) throw new Error("not a rerender-lens export");
      clearAll();
      if (isRecord(data) && Array.isArray(data.sessions)) restoreSessions(data.sessions);
      let n = 0;
      for (const p of reports) {
        const r = normalizeReport(p);
        if (r) {
          enqueue(r);
          n++;
        }
      }
      flush();
      toast(`Imported ${plural(n, "report")}`);
      return n;
    }
    function importFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importData(JSON.parse(String(reader.result)));
        } catch (e) {
          toast(`Import failed: ${e.message}`);
        }
      };
      reader.readAsText(file);
    }
    function renderStatus() {
      const lib = state.library;
      let text;
      let cls = "none";
      let title = "";
      if (lib) {
        const react = lib.react && lib.react[0];
        text = `connected \xB7 lib ${lib.library || "?"}${react && react.version ? ` \xB7 React ${react.version}` : ""}${lib.production ? " (prod)" : ""}`;
        cls = "connected";
        title = state.relay ? "live via content script" : "polling the page";
        if (lib.overhead) title += ` \xB7 library overhead ${lib.overhead.totalMs.toFixed(1)} ms over ${plural(lib.commits ?? 0, "commit")}, worst ${lib.overhead.maxCommitMs.toFixed(1)} ms`;
        if (lib.truncated) title += ` \xB7 ${plural(lib.truncated, "report")} skipped by the per-commit cap`;
      } else if (state.relay || state.polling) {
        text = "no library in page";
        cls = "partial";
        title = "rerender-lens is not running in this page";
      } else {
        text = "no page";
      }
      status.className = "status " + cls;
      status.title = title;
      status.querySelector(".status-text").textContent = text;
      tabChip.hidden = !state.tabLabel;
      tabChip.textContent = state.tabLabel || "";
      appPicker.hidden = state.apps.length < 2;
      if (!appPicker.hidden) {
        const want = state.apps.map((a) => `${a.id}:${a.label}`).join("|");
        if (appPicker.dataset.apps !== want) {
          appPicker.dataset.apps = want;
          appPicker.textContent = "";
          for (const a of state.apps) appPicker.append(el("option", { value: a.id, text: a.label || a.id }));
        }
        if (state.appId) appPicker.value = state.appId;
      }
      banner.textContent = "";
      const warnings = [];
      if (lib && typeof lib.protocol === "number" && lib.protocol > PROTOCOL) warnings.push(`The page runs a newer rerender-lens (protocol ${lib.protocol}) than this panel (${PROTOCOL}). Update the extension.`);
      if (lib && lib.production) warnings.push("Production React build detected: component names may be minified and hooks are unlabeled. Use a development build.");
      if (lib && lib.injected && lib.source === "page")
        warnings.push(`The page runs its own rerender-lens ${lib.library || ""}; the copy injected by the extension stepped aside. Turn injection off for this origin in Settings to avoid loading the library twice.`);
      if (lib && lib.enabled === false) warnings.push("rerender-lens is present but disabled in this page.");
      if (lib && lib.truncated) warnings.push(`${plural(lib.truncated, "report")} skipped: a commit re-rendered more tracked components than the per-commit cap (200) or took over its time budget. Narrow "include" in Settings, or fix the top offenders first.`);
      banner.hidden = warnings.length === 0;
      for (const w of warnings) banner.append(el("div", { text: w }));
    }
    function setRelay(on) {
      state.relay = on;
      if (!on) state.library = null;
      renderStatus();
    }
    function setLibrary(info) {
      state.library = info;
      renderStatus();
      if (emptyEl.parentNode) renderEmpty();
      if (state.settingsOpen) void renderSettings();
      if (state.flashOn) transport.flashAvoidable?.(true);
    }
    function toggleSettings(open) {
      state.settingsOpen = open === void 0 ? !state.settingsOpen : open;
      settings.hidden = !state.settingsOpen;
      settingsBtn.classList.toggle("active", state.settingsOpen);
      settingsBtn.setAttribute("aria-expanded", String(state.settingsOpen));
      if (state.settingsOpen) void renderSettings().then(() => settings.querySelector("input, button")?.focus());
      else settingsBtn.focus();
    }
    function optionRow(label, key, current, onchange) {
      const input = el("input", { type: "checkbox" });
      input.checked = !!current[key];
      input.addEventListener("change", () => onchange({ [key]: input.checked }));
      return el("label", { class: "opt" }, [input, label]);
    }
    async function renderSettings() {
      settings.textContent = "";
      settings.append(el("div", { class: "drawer-header" }, [el("b", { text: "Settings" }), el("button", { onclick: () => toggleSettings(false) }, "\u2715")]));
      const body = el("div", { class: "drawer-body" });
      settings.append(body);
      if (transport.originStatus) {
        const site = el("div", { class: "section" }, [el("h3", { text: "This site" }), el("div", { class: "meta", text: state.origin || "" })]);
        body.append(site);
        try {
          const st = await transport.originStatus();
          if (st) {
            const enabled = el("input", { type: "checkbox" });
            enabled.checked = st.enabled;
            enabled.disabled = st.builtIn;
            const inject = el("input", { type: "checkbox" });
            inject.checked = st.inject;
            inject.disabled = !st.enabled;
            const defer = el("input", { type: "checkbox" });
            defer.checked = !!st.deferHook;
            defer.disabled = !st.inject;
            const msg = el("div", { class: "meta" });
            const apply = async () => {
              try {
                if (enabled.checked && !st.permitted && transport.requestPermission) {
                  const ok = await transport.requestPermission();
                  if (!ok) {
                    msg.textContent = "Permission not granted. You can also enable the site from the toolbar icon.";
                    enabled.checked = false;
                    return;
                  }
                }
                await transport.setOrigin?.({ enabled: enabled.checked, inject: enabled.checked && inject.checked, deferHook: inject.checked && defer.checked });
                void renderSettings();
              } catch (e) {
                msg.textContent = String(e.message || e);
              }
            };
            enabled.addEventListener("change", () => {
              if (!enabled.checked) inject.checked = false;
              void apply();
            });
            inject.addEventListener("change", () => void apply());
            defer.addEventListener("change", () => void apply());
            site.append(
              el("label", { class: "opt" }, [enabled, st.builtIn ? "Enabled (local development host)" : "Enable on this site"]),
              el("label", { class: "opt" }, [inject, "Inject the library into the page (no app code needed)"]),
              el("label", { class: "opt", title: "Only needed when React DevTools is installed and its Components tab comes up empty" }, [defer, "Let React DevTools create the hook (if both are installed)"]),
              el("div", { class: "meta", text: st.inject ? "Injection is on. Reload the page after changing it." : "Without injection the page must call init({ notifier: createDevtoolsNotifier() })." }),
              msg
            );
          }
        } catch (e) {
          site.append(el("div", { class: "meta", text: String(e.message || e) }));
        }
      }
      const flash = el("input", { type: "checkbox" });
      flash.checked = state.flashOn;
      flash.addEventListener("change", () => {
        state.flashOn = flash.checked;
        transport.flashAvoidable?.(state.flashOn);
        persist();
      });
      body.append(
        el("div", { class: "section" }, [
          el("h3", { text: "Panel" }),
          el("label", { class: "opt" }, [flash, "Flash avoidable re-renders in the page"]),
          el("div", { class: "meta", text: "Shortcuts: / search, f fix tab, Esc clear highlight, arrows in the tree." })
        ])
      );
      const lib = state.library;
      const sec = el("div", { class: "section" }, [el("h3", { text: "Library options" })]);
      body.append(sec);
      if (!lib || !transport.configure) {
        sec.append(el("div", { class: "meta", text: "Connect to a page running rerender-lens to change its options." }));
        return;
      }
      const current = Object.assign({}, lib.options || {});
      const applyOptions = async (patch) => {
        Object.assign(current, patch);
        try {
          const applied = await transport.configure(patch);
          if (applied && state.library) state.library.options = applied;
          if (transport.storage && state.library) transport.storage.set("settings", Object.assign({}, state.library.options));
          toast("Applied");
        } catch (e) {
          toast(`Failed: ${e.message}`);
        }
      };
      sec.append(
        optionRow("Track every React.memo / PureComponent", "trackAllMemoized", current, applyOptions),
        optionRow("Track every component (noisy)", "trackAllComponents", current, applyOptions),
        optionRow("Diff hook state and contexts", "trackHooks", { trackHooks: current.trackHooks !== false }, applyOptions),
        optionRow("Include current hooks, state and contexts in every report", "includeState", { includeState: current.includeState !== false }, applyOptions),
        optionRow("Resolve custom hook names (re-runs each component type once)", "resolveHookNames", current, applyOptions),
        optionRow("Ignore Fast Refresh commits", "ignoreHotReload", { ignoreHotReload: current.ignoreHotReload !== false }, applyOptions),
        optionRow("Print to the page console", "silent", { silent: !current.silent }, (p) => applyOptions({ silent: !p.silent })),
        optionRow("Print genuine re-renders too (logAll)", "logAll", current, applyOptions)
      );
      const listInput = (label, key) => {
        const input = el("input", { type: "text", placeholder: "Name, /regex/, ...", value: (current[key] || []).join(", ") });
        input.addEventListener("change", () => void applyOptions({ [key]: input.value.split(",").map((s) => s.trim()).filter(Boolean) }));
        return el("label", { class: "opt col" }, [label, input]);
      };
      sec.append(listInput("Include (display names)", "include"), listInput("Exclude", "exclude"));
      const max = el("input", { type: "number", min: "0", value: String(current.maxReportsPerComponent || 0) });
      max.addEventListener("change", () => void applyOptions({ maxReportsPerComponent: Math.max(0, Number(max.value) || 0) }));
      sec.append(el("label", { class: "opt col" }, ["Stop printing a component after N reports (0 = never)", max]));
      const help = el("div", { class: "section" }, [el("h3", { text: "Help" })]);
      help.append(
        el("div", { class: "meta", text: "Opens a GitHub issue prefilled with versions, options and counts. No report contents are included; attach an Export if it helps." }),
        el("a", { class: "report-link", href: issueUrl(), target: "_blank", rel: "noreferrer", text: "Report a problem \u2197" })
      );
      body.append(help);
    }
    function issueUrl() {
      const lib = state.library;
      const ext = typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest().version : "n/a";
      const react = lib?.react?.map((r) => `${r.version || "?"}${r.bundleType === 0 ? " (prod)" : ""}`).join(", ") || "not detected";
      const transportLabel = state.tabLabel || (state.relay ? "content script" : state.polling ? "polling" : "none");
      const lines = [
        "### What happened",
        "",
        "(what you did, what you expected, what the panel showed)",
        "",
        "### Environment",
        `- extension ${ext}, panel protocol ${PROTOCOL}, transport: ${transportLabel}`,
        `- library ${lib?.library || "not detected"} (protocol ${lib?.protocol ?? "?"}), React ${react}${lib?.production ? ", production build" : ""}`,
        `- options: ${JSON.stringify(lib?.options || {})}`,
        `- overhead: ${lib?.overhead ? `${lib.overhead.totalMs.toFixed(1)} ms over ${lib.commits ?? 0} commits, worst ${lib.overhead.maxCommitMs.toFixed(1)} ms` : "n/a"}; reports skipped by the cap: ${lib?.truncated ?? 0}`,
        `- buffered: ${state.reports.length} reports, ${totals.avoidable} avoidable; top fix: ${bestFix ? bestFix.label : "none"}`,
        `- browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`
      ];
      const params2 = new URLSearchParams({ title: "Panel: ", body: lines.join("\n"), labels: "bug" });
      return `https://github.com/NexaLeaf/rerender-lens/issues/new?${params2.toString()}`;
    }
    function handle(message) {
      if (!isRecord(message)) return;
      if (transport.origin && transport.origin !== state.origin) state.origin = transport.origin;
      switch (message.type) {
        case "connected":
          setRelay(true);
          break;
        case "disconnected":
          setRelay(false);
          break;
        case "polling":
          state.polling = !!message.on;
          renderStatus();
          break;
        case "tab-label":
          state.tabLabel = typeof message.payload === "string" ? message.payload : null;
          renderStatus();
          break;
        case "tab":
          state.tabLabel = typeof message.payload === "string" ? message.payload : null;
          state.origin = transport.origin || null;
          clearAll();
          state.library = null;
          renderStatus();
          break;
        case "apps": {
          const p = isRecord(message.payload) ? message.payload : {};
          state.apps = Array.isArray(p.list) ? p.list : [];
          state.appId = typeof p.selected === "string" ? p.selected : null;
          renderStatus();
          break;
        }
        case "hello":
          if (isRecord(message.payload)) setLibrary(message.payload);
          break;
        case "clear":
        case "navigated":
          clearAll();
          if (message.type === "navigated") {
            state.library = null;
            renderStatus();
          }
          break;
        case "report": {
          if (state.paused) break;
          const r = normalizeReport(message.payload);
          if (r) enqueue(r);
          break;
        }
        case "batch":
          if (Array.isArray(message.items)) for (const item of message.items) handle(item);
          break;
      }
    }
    const panelApi = {
      state,
      handle,
      flush,
      clearAll,
      importData,
      select: (name) => {
        for (const n of state.nodesByKey.values()) if (n.name === name) return select(n);
      },
      setView,
      openSettings: () => toggleSettings(true),
      startRecording,
      stopRecording
    };
    if (options.theme === "dark") document.documentElement.classList.add("theme-dark");
    state.origin = transport.origin || null;
    setView(state.view);
    renderDetails();
    renderStream();
    renderSummary();
    renderStatus();
    measure();
    if (transport.storage) {
      Promise.resolve(transport.storage.get("panel")).then(restore, () => {
      });
      Promise.resolve(transport.storage.get("sessions")).then(restoreSessions, () => {
      });
    }
    transport.subscribe(handle);
    return panelApi;
  }
  var systemTheme = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  var fetchSource = (url) => fetch(url).then((res) => res.ok ? res.text() : null).catch(() => null);
  function localStorageAdapter(prefix) {
    const mem = (key) => `${prefix}:${key}`;
    return {
      get: (key) => {
        try {
          const raw = localStorage.getItem(mem(key));
          return raw ? JSON.parse(raw) : void 0;
        } catch {
          return void 0;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(mem(key), JSON.stringify(value));
        } catch {
        }
      }
    };
  }
  function commandBridge(send, timeoutMs) {
    const pending = /* @__PURE__ */ new Map();
    const bridge = (cmd, arg) => new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const fail = () => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(null);
      };
      const timer = setTimeout(fail, timeoutMs);
      pending.set(id, { resolve: (v) => v instanceof Error ? reject(v) : resolve(v), timer });
      try {
        void Promise.resolve(send({ __rerenderLensCmd: true, id, cmd, arg })).catch(fail);
      } catch {
        fail();
      }
    });
    const reply = (m) => {
      if (m.__rerenderLensReply !== true || typeof m.id !== "string") return false;
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(typeof m.error === "string" ? new Error(m.error) : m.result);
      }
      return true;
    };
    return { bridge, reply };
  }
  function createRelayTransport(io) {
    let listener = null;
    let relayConnected = false;
    let pollTimer = null;
    let since = 0;
    let origin = null;
    let panelPort = null;
    let currentTab = io.tabId();
    const emit = (m) => {
      if (listener) listener(m);
    };
    const send = (message) => new Promise(
      (resolve, reject) => chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error(res && res.error || "no response"));
        else resolve(res.result);
      })
    );
    async function resolveOrigin() {
      origin = await io.origin().catch(() => null);
      transport.origin = origin;
    }
    async function syncWithPage() {
      try {
        const info = await io.bridge("info");
        if (info) {
          emit({ type: "hello", version: info.protocol, payload: info });
          startInfoRefresh();
          return true;
        }
      } catch {
      }
      return false;
    }
    let infoTimer = null;
    function startInfoRefresh() {
      if (infoTimer) return;
      infoTimer = setInterval(() => {
        if (disposed) return stopInfoRefresh();
        io.bridge("info").then((info) => {
          if (info) emit({ type: "hello", version: info.protocol, payload: info });
          else stopInfoRefresh();
        }).catch(() => stopInfoRefresh());
      }, INFO_REFRESH_MS);
    }
    function stopInfoRefresh() {
      if (infoTimer) clearInterval(infoTimer);
      infoTimer = null;
    }
    let syncGen = 0;
    let syncTimer = null;
    let disposed = false;
    function cancelSync() {
      syncGen++;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = null;
      stopInfoRefresh();
    }
    function syncWithRetry(onReady, initialDelay = 0) {
      cancelSync();
      const gen = syncGen;
      let delay = SYNC_RETRY_MIN;
      let tries = 0;
      const attempt = async () => {
        syncTimer = null;
        if (gen !== syncGen || disposed) return;
        const ok = await syncWithPage();
        if (gen !== syncGen || disposed) return;
        if (ok) {
          onReady();
          return;
        }
        if (++tries >= SYNC_RETRIES) return;
        syncTimer = setTimeout(() => void attempt(), delay);
        delay = Math.min(delay * 2, SYNC_RETRY_MAX);
      };
      if (initialDelay > 0) syncTimer = setTimeout(() => void attempt(), initialDelay);
      else void attempt();
    }
    let droppedSeen = false;
    function resetSince() {
      since = 0;
      droppedSeen = false;
    }
    async function pollOnce() {
      try {
        const res = await io.bridge("pull", since);
        if (!res) return;
        if (res.dropped && !droppedSeen) {
          droppedSeen = true;
          emit({ type: "clear" });
        }
        for (const p of res.reports) emit({ type: "report", payload: p });
        since = res.seq;
      } catch {
      }
    }
    function setPolling(on) {
      if (on && !pollTimer) {
        pollTimer = setInterval(() => void pollOnce(), 500);
        emit({ type: "polling", on: true });
      } else if (!on && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        emit({ type: "polling", on: false });
      }
    }
    function attachToPage(initialDelay = 0) {
      syncWithRetry(() => {
        if (relayConnected) io.bridge("replay").catch(() => {
        });
        else {
          const gen = syncGen;
          void io.bridge("pull", 0).catch(() => null).then((res) => {
            if (gen !== syncGen || disposed) return;
            if (res) {
              for (const p of res.reports) emit({ type: "report", payload: p });
              since = res.seq;
            } else io.bridge("replay").catch(() => {
            });
            setPolling(true);
          });
        }
      }, initialDelay);
    }
    function connect() {
      if (panelPort) {
        try {
          panelPort.disconnect();
        } catch {
        }
        panelPort = null;
      }
      if (currentTab === null) return;
      const port = chrome.runtime.connect({ name: "rerender-lens-panel" });
      panelPort = port;
      port.postMessage({ type: "init", tabId: currentTab });
      port.onMessage.addListener((m) => {
        if (!m || panelPort !== port) return;
        if (m.type === "connected") {
          relayConnected = true;
          setPolling(false);
        } else if (m.type === "disconnected") {
          relayConnected = false;
          syncWithRetry(() => setPolling(true));
        }
        emit(m);
      });
      port.onDisconnect.addListener(() => {
        if (panelPort !== port) return;
        panelPort = null;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!disposed) connect();
        }, 1e3);
      });
    }
    let reconnectTimer = null;
    const transport = {
      origin,
      tabLabel: io.tabLabel ?? null,
      subscribe(fn) {
        listener = fn;
        connect();
        io.onNavigated(() => {
          if (disposed) return;
          resetSince();
          setPolling(false);
          cancelSync();
          fn({ type: "navigated" });
          void resolveOrigin().then(() => {
            if (!disposed) attachToPage(NAVIGATION_SETTLE);
          });
        });
        io.onTabChange?.((label) => {
          if (disposed) return;
          transport.tabLabel = label;
          const next = io.tabId();
          if (next === currentTab) {
            fn({ type: "tab-label", payload: label });
            return;
          }
          resetSince();
          relayConnected = false;
          setPolling(false);
          cancelSync();
          currentTab = next;
          void resolveOrigin().then(() => {
            if (disposed) return;
            fn({ type: "tab", payload: label });
            connect();
            attachToPage();
          });
        });
        void resolveOrigin().then(() => {
          if (!disposed) attachToPage();
        });
      },
      replay() {
        if (relayConnected) io.bridge("replay").catch(() => {
        });
        else {
          resetSince();
          emit({ type: "clear" });
          void syncWithPage().then(() => pollOnce());
        }
      },
      clear() {
        io.bridge("clear").catch(() => {
        });
        resetSince();
      },
      dispose() {
        disposed = true;
        cancelSync();
        setPolling(false);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        if (panelPort) {
          try {
            panelPort.disconnect();
          } catch {
          }
          panelPort = null;
        }
        listener = null;
      },
      configure: (options) => io.bridge("configure", options).then((r) => r ?? void 0),
      highlight: (id) => io.bridge("highlight", id).catch(() => {
      }),
      flashAvoidable: (on) => io.bridge("flash", !!on).catch(() => {
      }),
      originStatus: () => origin ? send({ type: "origin:status", origin }) : Promise.resolve(null),
      setOrigin: (cfg) => send({ type: "origin:set", origin, enabled: cfg.enabled, inject: cfg.inject, deferHook: cfg.deferHook }),
      requestPermission: () => chrome.permissions.request({ origins: [origin + "/*"] }),
      storage: {
        get: (key) => new Promise((resolve) => chrome.storage.local.get(`${key}:${origin}`, (got) => resolve(got ? got[`${key}:${origin}`] : void 0))),
        set: (key, value) => new Promise((resolve) => chrome.storage.local.set({ [`${key}:${origin}`]: value }, resolve))
      },
      badge(count) {
        if (panelPort) panelPort.postMessage({ type: "badge", count });
      },
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {
      })
    };
    if (io.openResource) transport.openResource = io.openResource;
    if (io.undock) transport.undock = io.undock;
    if (io.readSource) transport.readSource = io.readSource;
    return transport;
  }
  function devtoolsIO() {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const evalIn = (code) => new Promise(
      (resolve, reject) => chrome.devtools.inspectedWindow.eval(code, (result, err) => {
        if (err && (err.isException || err.isError)) reject(new Error(err.value || err.description || "eval failed"));
        else resolve(result);
      })
    );
    const expressions = {
      info: () => "b.info()",
      pull: (since) => `b.pull?b.pull(${Number(since) || 0}):null`,
      replay: () => "b.replay()",
      clear: () => "b.clear()",
      configure: (o) => `b.configure(${JSON.stringify(o ?? {})})`,
      highlight: (id) => `b.highlight(${id === null || id === void 0 ? "null" : Number(id)})`,
      flash: (on) => `b.flashAvoidable(${!!on})`
    };
    return {
      tabId: () => tabId,
      origin: () => evalIn("location.origin"),
      bridge: (cmd, arg) => evalIn(`(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;if(!b)return null;try{return (${expressions[cmd](arg)});}catch(e){return {__error:String(e)}}})()`).then((r) => {
        if (isRecord(r) && typeof r.__error === "string") throw new Error(r.__error);
        return r;
      }),
      onNavigated: (cb) => chrome.devtools.network.onNavigated.addListener(cb),
      openResource(url, line, col) {
        if (chrome.devtools.panels.openResource) chrome.devtools.panels.openResource(url, Math.max(0, (line || 1) - 1), Math.max(0, (col || 1) - 1), () => {
        });
      },
      undock: (mode) => openOutside(mode, tabId),
      readSource: (url) => new Promise((resolve) => {
        const bare = url.replace(/\?.*$/, "");
        chrome.devtools.inspectedWindow.getResources((resources) => {
          const res = resources.find((x) => x.url === url) || resources.find((x) => x.url.replace(/\?.*$/, "") === bare);
          if (!res) return resolve(null);
          res.getContent((content) => resolve(typeof content === "string" ? content : null));
        });
      })
    };
  }
  function pageBridgeCommand(cmd, arg) {
    const b = window.__RERENDER_LENS_DEVTOOLS__;
    if (!b) return null;
    try {
      switch (cmd) {
        case "info":
          return b.info();
        case "pull":
          return b.pull ? b.pull(arg) : null;
        case "replay":
          b.replay?.();
          return true;
        case "clear":
          b.clear?.();
          return true;
        case "configure":
          return b.configure ? b.configure(arg) : null;
        case "highlight":
          return b.highlight ? b.highlight(arg) : false;
        case "flash":
          b.flashAvoidable?.(arg);
          return true;
      }
    } catch (e) {
      return { __error: String(e) };
    }
    return null;
  }
  async function openOutside(mode, tabId) {
    if (mode === "sidepanel") {
      const sp = chrome.sidePanel;
      if (!sp) throw new Error('This browser has no side panel API; use "Window" instead.');
      await sp.setOptions({ tabId, path: "sidepanel.html?tabId=" + encodeURIComponent(String(tabId)), enabled: true });
      await sp.open({ tabId });
      return true;
    }
    return new Promise(
      (resolve, reject) => chrome.runtime.sendMessage({ type: "window:open", tabId }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error(res && res.error || "could not open a window"));
        else resolve(true);
      })
    );
  }
  function standaloneIO(opts = {}) {
    let tabId = typeof opts.tabId === "number" ? opts.tabId : null;
    const pinned = tabId !== null;
    let label = null;
    const labelOf = (tab) => {
      if (!tab) return null;
      const o = tab.url ? tab.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "";
      return tab.title ? `${tab.title}${o ? " \xB7 " + o : ""}` : o || null;
    };
    const exec = (target, world, func, args = []) => chrome.scripting.executeScript({ target: { tabId: target }, world, func, args }).then((results) => results && results[0] ? results[0].result : null);
    const io = {
      tabId: () => tabId,
      tabLabel: label,
      async origin() {
        if (tabId === null) return null;
        try {
          return await exec(tabId, "ISOLATED", () => location.origin);
        } catch {
          try {
            const tab = await chrome.tabs.get(tabId);
            return tab && tab.url ? new URL(tab.url).origin : null;
          } catch {
            return null;
          }
        }
      },
      bridge: (cmd, arg) => {
        if (tabId === null) return Promise.resolve(null);
        return exec(tabId, "MAIN", pageBridgeCommand, [cmd, arg ?? null]).then((r) => {
          if (isRecord(r) && typeof r.__error === "string") throw new Error(r.__error);
          return r;
        });
      },
      onNavigated(cb) {
        chrome.tabs.onUpdated.addListener((id, info) => {
          if (id === tabId && info.status === "loading") cb();
        });
      },
      onTabChange(cb) {
        const announce = async () => {
          try {
            const tab = tabId === null ? void 0 : await chrome.tabs.get(tabId);
            label = labelOf(tab);
          } catch {
            label = null;
          }
          cb(label);
        };
        if (pinned) {
          chrome.tabs.onUpdated.addListener((id, info) => {
            if (id === tabId && (info.title || info.url)) void announce();
          });
          void announce();
          return;
        }
        chrome.tabs.onActivated.addListener(({ tabId: active }) => {
          tabId = active;
          void announce();
        });
        void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
          const t = tabs && tabs[0];
          if (t && typeof t.id === "number") {
            tabId = t.id;
            void announce();
          }
        });
      },
      openResource: (url) => void chrome.tabs.create({ url }),
      undock: (mode) => tabId === null ? Promise.reject(new Error("no tab")) : openOutside(mode, tabId),
      // Host permission for the origin is required to fetch the module source (and present when the panel works at all).
      readSource: fetchSource
    };
    return io;
  }
  function bootExtension() {
    const theme = chrome.devtools.panels.themeName === "dark" ? "dark" : systemTheme();
    createPanel(document.getElementById("root"), createRelayTransport(devtoolsIO()), { theme });
  }
  function bootStandalone(opts = {}) {
    return createPanel(document.getElementById("root"), createRelayTransport(standaloneIO(opts)), { theme: systemTheme() });
  }
  function sampleReports() {
    const fn = (name) => FN_PREFIX + name;
    return [
      {
        component: "ProductRow",
        path: ["App", "ProductPage", "ProductList"],
        trigger: "parent",
        avoidable: true,
        renderCount: 1,
        instanceId: 4,
        commitId: 1,
        memoized: true,
        commitPriority: "immediate",
        owner: "ProductList",
        parent: { name: "ProductPage", trigger: "state" },
        selfDuration: 0.8,
        treeDuration: 1.1,
        source: { fileName: "http://localhost:5199/src/ProductList.tsx", lineNumber: 14, columnNumber: 7 },
        props: {
          prev: { product: { id: 1, name: "Keyboard", price: 49 }, style: { color: "red" }, onSelect: fn("onSelect"), selected: false },
          next: { product: { id: 1, name: "Keyboard", price: 49 }, style: { color: "red" }, onSelect: fn("onSelect"), selected: false }
        },
        propChanges: [
          { path: "style", kind: "deep-equal", prev: { color: "red" }, next: { color: "red" } },
          { path: "onSelect", kind: "function", prev: fn("onSelect"), next: fn("onSelect") }
        ],
        stateChanges: [],
        hookChanges: [],
        reasons: [
          "caused by <ProductPage> re-rendering (its state changed).",
          'prop "style" is a new reference but deep-equal to the previous value: memoize the object with useMemo, or hoist it to module scope if it is constant.',
          `prop "onSelect" is a new function instance on every render: wrap it in useCallback (or hoist it out of the parent's render).`
        ]
      },
      {
        component: "Toolbar",
        path: ["App", "ProductPage"],
        trigger: "parent",
        avoidable: true,
        renderCount: 1,
        instanceId: 2,
        commitId: 1,
        memoized: false,
        commitPriority: "immediate",
        owner: "ProductPage",
        parent: { name: "ProductPage", trigger: "state" },
        selfDuration: 0.3,
        props: { prev: { title: "Products", count: 3 }, next: { title: "Products", count: 3 } },
        propChanges: [],
        stateChanges: [],
        hookChanges: [],
        reasons: ['re-rendered with identical props because <ProductPage> re-rendered (its state changed). Wrap "Toolbar" in React.memo (or extend PureComponent).']
      },
      {
        component: "ProductPage",
        path: ["App"],
        trigger: "state",
        avoidable: false,
        renderCount: 1,
        instanceId: 3,
        commitId: 1,
        memoized: false,
        owner: "App",
        parent: null,
        props: { prev: { placeholder: "Search", filters: { sort: "asc", page: 1 } }, next: { placeholder: "Search", filters: { sort: "asc", page: 2 } } },
        propChanges: [{ path: "filters", kind: "different", prev: { sort: "asc", page: 1 }, next: { sort: "asc", page: 2 } }],
        stateChanges: [],
        hookChanges: [{ path: "useState#0", hook: "useState", index: 0, kind: "different", prev: "ab", next: "abc" }],
        reasons: ["useState #0 changed."],
        hookState: [
          { path: "useState#0", hook: "useState", index: 0, value: "abc" },
          { path: "useState#1", hook: "useState", index: 1, value: 3 },
          { path: "useReducer#3", hook: "useReducer", index: 3, value: { cart: [1, 2], open: false } }
        ],
        contexts: [{ name: "Theme", value: { mode: "light", user: "ann" } }]
      },
      {
        component: "Sidebar",
        path: ["App"],
        trigger: "hooks",
        avoidable: false,
        renderCount: 1,
        instanceId: 5,
        owner: "App",
        parent: null,
        commitId: 2,
        memoized: true,
        commitPriority: "normal",
        props: { prev: {}, next: {} },
        propChanges: [],
        stateChanges: [],
        hookChanges: [{ path: "useContext(Theme)", hook: "useContext", index: 0, kind: "different", prev: { mode: "light", user: "ann" }, next: { mode: "dark", user: "ann" }, provider: { component: "App", path: ["App"] }, changedKeys: ["mode"], totalKeys: 2 }],
        reasons: ['useContext(Theme) changed (provided by <App>): only "mode" of 2 keys changed, yet every consumer re-renders. Split the context or memoize the slices consumers read.']
      }
    ];
  }
  function floodReports(n) {
    const out = [];
    const components = Math.max(10, Math.floor(n / 10));
    const spread = 9e4;
    const t0 = Date.now() - spread;
    for (let i = 0; i < n; i++) {
      const id = i % components;
      const depth = 1 + id % 6;
      const path = ["App"];
      for (let d = 1; d < depth; d++) path.push(`Section${(id * 7 + d) % 40}`);
      const avoidable = id % 3 !== 0;
      out.push({
        receivedAt: t0 + Math.round(i / Math.max(1, n - 1) * spread),
        component: `Item${id}`,
        path,
        trigger: avoidable ? "parent" : "props",
        avoidable,
        renderCount: Math.floor(i / components) + 1,
        instanceId: id + 1,
        commitId: Math.floor(i / 50) + 1,
        memoized: id % 2 === 0,
        owner: path[path.length - 1],
        parent: { name: path[path.length - 1], trigger: "state" },
        selfDuration: id % 7 / 10,
        props: { prev: { style: { w: id }, n: i }, next: { style: { w: id }, n: i + (avoidable ? 0 : 1) } },
        propChanges: avoidable ? [{ path: "style", kind: "deep-equal", prev: { w: id }, next: { w: id } }] : [{ path: "n", kind: "different", prev: i, next: i + 1 }],
        stateChanges: [],
        hookChanges: [],
        reasons: [avoidable ? 'prop "style" is a new reference but deep-equal to the previous value.' : 'prop "n" changed.']
      });
    }
    return out;
  }
  function createBroadcastTransport(name) {
    let listener = null;
    let channel = null;
    const emit = (m) => {
      if (listener) listener(m);
    };
    const open = () => {
      if (channel) return channel;
      channel = new BroadcastChannel(name);
      channel.onmessage = (event) => {
        const data = event.data;
        if (!data || reply(data)) return;
        if (data.__rerenderLens === true && typeof data.type === "string") emit({ type: data.type, version: typeof data.version === "number" ? data.version : void 0, payload: data.payload });
      };
      return channel;
    };
    const { bridge, reply } = commandBridge((message) => open().postMessage(message), 1500);
    const transport = {
      origin: location.origin,
      tabLabel: `channel "${name}"`,
      subscribe(fn) {
        listener = fn;
        open();
        fn({ type: "connected" });
        void bridge("info").then(async (info) => {
          if (!info) {
            fn({ type: "disconnected" });
            return;
          }
          fn({ type: "hello", version: info.protocol, payload: info });
          const res = await bridge("pull", 0);
          if (res) for (const p of res.reports) fn({ type: "report", payload: p });
        });
      },
      replay: () => void bridge("replay"),
      clear: () => void bridge("clear"),
      configure: (options) => bridge("configure", options).then((r) => r ?? void 0),
      highlight: (id) => bridge("highlight", id).catch(() => {
      }),
      flashAvoidable: (on) => bridge("flash", !!on).catch(() => {
      }),
      storage: localStorageAdapter(`rerender-lens:${name}`),
      readSource: fetchSource,
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {
      })
    };
    return transport;
  }
  function createRelayClientTransport(relayUrl, ES = EventSource) {
    const [rawBase, relayQuery = ""] = relayUrl.split("?");
    const base = (rawBase ?? "").replace(/\/$/, "");
    const relayToken = new URLSearchParams(relayQuery).get("token");
    const auth = relayToken ? `token=${encodeURIComponent(relayToken)}` : "";
    let listener = null;
    let stream = null;
    let appsOnline = null;
    let roster = [];
    let selected = null;
    const emit = (m) => {
      if (listener) listener(m);
    };
    const post = (message) => {
      const body = selected && isRecord(message) && message.__rerenderLensCmd === true ? { ...message, app: selected } : message;
      return fetch(`${base}/message${auth ? `?${auth}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(() => void 0);
    };
    const { bridge, reply } = commandBridge(post, 2e3);
    const handleData = (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!isRecord(m) || reply(m)) continue;
        if (m.__rerenderLens === true && m.type === "relay") {
          const p = isRecord(m.payload) ? m.payload : {};
          const apps = typeof p.apps === "number" ? p.apps : 0;
          roster = Array.isArray(p.list) ? p.list : [];
          const wasOnline = appsOnline;
          const wasSelected = selected;
          appsOnline = apps;
          if (!roster.length) selected = null;
          else if (!selected || !roster.some((a) => a.id === selected)) selected = roster[0].id;
          emit({ type: "apps", payload: { list: roster, selected } });
          if (apps > 0 && (wasOnline === null || wasOnline === 0 || selected !== wasSelected)) void attach();
          else if (apps === 0) emit({ type: "disconnected" });
        } else if (m.__rerenderLens === true && typeof m.type === "string") {
          if (typeof m.app === "string" && selected && m.app !== selected) continue;
          emit({ type: m.type, version: typeof m.version === "number" ? m.version : void 0, payload: m.payload });
        }
      }
    };
    async function attach() {
      const info = await bridge("info");
      if (!info) {
        emit({ type: "disconnected" });
        return;
      }
      emit({ type: "connected" });
      emit({ type: "hello", version: info.protocol, payload: info });
      const res = await bridge("pull", 0);
      if (res) for (const p of res.reports) emit({ type: "report", payload: p });
    }
    const transport = {
      origin: base,
      tabLabel: `relay ${base.replace(/^https?:\/\//, "")}`,
      selectApp(id) {
        if (id === selected || !roster.some((a) => a.id === id)) return;
        selected = id;
        emit({ type: "apps", payload: { list: roster, selected } });
        emit({ type: "navigated" });
        void attach();
      },
      subscribe(fn) {
        listener = fn;
        const open = () => {
          stream = new ES(`${base}/events?role=panel${auth ? `&${auth}` : ""}`);
          stream.onmessage = (e) => handleData(e.data);
          stream.onerror = () => {
            emit({ type: "disconnected" });
          };
        };
        open();
      },
      replay: () => void bridge("replay"),
      clear: () => void bridge("clear"),
      configure: (options) => bridge("configure", options).then((r) => r ?? void 0),
      highlight: (id) => bridge("highlight", id).catch(() => {
      }),
      flashAvoidable: (on) => bridge("flash", !!on).catch(() => {
      }),
      storage: localStorageAdapter(`rerender-lens:relay:${base}`),
      readSource: fetchSource,
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {
      })
    };
    return transport;
  }
  function bootRelay(relayUrl) {
    return createPanel(document.getElementById("root"), createRelayClientTransport(relayUrl), { theme: systemTheme() });
  }
  function bootBroadcast(name) {
    return createPanel(document.getElementById("root"), createBroadcastTransport(name), { theme: systemTheme() });
  }
  function bootDemo() {
    const params2 = new URLSearchParams(location.search);
    const flood = Number(params2.get("flood") || 0);
    const sample = sampleReports();
    let i = 0;
    let commit = 0;
    const mem = {};
    const transport = {
      origin: "http://localhost:5199",
      subscribe(fn) {
        fn({ type: "connected" });
        fn({ type: "hello", version: PROTOCOL, payload: { library: "demo", protocol: PROTOCOL, react: [{ version: "19.2.0", bundleType: 1 }], production: false, enabled: true, options: { trackAllMemoized: true, silent: true }, source: "page", injected: false } });
        if (flood > 0) {
          const t0 = performance.now();
          for (const r of floodReports(flood)) fn({ type: "report", payload: r });
          requestAnimationFrame(() => console.log(`[rerender-lens demo] ${flood} reports ingested and rendered in ${(performance.now() - t0).toFixed(0)} ms`));
          return;
        }
        const tick = () => {
          const r = JSON.parse(JSON.stringify(sample[i % sample.length]));
          r.renderCount = Math.floor(i / sample.length) + 1;
          if (i % sample.length === 0) commit++;
          r.commitId = commit + (r.commitId === 2 ? 100 : 0);
          fn({ type: "report", payload: r });
          i++;
          if (i < 14) setTimeout(tick, i < 4 ? 50 : 900);
        };
        tick();
      },
      replay() {
      },
      clear() {
      },
      configure: (o) => Promise.resolve(o),
      highlight() {
      },
      flashAvoidable() {
      },
      originStatus: () => Promise.resolve({ origin: "http://localhost:5199", builtIn: true, permitted: true, enabled: true, inject: false, deferHook: false }),
      setOrigin: () => Promise.resolve(),
      storage: { get: (k) => Promise.resolve(mem[k]), set: (k, v) => Promise.resolve(mem[k] = v) },
      readSource: () => Promise.resolve("import { memo } from 'react';\n\nexport const ProductList = memo(function ProductList(props) {\n  const [selected, setSelected] = useState(null);\n  return (\n    <ul>\n      {props.products.map((p) => (\n        <ProductRow key={p.id} product={p} style={{ color: 'red' }} onSelect={(id) => props.onSelect(id)} />\n      ))}\n    </ul>\n  );\n});\n")
    };
    createPanel(document.getElementById("root"), transport, { theme: /theme=dark/.test(location.search) ? "dark" : systemTheme() });
  }
  var api = {
    PROTOCOL,
    createPanel,
    summarize,
    valueNode,
    reportView,
    fixView,
    normalizeReport,
    reportToMarkdown,
    sampleReports,
    floodReports,
    bootStandalone,
    bootBroadcast,
    bootRelay,
    createRelayTransport,
    createBroadcastTransport,
    createRelayClientTransport,
    sourceContext,
    analysis: { firstDifferentPath, diffLeaves, fixesFor, rankFixes, rootCauseOf, analyzeCommit: analyzeCommit2, contextAttribution, cascadeTree, rootCauseSummary: rootCauseSummary2, summarizeSession, compareSessions }
  };
  window.RerenderLensPanel = api;
  var hasChrome = typeof chrome !== "undefined" && !!chrome && !!chrome.runtime && !!chrome.runtime.id;
  var hasDevtools = hasChrome && !!chrome.devtools && !!chrome.devtools.inspectedWindow;
  var params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  var pathname = typeof location !== "undefined" ? String(location.pathname) : "";
  if (params.has("relay") && typeof EventSource === "function") bootRelay(params.get("relay") || location.origin);
  else if (params.has("channel") && typeof BroadcastChannel === "function") bootBroadcast(params.get("channel") || "rerender-lens");
  else if (hasDevtools && /panel\.html/.test(pathname) && !params.has("tabId")) bootExtension();
  else if (hasChrome && (/sidepanel\.html/.test(pathname) || params.has("tabId"))) bootStandalone({ tabId: params.has("tabId") ? Number(params.get("tabId")) : null });
  else if (params.has("demo")) bootDemo();
})();
