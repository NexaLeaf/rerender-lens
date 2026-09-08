/* Built from extension/src/panel.ts by `npm run build`; do not edit by hand. */
"use strict";
(() => {
  // extension/src/panel.ts
  var PROTOCOL = 2;
  var KIND_LABEL = {
    "deep-equal": "equal by value",
    function: "new function",
    element: "equal element",
    different: "changed",
    added: "added",
    removed: "removed"
  };
  var AVOIDABLE_KINDS = /* @__PURE__ */ new Set(["deep-equal", "function", "element"]);
  var FN_PREFIX = "\u0192 ";
  var MAX_REPORTS = 2e3;
  var MAX_PER_NODE = 200;
  var MAX_COMMITS = 500;
  var ROW_H = 22;
  var ITEM_H = 20;
  var OVERSCAN = 8;
  var FALLBACK_VIEWPORT = 800;
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
  var componentList = (m) => [...m].map(([c, n]) => `<${c}>${n > 1 ? " \xD7" + n : ""}`).join(", ");
  function changesOf(report) {
    return [].concat(report.propChanges || [], report.stateChanges || [], report.hookChanges || []);
  }
  function summarize(report) {
    const counts = /* @__PURE__ */ new Map();
    for (const c of changesOf(report)) counts.set(c.kind, (counts.get(c.kind) || 0) + 1);
    if (counts.size === 0) return "no changes";
    return [...counts].map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(", ");
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
    if (typeof p.commitPriority === "string") r.commitPriority = p.commitPriority;
    if (Array.isArray(p.hookState)) r.hookState = p.hookState.filter((h) => isRecord(h) && typeof h.path === "string");
    if (Array.isArray(p.contexts)) r.contexts = p.contexts.filter((c) => isRecord(c) && typeof c.name === "string");
    if (isRecord(p.state)) r.state = p.state;
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
  function firstDifferentPath(a, b, base = "") {
    if (a === b) return null;
    if (!isRecord(a) || !isRecord(b)) return base || "(value)";
    if (Array.isArray(a) !== Array.isArray(b)) return base || "(value)";
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return base ? `${base}.length` : "length";
      for (let i = 0; i < a.length; i++) {
        const p = firstDifferentPath(a[i], b[i], `${base}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = firstDifferentPath(a[k], b[k], base ? `${base}.${k}` : k);
      if (p) return p;
    }
    return null;
  }
  function diffLeaves(a, b, limit = 20, base = "", out = []) {
    if (out.length >= limit || a === b) return out;
    if (!isRecord(a) || !isRecord(b) || Array.isArray(a) !== Array.isArray(b)) {
      out.push({ path: base || "(value)", prev: a, next: b });
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n && out.length < limit; i++) diffLeaves(a[i], b[i], limit, `${base}[${i}]`, out);
      return out;
    }
    for (const k of /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (out.length >= limit) break;
      diffLeaves(a[k], b[k], limit, base ? `${base}.${k}` : k, out);
    }
    return out;
  }
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
  var identifier = (name) => /^[A-Za-z_$][\w$]*$/.test(name) ? name : "value";
  function fixesFor(r) {
    const out = [];
    const ownerName = r.owner || r.parent && r.parent.name || null;
    const changes = changesOf(r);
    const avoidableProps = (r.propChanges || []).filter((c) => AVOIDABLE_KINDS.has(c.kind));
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
    for (const c of avoidableProps) {
      const owner = ownerName || "?";
      const root = c.path.split(/[.[]/)[0] || c.path;
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
        continue;
      }
      if (c.kind === "function") {
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
    for (const c of [].concat(r.stateChanges || [], r.hookChanges || [])) {
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
        const name = ctxName;
        out.push({
          kind: "contextValue",
          owner: providerOwner || `${name}.Provider`,
          target: r.component,
          prop: name,
          label: `memoize the ${name} provider value${providerOwner ? ` in <${providerOwner}>` : ""}`,
          detail: `<${r.component}> re-rendered because ${name} produced a new value that is deep-equal to the previous one${providerOwner ? ` (Provider rendered by <${providerOwner}>)` : ""}.`,
          snippet: `// ${providerOwner || `where <${name}.Provider> is rendered`}
const value = useMemo(() => ({ /* ... */ }), [/* deps */]);
<${name}.Provider value={value}>`
        });
      } else if (c.hook === "useSyncExternalStore") {
        out.push({
          kind: "storeSnapshot",
          owner: r.component,
          target: r.component,
          prop: c.path,
          label: `stable getSnapshot in <${r.component}>`,
          detail: `${c.path} returned a new reference with the same contents; getSnapshot must return a cached value.`,
          snippet: `// ${r.component}
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
        const k = fixKey(f);
        let agg = byKey.get(k);
        if (!agg) {
          agg = { ...f, key: k, count: 0, components: /* @__PURE__ */ new Map(), reports: [] };
          byKey.set(k, agg);
        }
        agg.count++;
        agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
        if (agg.reports.length < 50) agg.reports.push(r);
      }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  var isAncestorReport = (anc, r) => anc.path.length < r.path.length && r.path[anc.path.length] === anc.component && anc.path.every((p, i) => r.path[i] === p);
  function rootCauseOf(r, commitReports) {
    let cur = r;
    const seen = /* @__PURE__ */ new Set([r]);
    while (cur.trigger === "parent" && cur.parent) {
      const parent = cur.parent;
      const p = commitReports.find((x) => x.component === parent.name && isAncestorReport(x, cur));
      if (!p || seen.has(p)) return { name: parent.name, trigger: parent.trigger, report: null };
      seen.add(p);
      cur = p;
    }
    return cur === r ? null : { name: cur.component, trigger: cur.trigger, report: cur };
  }
  function analyzeCommit(reports) {
    const roots = /* @__PURE__ */ new Map();
    let avoidable = 0;
    let wasted = 0;
    for (const r of reports) {
      if (!r.avoidable) continue;
      avoidable++;
      if (typeof r.selfDuration === "number") wasted += r.selfDuration;
      const root = rootCauseOf(r, reports);
      const name = root ? root.name : r.parent && r.parent.name || "(unknown)";
      const trigger = root ? root.trigger : r.parent && r.parent.trigger || "parent";
      let agg = roots.get(name);
      if (!agg) {
        agg = { name, trigger, count: 0, components: /* @__PURE__ */ new Map() };
        roots.set(name, agg);
      }
      agg.count++;
      agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
    }
    const first = reports[0];
    return {
      id: first ? first.commitId : 0,
      receivedAt: first ? first.receivedAt : 0,
      total: reports.length,
      avoidable,
      wasted,
      roots: [...roots.values()].sort((a, b) => b.count - a.count),
      contexts: contextAttribution(reports),
      fixes: rankFixes(reports),
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
        agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
        agg.commits.add(r.commitId);
        if (c.provider && c.provider.component) agg.providers.set(c.provider.component, (agg.providers.get(c.provider.component) || 0) + 1);
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
  function rootCauseSummary(name, commits) {
    const out = { name, trigger: "parent", commits: [], total: 0, components: /* @__PURE__ */ new Map(), fixes: [] };
    const affected = [];
    for (const [key, reports] of commits) {
      const analysis = analyzeCommit(reports);
      const root = analysis.roots.find((x) => x.name === name);
      if (!root) continue;
      out.trigger = root.trigger;
      out.commits.push({ key, analysis, count: root.count, components: root.components });
      out.total += root.count;
      for (const [c, n] of root.components) out.components.set(c, (out.components.get(c) || 0) + n);
      for (const r of reports) {
        if (!r.avoidable) continue;
        const rc = rootCauseOf(r, reports);
        if ((rc ? rc.name : r.parent && r.parent.name) === name) affected.push(r);
      }
    }
    out.commits.reverse();
    out.fixes = rankFixes(affected);
    return out;
  }
  function summarizeSession(session, reports) {
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
      id: session.id,
      name: session.name,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      total: reports.length,
      avoidable,
      wasted,
      byComponent,
      fixes: rankFixes(reports).map((f) => ({ key: f.key, label: f.label, count: f.count }))
    };
  }
  function compareSessions(before, after) {
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
      newFixes: after.fixes.filter((f) => !beforeKeys.has(f.key))
    };
  }
  var PRIORITY_LABEL = { immediate: "discrete input", "user-blocking": "continuous input", normal: "transition / async", low: "low", idle: "idle" };
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
    if (r.memoized === false) by.append(el("div", { class: "meta", text: "Not memoized (re-renders whenever its parent does)" }));
    else if (r.memoized === true) by.append(el("div", { class: "meta", text: "Memoized (React.memo / PureComponent)" }));
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
          if (c) table.append(changeRow(h.path, c));
          else {
            const tr = el("tr");
            tr.append(el("td", { class: "k", text: h.path }));
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
      for (const c of hooks) table.append(changeRow(c.path, c));
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
  function virtualList(container, rowHeight, rowFor) {
    const inner = el("div", { class: "virtual-inner" });
    container.append(inner);
    let items = [];
    const mounted = /* @__PURE__ */ new Map();
    let raf = 0;
    const render = () => {
      raf = 0;
      const height = container.clientHeight || FALLBACK_VIEWPORT;
      const start = Math.max(0, Math.floor(container.scrollTop / rowHeight) - OVERSCAN);
      const end = Math.min(items.length, Math.ceil((container.scrollTop + height) / rowHeight) + OVERSCAN);
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
      legacyCommit: 0,
      tabLabel: transport.tabLabel ?? null,
      compact: false,
      sessions: [],
      recording: null,
      selectedSession: null,
      compareWith: null
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
      status,
      settingsBtn
    ]);
    const summary = el("div", { class: "summary" });
    const banner = el("div", { class: "banner", hidden: true });
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
    const toastEl = el("div", { class: "toast", hidden: true });
    root.classList.add("rl");
    root.append(toolbar, summary, banner, main, stream, toastEl);
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
    function renderSummary() {
      summary.textContent = "";
      const total = state.reports.length;
      if (!total) {
        summary.hidden = true;
        return;
      }
      summary.hidden = false;
      let avoidable = 0;
      let wasted = 0;
      const perComponent = /* @__PURE__ */ new Map();
      for (const r of state.reports) {
        if (!r.avoidable) continue;
        avoidable++;
        if (typeof r.selfDuration === "number") wasted += r.selfDuration;
        perComponent.set(r.component, (perComponent.get(r.component) || 0) + 1);
      }
      const top = [...perComponent].sort((a, b) => b[1] - a[1])[0];
      const fix = avoidable ? rankFixes(state.reports)[0] : void 0;
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
          flashOn: state.flashOn
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
    const nodeOfReport = (r) => nodeFor(r.path.concat([r.component]));
    function commitKeyFor(report) {
      if (report.commitId > 0) return report.commitId;
      return -state.legacyCommit;
    }
    function ingest(report) {
      if (!report.receivedAt) report.receivedAt = Date.now();
      state.reports.push(report);
      if (state.reports.length > MAX_REPORTS) state.reports.shift();
      const node = nodeOfReport(report);
      node.reports.push(report);
      if (node.reports.length > MAX_PER_NODE) node.reports.shift();
      node.total++;
      if (report.avoidable) {
        node.avoidable++;
        if (typeof report.selfDuration === "number") node.wasted += report.selfDuration;
      }
      node.lastReport = report;
      node.flash = true;
      node.flashAt = Date.now();
      const ck = commitKeyFor(report);
      let list = state.commits.get(ck);
      if (!list) {
        list = [];
        state.commits.set(ck, list);
        state.commitOrder.push(ck);
        if (state.commitOrder.length > MAX_COMMITS) state.commits.delete(state.commitOrder.shift());
      }
      list.push(report);
      return node;
    }
    function flush() {
      flushScheduled = false;
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      state.legacyCommit++;
      let touchedSelected = false;
      let avoidableCount = 0;
      for (const r of batch) {
        const node = ingest(r);
        if (state.recording && state.recording.reports.length < MAX_REPORTS) state.recording.reports.push(r);
        if (r.avoidable) avoidableCount++;
        if (state.selectedKey === node.key) {
          touchedSelected = true;
          if (state.tab === "latest") state.selectedReport = r;
        }
      }
      renderLeft();
      renderStream(batch);
      renderSummary();
      if (touchedSelected || state.view === "commits" || state.view === "fixes" || state.tab === "root" || state.recording && state.tab === "session") renderDetails();
      if (state.polling && avoidableCount) transport.badge?.(state.reports.filter((r) => r.avoidable).length);
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
      state.selectedKey = null;
      state.selectedReport = null;
      state.selectedCommit = null;
      state.selectedFix = null;
      state.selectedRoot = null;
      if (state.tab === "commit" || state.tab === "fixlist" || state.tab === "root") state.tab = "latest";
      queue = [];
      renderLeft();
      renderDetails();
      renderStream();
      renderSummary();
    }
    function matchesFilter(name) {
      if (!state.filter) return true;
      const f = state.filter.trim();
      const m = /^\/(.+)\/([a-z]*)$/.exec(f);
      if (m && m[1] !== void 0) {
        try {
          return new RegExp(m[1], m[2]).test(name);
        } catch {
        }
      }
      return name.toLowerCase().includes(f.toLowerCase());
    }
    function visible(node) {
      const own = (!state.avoidableOnly || node.avoidable > 0) && matchesFilter(node.name) && node.total > 0;
      if (own) return true;
      for (const c of node.children.values()) if (visible(c)) return true;
      return false;
    }
    const passes = (r) => (!state.avoidableOnly || r.avoidable) && matchesFilter(r.component);
    const filteredReports = () => state.reports.filter(passes);
    function setView(view) {
      state.view = view;
      for (const [id, b] of viewButtons) b.classList.toggle("active", id === view);
      tree.hidden = view !== "tree";
      table.hidden = view === "tree";
      renderLeft();
      renderDetails();
      persist();
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
    const emptyEl = el("div", { class: "empty" }, [
      el("div", { text: "No re-renders reported yet." }),
      el("div", null, ["Call ", el("code", { text: "init({ notifier: createDevtoolsNotifier() })" }), " in the page, or enable injection in Settings, then interact with it."])
    ]);
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
      if (node.avoidable) badges.append(el("span", { class: "badge avoid", title: "avoidable re-renders", text: String(node.avoidable) }));
      if (node.total) badges.append(el("span", { class: "badge", title: "re-renders", text: String(node.total) }));
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
        if (inField) target.blur();
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
        const fixes = rankFixes(o.reports);
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
    function renderOffenders() {
      table.textContent = "";
      const rows = offenderRows();
      if (!rows.length) {
        table.append(el("div", { class: "empty", text: "No re-renders reported yet." }));
        return;
      }
      const t = el("table", { class: "grid" });
      t.append(
        el("thead", null, el("tr", null, [sortableHeader("Component", "component"), sortableHeader("Avoidable", "avoidable", true), sortableHeader("Total", "total", true), sortableHeader("Wasted", "wasted", true), el("th", { text: "Top fix" })]))
      );
      const body = el("tbody");
      for (const o of rows) {
        body.append(
          el(
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
          )
        );
      }
      t.append(body);
      table.append(t);
    }
    function commitSummaries() {
      const out = [];
      for (let i = state.commitOrder.length - 1; i >= 0; i--) {
        const key = state.commitOrder[i];
        const reports = state.commits.get(key);
        if (!reports || !reports.some(passes)) continue;
        out.push({ key, analysis: analyzeCommit(reports) });
      }
      return out;
    }
    function showCommit(key) {
      state.selectedCommit = key;
      state.tab = "commit";
      renderLeft();
      renderDetails();
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
            el("span", { class: "id", text: key > 0 ? `#${key}` : "\u2014" }),
            el("span", { class: "t", text: fmtTime(analysis.receivedAt) }),
            el("span", { class: "n", text: plural(analysis.total, "render") }),
            analysis.avoidable ? el("span", { class: "badge avoid", text: `${analysis.avoidable} avoidable` }) : el("span", { class: "badge", text: "ok" }),
            analysis.reports[0]?.commitPriority ? el("span", { class: "prio " + analysis.reports[0].commitPriority, title: "commit priority", text: PRIORITY_LABEL[analysis.reports[0].commitPriority] || analysis.reports[0].commitPriority }) : null,
            el("span", { class: "root", text: root2 ? `\u2190 <${root2.name}> (${root2.trigger})` : "" })
          ])
        );
      }
      table.append(list);
    }
    function renderFixes() {
      table.textContent = "";
      const reports = filteredReports();
      const fixes = rankFixes(reports);
      const contexts = contextAttribution(reports);
      if (!fixes.length && !contexts.length) {
        table.append(el("div", { class: "empty", text: "No avoidable re-renders, nothing to fix." }));
        return;
      }
      if (fixes.length) {
        const list = el("ol", { class: "fixes" });
        for (const f of fixes) {
          list.append(
            el(
              "li",
              {
                class: state.selectedFix === f.key && state.tab === "fixlist" ? "selected" : "",
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
            )
          );
        }
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
      copy: copyText
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
      const a = analyzeCommit(reports);
      details.append(
        el("div", { class: "details-header" }, [
          el("span", { class: "title", text: key > 0 ? `Commit #${key}` : "Commit" }),
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
      const fix = rankFixes(filteredReports()).find((f) => f.key === state.selectedFix);
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
      const s = rootCauseSummary(name, state.commits);
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
            el("span", { class: "id", text: c.key > 0 ? `#${c.key}` : "\u2014" }),
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
      if (transport.download) {
        transport.download(name, text);
        return;
      }
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
      banner.textContent = "";
      const warnings = [];
      if (lib && typeof lib.protocol === "number" && lib.protocol !== PROTOCOL) {
        warnings.push(
          lib.protocol < PROTOCOL ? `The page runs rerender-lens ${lib.library || ""} (protocol ${lib.protocol}); this panel expects protocol ${PROTOCOL}. Update the rerender-lens package for commit grouping, source links and settings.` : `The page runs a newer rerender-lens (protocol ${lib.protocol}) than this panel (${PROTOCOL}). Update the extension.`
        );
      }
      if (lib && lib.production) warnings.push("Production React build detected: component names may be minified and hooks are unlabeled. Use a development build.");
      if (lib && lib.injected && lib.source === "page")
        warnings.push(`The page runs its own rerender-lens ${lib.library || ""}; the copy injected by the extension stepped aside. Turn injection off for this origin in Settings to avoid loading the library twice.`);
      if (lib && lib.enabled === false) warnings.push("rerender-lens is present but disabled in this page.");
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
      if (state.settingsOpen) void renderSettings();
      if (state.flashOn) transport.flashAvoidable?.(true);
    }
    function toggleSettings(open) {
      state.settingsOpen = open === void 0 ? !state.settingsOpen : open;
      settings.hidden = !state.settingsOpen;
      settingsBtn.classList.toggle("active", state.settingsOpen);
      if (state.settingsOpen) void renderSettings();
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
      if (lib.protocol < PROTOCOL) {
        sec.append(el("div", { class: "meta", text: "The page library is too old to be configured from here." }));
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
        case "hello":
          setLibrary(isRecord(message.payload) ? Object.assign({ protocol: message.version || 1 }, message.payload) : { protocol: message.version || 1 });
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
          emit({ type: "hello", version: info.protocol || 1, payload: info });
          return true;
        }
      } catch {
      }
      return false;
    }
    async function pollOnce() {
      try {
        const res = await io.bridge("pull", since);
        if (!res) return;
        if (res.dropped) emit({ type: "clear" });
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
    async function attachToPage() {
      if (!await syncWithPage()) return;
      if (relayConnected) io.bridge("replay").catch(() => {
      });
      else {
        const res = await io.bridge("pull", 0).catch(() => null);
        if (res) {
          for (const p of res.reports) emit({ type: "report", payload: p });
          since = res.seq;
        } else io.bridge("replay").catch(() => {
        });
        setPolling(true);
      }
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
          void syncWithPage().then((ok) => ok && setPolling(true));
        }
        emit(m);
      });
      port.onDisconnect.addListener(() => {
        if (panelPort !== port) return;
        panelPort = null;
        setTimeout(connect, 1e3);
      });
    }
    const transport = {
      origin,
      tabLabel: io.tabLabel ?? null,
      subscribe(fn) {
        listener = fn;
        connect();
        io.onNavigated(() => {
          since = 0;
          fn({ type: "navigated" });
          void resolveOrigin().then(() => {
            setTimeout(() => void attachToPage(), 1200);
          });
        });
        io.onTabChange?.((label) => {
          transport.tabLabel = label;
          const next = io.tabId();
          if (next === currentTab) {
            fn({ type: "tab-label", payload: label });
            return;
          }
          since = 0;
          relayConnected = false;
          setPolling(false);
          currentTab = next;
          void resolveOrigin().then(() => {
            fn({ type: "tab", payload: label });
            connect();
            void attachToPage();
          });
        });
        void resolveOrigin().then(() => attachToPage());
      },
      replay() {
        if (relayConnected) io.bridge("replay").catch(() => {
        });
        else {
          since = 0;
          emit({ type: "clear" });
          void syncWithPage().then(() => pollOnce());
        }
      },
      clear() {
        io.bridge("clear").catch(() => {
        });
        since = 0;
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
      info: () => "b.info?b.info():{count:b.size,protocol:b.version}",
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
      undock: (mode) => openOutside(mode, tabId)
    };
  }
  function pageBridgeCommand(cmd, arg) {
    const b = window.__RERENDER_LENS_DEVTOOLS__;
    if (!b) return null;
    try {
      switch (cmd) {
        case "info":
          return b.info ? b.info() : { count: b.size, protocol: b.version };
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
      undock: (mode) => tabId === null ? Promise.reject(new Error("no tab")) : openOutside(mode, tabId)
    };
    return io;
  }
  function bootExtension() {
    const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = chrome.devtools.panels.themeName === "dark" || prefersDark ? "dark" : "light";
    createPanel(document.getElementById("root"), createRelayTransport(devtoolsIO()), { theme });
  }
  function bootStandalone(opts = {}) {
    const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    return createPanel(document.getElementById("root"), createRelayTransport(standaloneIO(opts)), { theme: prefersDark ? "dark" : "light" });
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
    for (let i = 0; i < n; i++) {
      const id = i % components;
      const depth = 1 + id % 6;
      const path = ["App"];
      for (let d = 1; d < depth; d++) path.push(`Section${(id * 7 + d) % 40}`);
      const avoidable = id % 3 !== 0;
      out.push({
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
        fn({ type: "hello", version: PROTOCOL, payload: { count: 0, library: "demo", protocol: PROTOCOL, react: [{ version: "19.2.0", bundleType: 1 }], production: false, enabled: true, options: { trackAllMemoized: true, silent: true }, source: "page", injected: false } });
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
      storage: { get: (k) => Promise.resolve(mem[k]), set: (k, v) => Promise.resolve(mem[k] = v) }
    };
    const dark = /theme=dark/.test(location.search) || typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    createPanel(document.getElementById("root"), transport, { theme: dark ? "dark" : "light" });
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
    createRelayTransport,
    analysis: { firstDifferentPath, diffLeaves, fixesFor, rankFixes, rootCauseOf, analyzeCommit, contextAttribution, cascadeTree, rootCauseSummary, summarizeSession, compareSessions }
  };
  window.RerenderLensPanel = api;
  var hasChrome = typeof chrome !== "undefined" && !!chrome && !!chrome.runtime && !!chrome.runtime.id;
  var hasDevtools = hasChrome && !!chrome.devtools && !!chrome.devtools.inspectedWindow;
  var params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  var pathname = typeof location !== "undefined" ? String(location.pathname) : "";
  if (hasDevtools && /panel\.html/.test(pathname) && !params.has("tabId")) bootExtension();
  else if (hasChrome && (/sidepanel\.html/.test(pathname) || params.has("tabId"))) bootStandalone({ tabId: params.has("tabId") ? Number(params.get("tabId")) : null });
  else if (params.has("demo")) bootDemo();
})();
