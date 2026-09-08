/* rerender-lens DevTools panel. Plain JS, no build step.
 * Exposes window.RerenderLensPanel.createPanel(root, transport, options) for tests, demo mode and the
 * Elements sidebar. Everything under `analysis` is pure and unit-tested on its own. */
(function (global) {
  'use strict';

  const PROTOCOL = 2;
  const KIND_LABEL = {
    'deep-equal': 'equal by value',
    function: 'new function',
    element: 'equal element',
    different: 'changed',
    added: 'added',
    removed: 'removed',
  };
  const AVOIDABLE_KINDS = new Set(['deep-equal', 'function', 'element']);
  const FN_PREFIX = '\u0192 '; // "f " as emitted by the library's serialize()
  const MAX_REPORTS = 2000;
  const MAX_PER_NODE = 200;
  const MAX_STREAM = 300;
  const MAX_COMMITS = 500;

  // ---------- tiny DOM helpers ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
      }
    }
    if (children) for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    const p = (n, w) => String(n).padStart(w, '0');
    return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`;
  }

  const fmtMs = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(1)} ms` : '');

  function changesOf(report) {
    return [].concat(report.propChanges || [], report.stateChanges || [], report.hookChanges || []);
  }

  function summarize(report) {
    const counts = new Map();
    for (const c of changesOf(report)) counts.set(c.kind, (counts.get(c.kind) || 0) + 1);
    if (counts.size === 0) return 'no changes';
    return [...counts].map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(', ');
  }

  /** Make an incoming payload safe to render; null when it is not a report at all. */
  function normalizeReport(p) {
    if (!p || typeof p !== 'object' || typeof p.component !== 'string') return null;
    const arr = (x) => (Array.isArray(x) ? x.filter((c) => c && typeof c === 'object' && typeof c.path === 'string') : []);
    const r = {
      component: p.component,
      instanceId: typeof p.instanceId === 'number' ? p.instanceId : 0,
      commitId: typeof p.commitId === 'number' ? p.commitId : 0,
      renderCount: typeof p.renderCount === 'number' ? p.renderCount : 0,
      trigger: typeof p.trigger === 'string' ? p.trigger : 'parent',
      avoidable: !!p.avoidable,
      props: p.props && typeof p.props === 'object' ? { prev: p.props.prev || {}, next: p.props.next || {} } : { prev: {}, next: {} },
      propChanges: arr(p.propChanges),
      stateChanges: arr(p.stateChanges),
      hookChanges: arr(p.hookChanges),
      parent: p.parent && typeof p.parent === 'object' && typeof p.parent.name === 'string' ? { name: p.parent.name, trigger: p.parent.trigger || 'parent' } : null,
      owner: typeof p.owner === 'string' ? p.owner : null,
      path: Array.isArray(p.path) ? p.path.filter((x) => typeof x === 'string') : [],
      reasons: Array.isArray(p.reasons) ? p.reasons.filter((x) => typeof x === 'string') : [],
      time: typeof p.time === 'number' ? p.time : 0,
    };
    if (typeof p.selfDuration === 'number') r.selfDuration = p.selfDuration;
    if (p.source && typeof p.source === 'object' && typeof p.source.fileName === 'string') r.source = p.source;
    if (typeof p.receivedAt === 'number') r.receivedAt = p.receivedAt;
    return r;
  }

  // ---------- value rendering ----------
  function valueNode(v, depth) {
    depth = depth || 0;
    if (v === null || v === undefined) return el('span', { class: 'v nil', text: String(v) });
    const t = typeof v;
    if (t === 'string') {
      if (v.startsWith(FN_PREFIX)) return el('span', { class: 'v fn', text: v });
      if (/^<[^>]+>$/.test(v)) return el('span', { class: 'v', text: v });
      return el('span', { class: 'v str', text: JSON.stringify(v) });
    }
    if (t === 'number' || t === 'bigint') return el('span', { class: 'v num', text: String(v) });
    if (t === 'boolean') return el('span', { class: 'v bool', text: String(v) });
    if (Array.isArray(v)) {
      const short = v.length <= 4 && v.every((x) => typeof x !== 'object' || x === null);
      if (short) {
        const s = el('span', { class: 'v' }, '[');
        v.forEach((x, i) => {
          if (i) s.append(', ');
          s.append(valueNode(x, depth + 1));
        });
        s.append(']');
        return s;
      }
      return objectDetails(`Array(${v.length})`, v);
    }
    if (v.$type === 'Date') return el('span', { class: 'v', text: `Date(${v.value})` });
    if (v.$type === 'RegExp') return el('span', { class: 'v', text: v.value });
    if (v.$type === 'Map') return objectDetails(`Map(${v.entries.length})`, v.entries);
    if (v.$type === 'Set') return objectDetails(`Set(${v.values.length})`, v.values);
    const keys = Object.keys(v).filter((k) => k !== '$type');
    const label = `${v.$type ? v.$type + ' ' : ''}{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
    return objectDetails(label, v);
  }

  function objectDetails(label, obj) {
    const d = el('details', { class: 'obj' }, [el('summary', { text: label })]);
    d.addEventListener(
      'toggle',
      () => {
        if (d.open && !d.querySelector('pre')) d.append(el('pre', { text: JSON.stringify(obj, null, 2) }));
      },
      { once: true },
    );
    return d;
  }

  // ---------- analysis (pure) ----------
  /** First path at which two serialized values differ, e.g. "style.color" or "items[2].id"; '' when equal. */
  function firstDifferentPath(a, b, base) {
    base = base || '';
    if (a === b) return null;
    const ta = typeof a;
    const tb = typeof b;
    if (ta !== 'object' || tb !== 'object' || a === null || b === null) return base || '(value)';
    if (Array.isArray(a) !== Array.isArray(b)) return base || '(value)';
    if (Array.isArray(a)) {
      if (a.length !== b.length) return base ? `${base}.length` : 'length';
      for (let i = 0; i < a.length; i++) {
        const p = firstDifferentPath(a[i], b[i], `${base}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = firstDifferentPath(a[k], b[k], base ? `${base}.${k}` : k);
      if (p) return p;
    }
    return null;
  }

  function shortValue(v, max) {
    max = max || 60;
    let s;
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
    if (s === undefined) s = String(v);
    return s.length > max ? s.slice(0, max - 3) + '...' : s;
  }

  const identifier = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : 'value');

  /** The concrete fixes one report suggests, each attributed to the file that must change. */
  function fixesFor(r) {
    const out = [];
    const ownerName = r.owner || (r.parent && r.parent.name) || null;
    const changes = changesOf(r);
    const avoidableProps = (r.propChanges || []).filter((c) => AVOIDABLE_KINDS.has(c.kind));
    if (r.avoidable && changes.length === 0) {
      out.push({
        kind: 'memo',
        owner: r.component,
        target: r.component,
        prop: null,
        label: `Wrap <${r.component}> in React.memo`,
        detail: `<${r.component}> re-rendered with identical props because <${(r.parent && r.parent.name) || 'its parent'}> re-rendered.`,
        snippet: `// ${r.component}\nimport { memo } from 'react';\n\nexport const ${r.component} = memo(function ${r.component}(props) {\n  // ...\n});\n// class components: extend PureComponent instead`,
      });
    }
    for (const c of avoidableProps) {
      const owner = ownerName || '?';
      const root = c.path.split(/[.[]/)[0];
      const id = identifier(root);
      if (c.kind === 'function') {
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
    for (const c of [].concat(r.stateChanges || [], r.hookChanges || [])) {
      if (AVOIDABLE_KINDS.has(c.kind)) {
        if (c.hook === 'useContext' || /^useContext/.test(c.path)) {
          const ctx = /useContext\((.*)\)/.exec(c.path);
          const name = ctx ? ctx[1] : 'Context';
          out.push({
            kind: 'contextValue',
            owner: `${name}.Provider`,
            target: r.component,
            prop: name,
            label: `memoize the ${name} provider value`,
            detail: `<${r.component}> re-rendered because ${name} produced a new value that is deep-equal to the previous one.`,
            snippet: `// where <${name}.Provider> is rendered\nconst value = useMemo(() => ({ /* ... */ }), [/* deps */]);\n<${name}.Provider value={value}>`,
          });
        } else if (c.hook === 'useSyncExternalStore') {
          out.push({
            kind: 'storeSnapshot',
            owner: r.component,
            target: r.component,
            prop: c.path,
            label: `stable getSnapshot in <${r.component}>`,
            detail: `${c.path} returned a new reference with the same contents; getSnapshot must return a cached value.`,
            snippet: `// ${r.component}\n// getSnapshot must return the same reference while the data is unchanged\nconst snapshot = useSyncExternalStore(subscribe, store.getSnapshot /* cached */);`,
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
    }
    return out;
  }

  const fixKey = (f) => `${f.kind}|${f.owner}|${f.prop || f.target}`;

  /** Aggregate fixes over many reports: how many avoidable renders each one removes. */
  function rankFixes(reports) {
    const byKey = new Map();
    for (const r of reports) {
      if (!r.avoidable) continue;
      for (const f of fixesFor(r)) {
        const k = fixKey(f);
        let agg = byKey.get(k);
        if (!agg) {
          agg = { ...f, key: k, count: 0, components: new Map(), reports: [] };
          byKey.set(k, agg);
        }
        agg.count++;
        agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
        if (agg.reports.length < 50) agg.reports.push(r);
      }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  const isAncestorReport = (anc, r) => anc.path.length < r.path.length && r.path[anc.path.length] === anc.component && anc.path.every((p, i) => r.path[i] === p);

  /** Walk `parent` links inside one commit up to the component whose own change started the cascade. */
  function rootCauseOf(r, commitReports) {
    let cur = r;
    const seen = new Set([r]);
    while (cur.trigger === 'parent' && cur.parent) {
      const p = commitReports.find((x) => x.component === cur.parent.name && isAncestorReport(x, cur));
      if (!p || seen.has(p)) return { name: cur.parent.name, trigger: cur.parent.trigger, report: null };
      seen.add(p);
      cur = p;
    }
    return cur === r ? null : { name: cur.component, trigger: cur.trigger, report: cur };
  }

  /** Group reports by commit and rank what started each cascade. */
  function analyzeCommit(reports) {
    const roots = new Map();
    let avoidable = 0;
    let wasted = 0;
    for (const r of reports) {
      if (!r.avoidable) continue;
      avoidable++;
      if (typeof r.selfDuration === 'number') wasted += r.selfDuration;
      const root = rootCauseOf(r, reports);
      const name = root ? root.name : (r.parent && r.parent.name) || '(unknown)';
      const trigger = root ? root.trigger : (r.parent && r.parent.trigger) || 'parent';
      let agg = roots.get(name);
      if (!agg) {
        agg = { name, trigger, count: 0, components: new Map() };
        roots.set(name, agg);
      }
      agg.count++;
      agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
    }
    const contexts = contextAttribution(reports);
    return {
      id: reports[0] ? reports[0].commitId : 0,
      receivedAt: reports[0] ? reports[0].receivedAt : 0,
      total: reports.length,
      avoidable,
      wasted,
      roots: [...roots.values()].sort((a, b) => b.count - a.count),
      contexts,
      fixes: rankFixes(reports),
      reports,
    };
  }

  /** Which contexts changed and how many consumers re-rendered because of them. */
  function contextAttribution(reports) {
    const byCtx = new Map();
    for (const r of reports) {
      for (const c of r.hookChanges || []) {
        if (c.hook !== 'useContext' && !/^useContext/.test(c.path)) continue;
        const m = /useContext\((.*)\)/.exec(c.path);
        const name = m ? m[1] : c.path;
        let agg = byCtx.get(name);
        if (!agg) {
          agg = { name, consumers: 0, avoidable: 0, components: new Map(), commits: new Set() };
          byCtx.set(name, agg);
        }
        agg.consumers++;
        if (AVOIDABLE_KINDS.has(c.kind)) agg.avoidable++;
        agg.components.set(r.component, (agg.components.get(r.component) || 0) + 1);
        agg.commits.add(r.commitId);
      }
    }
    return [...byCtx.values()].sort((a, b) => b.consumers - a.consumers);
  }

  /** Nested cascade for one commit: every report placed under its ancestors (untracked ancestors appear as plain names). */
  function cascadeTree(reports) {
    const root = { name: '', children: new Map(), report: null };
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

  function reportToMarkdown(r) {
    const lines = [];
    lines.push(`### <${r.component}> ${r.avoidable ? 'avoidable re-render' : `re-render (${r.trigger})`} #${r.renderCount}`);
    lines.push('');
    for (const x of r.reasons || []) lines.push(`- ${x}`);
    if (r.path && r.path.length) lines.push('', `**Path:** ${r.path.concat([r.component]).join(' > ')}`);
    if (r.parent) lines.push(`**Triggered by:** <${r.parent.name}> (${r.parent.trigger})`);
    if (r.owner) lines.push(`**Created by:** <${r.owner}>`);
    if (r.source) lines.push(`**Source:** ${r.source.fileName}${r.source.lineNumber ? ':' + r.source.lineNumber : ''}`);
    const changes = changesOf(r);
    if (changes.length) {
      lines.push('', '| path | kind | prev | next |', '| --- | --- | --- | --- |');
      for (const c of changes) lines.push(`| ${c.path} | ${KIND_LABEL[c.kind] || c.kind} | \`${shortValue(c.prev, 40)}\` | \`${shortValue(c.next, 40)}\` |`);
    }
    const fixes = fixesFor(r);
    if (fixes.length) {
      lines.push('', '**Fix**', '');
      for (const f of fixes) lines.push(`- ${f.label}`);
      lines.push('', '```jsx', fixes[0].snippet, '```');
    }
    return lines.join('\n');
  }

  // ---------- report view (shared with the Elements sidebar) ----------
  function changeRow(label, c, suffix) {
    const tr = el('tr', { class: 'changed' + (AVOIDABLE_KINDS.has(c.kind) ? '' : ' real') });
    tr.append(el('td', { class: 'k', text: label }));
    const td = el('td');
    td.append(valueNode(c.prev), el('span', { class: 'arrow', text: '\u2192' }));
    td.append(c.kind === 'removed' ? el('span', { class: 'v nil', text: '(removed)' }) : valueNode(c.next));
    let kind = (KIND_LABEL[c.kind] || c.kind) + (suffix || '');
    if (c.kind === 'different' && c.prev && c.next && typeof c.prev === 'object' && typeof c.next === 'object') {
      const p = firstDifferentPath(c.prev, c.next);
      if (p) kind += ` at ${p}`;
    }
    td.append(el('span', { class: 'kind', text: kind }));
    tr.append(td);
    return tr;
  }

  function kvSection(title, next, changes) {
    const byKey = new Map(changes.map((c) => [c.path.split(/[.[]/)[0], c]));
    const table = el('table', { class: 'kv' });
    for (const k of Object.keys(next || {})) {
      const c = byKey.get(k);
      if (c) {
        table.append(changeRow(k, c, c.path !== k ? ` at ${c.path}` : ''));
      } else {
        const tr = el('tr');
        tr.append(el('td', { class: 'k', text: k }));
        const td = el('td');
        td.append(valueNode(next[k]));
        tr.append(td);
        table.append(tr);
      }
    }
    for (const c of changes) if (c.kind === 'removed') table.append(changeRow(c.path, c));
    if (!table.children.length) table.append(el('tr', null, [el('td', { class: 'v nil', text: 'no props' })]));
    return el('div', { class: 'section' }, [el('h3', { text: title }), table]);
  }

  function sourceLabel(src) {
    const file = src.fileName.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    return `${file}${src.lineNumber ? ':' + src.lineNumber : ''}`;
  }

  /** @param actions { openSource(src), highlight(id), copy(text) } all optional */
  function reportView(r, actions) {
    actions = actions || {};
    const frag = document.createDocumentFragment();
    const duration = typeof r.selfDuration === 'number' ? ` \u00B7 ${fmtMs(r.selfDuration)}` : '';
    const head = el('div', { class: 'section' }, [
      el('h3', { text: 'Why did this render?' }),
      el('div', null, [
        el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'Avoidable re-render' : `Re-render (${r.trigger})` }),
        el('span', { class: 'meta', text: `  #${r.renderCount} \u00B7 ${summarize(r)}${duration}` }),
      ]),
      el('ul', { class: 'reasons' }, (r.reasons || []).map((x) => el('li', { text: x }))),
    ]);
    if (!actions.compact) {
      const bar = el('div', { class: 'actions' });
      if (r.source && actions.openSource) bar.append(el('button', { title: r.source.fileName, onclick: () => actions.openSource(r.source) }, `\u2197 ${sourceLabel(r.source)}`));
      else if (r.source) bar.append(el('span', { class: 'meta', title: r.source.fileName, text: sourceLabel(r.source) }));
      if (actions.highlight && r.instanceId) bar.append(el('button', { onclick: () => actions.highlight(r.instanceId) }, '\u25A3 Highlight'));
      if (actions.copy) bar.append(el('button', { onclick: () => actions.copy(reportToMarkdown(r)) }, '\u2398 Copy as Markdown'));
      if (bar.children.length) head.append(bar);
    }
    frag.append(head);
    const by = el('div', { class: 'section' }, [el('h3', { text: 'Rendered by' })]);
    const crumbs = el('div', { class: 'crumbs' });
    const parts = [].concat(r.path || []);
    parts.forEach((p, i) => {
      if (i) crumbs.append(' \u203A ');
      crumbs.append(p);
    });
    if (parts.length) crumbs.append(' \u203A ');
    crumbs.append(el('b', { text: r.component }));
    by.append(crumbs);
    if (r.parent) by.append(el('div', { text: `Triggered by <${r.parent.name}> (${r.parent.trigger})` }));
    else by.append(el('div', { text: 'Update started in this component' }));
    if (r.owner) by.append(el('div', { class: 'meta', text: `Created by <${r.owner}>` }));
    if (r.commitId) by.append(el('div', { class: 'meta', text: `Commit #${r.commitId}` }));
    frag.append(by);
    frag.append(kvSection('Props', r.props ? r.props.next : {}, r.propChanges || []));
    const hooks = [].concat(r.hookChanges || [], r.stateChanges || []);
    if (hooks.length) {
      const table = el('table', { class: 'kv' });
      for (const c of hooks) table.append(changeRow(c.path, c));
      frag.append(el('div', { class: 'section' }, [el('h3', { text: 'State & hooks that changed' }), table]));
    }
    return frag;
  }

  function fixView(fixes, actions) {
    actions = actions || {};
    const frag = document.createDocumentFragment();
    if (!fixes.length) {
      frag.append(el('div', { class: 'section' }, [el('h3', { text: 'Fix' }), el('div', { class: 'meta', text: 'Nothing to fix: this render was caused by a genuine change.' })]));
      return frag;
    }
    for (const f of fixes) {
      const sec = el('div', { class: 'section fix' }, [
        el('h3', { text: f.label }),
        el('div', { text: f.detail }),
        f.count ? el('div', { class: 'meta', text: `removes ${f.count} avoidable re-render${f.count === 1 ? '' : 's'}: ${[...f.components].map(([c, n]) => `<${c}>${n > 1 ? ' \u00D7' + n : ''}`).join(', ')}` }) : null,
        el('pre', { class: 'snippet', text: f.snippet }),
      ]);
      if (actions.copy) sec.append(el('button', { onclick: () => actions.copy(f.snippet) }, '\u2398 Copy snippet'));
      frag.append(sec);
    }
    return frag;
  }

  // ---------- panel ----------
  function createPanel(root, transport, options) {
    options = options || {};
    const state = {
      tree: { name: '', children: new Map(), reports: [], total: 0, avoidable: 0, expanded: true, path: [], key: '' },
      nodesByKey: new Map(),
      reports: [],
      commits: new Map(), // commitId -> reports
      commitOrder: [],
      selectedKey: null,
      selectedReport: null,
      selectedCommit: null,
      selectedFix: null,
      view: 'tree', // tree | offenders | commits | fixes
      tab: 'latest', // latest | history | fix
      paused: false,
      avoidableOnly: false,
      filter: '',
      relay: false, // content script connected
      library: null, // HelloPayload from the page
      polling: false,
      streamCollapsed: false,
      collapsed: new Set(),
      sort: { key: 'avoidable', dir: -1 },
      flashOn: false,
      settingsOpen: false,
      origin: null,
      legacyCommit: 0,
    };
    let persistTimer = null;
    let queue = [];
    let flushScheduled = false;

    const schedule = typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);
    const call = (name, ...args) => (transport && typeof transport[name] === 'function' ? transport[name](...args) : undefined);
    const copyText = (text) => {
      const p = call('copy', text);
      if (p === undefined && global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(text).catch(() => {});
      toast('Copied');
    };

    // ---------- DOM skeleton ----------
    root.textContent = '';
    const search = el('input', {
      type: 'search',
      placeholder: 'Search components (text or /regex/)',
      oninput: () => {
        state.filter = search.value;
        renderLeft();
        persist();
      },
    });
    const pauseBtn = el(
      'button',
      {
        title: 'Pause / resume',
        onclick: () => {
          state.paused = !state.paused;
          pauseBtn.classList.toggle('active', state.paused);
          pauseBtn.textContent = state.paused ? '\u25B6 Resume' : '\u23F8 Pause';
        },
      },
      '\u23F8 Pause',
    );
    const clearBtn = el(
      'button',
      {
        title: 'Clear',
        onclick: () => {
          clearAll();
          call('clear');
          call('badge', 0);
        },
      },
      '\u2298 Clear',
    );
    const replayBtn = el('button', { title: 'Replay buffered reports from the page', onclick: () => call('replay') }, '\u21BB Replay');
    const exportBtn = el('button', { title: 'Export reports as JSON', onclick: exportJson }, '\u2913 Export');
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden-file' });
    importInput.addEventListener('change', () => {
      const f = importInput.files && importInput.files[0];
      if (f) importFile(f);
      importInput.value = '';
    });
    const importBtn = el('button', { title: 'Import a JSON export', onclick: () => importInput.click() }, '\u2912 Import');
    const avoidCheck = el('input', {
      type: 'checkbox',
      onchange: () => {
        state.avoidableOnly = avoidCheck.checked;
        renderLeft();
        renderStream();
        persist();
      },
    });
    const settingsBtn = el('button', { title: 'Settings', onclick: () => toggleSettings() }, '\u2699 Settings');
    const status = el('span', { class: 'status', title: '' }, [el('span', { class: 'dot' }), el('span', { class: 'status-text', text: 'no page' })]);
    const toolbar = el('div', { class: 'toolbar' }, [
      search,
      el('span', { class: 'sep' }),
      pauseBtn,
      clearBtn,
      replayBtn,
      el('span', { class: 'sep' }),
      exportBtn,
      importBtn,
      importInput,
      el('span', { class: 'sep' }),
      el('label', null, [avoidCheck, 'Avoidable only']),
      el('span', { class: 'spacer' }),
      status,
      settingsBtn,
    ]);
    const banner = el('div', { class: 'banner', hidden: true });
    const viewsBar = el('div', { class: 'views' });
    const VIEWS = [
      ['tree', 'Tree'],
      ['offenders', 'Offenders'],
      ['commits', 'Commits'],
      ['fixes', 'Fixes'],
    ];
    const viewButtons = new Map();
    for (const [id, label] of VIEWS) {
      const b = el('button', { 'data-view': id, onclick: () => setView(id) }, label);
      viewButtons.set(id, b);
      viewsBar.append(b);
    }
    const tree = el('div', { class: 'tree', tabindex: '0', onkeydown: onTreeKey });
    const table = el('div', { class: 'table-wrap', hidden: true });
    const left = el('div', { class: 'left' }, [viewsBar, tree, table]);
    const resizer = el('div', { class: 'resizer', title: 'Drag to resize' });
    const details = el('div', { class: 'details' });
    const settings = el('div', { class: 'drawer', hidden: true });
    const main = el('div', { class: 'main' }, [left, resizer, details, settings]);
    const streamList = el('ul', { class: 'stream-list' });
    const streamCount = el('span', { class: 'count', text: '0 reports' });
    const stream = el('div', { class: 'stream' }, [
      el(
        'div',
        {
          class: 'stream-header',
          onclick: () => {
            state.streamCollapsed = !state.streamCollapsed;
            stream.classList.toggle('collapsed', state.streamCollapsed);
            persist();
          },
        },
        [el('span', { text: '\u25BE Live stream' }), streamCount],
      ),
      streamList,
    ]);
    const toastEl = el('div', { class: 'toast', hidden: true });
    root.append(toolbar, banner, main, stream, toastEl);

    let toastTimer = null;
    function toast(text) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, 1200);
    }

    // resizer
    let drag = null;
    resizer.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, w: left.getBoundingClientRect().width };
      e.preventDefault();
    });
    global.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const w = Math.max(180, Math.min(drag.w + e.clientX - drag.x, root.clientWidth - 240));
      left.style.width = w + 'px';
      state.treeWidth = w;
    });
    global.addEventListener('mouseup', () => {
      if (drag) persist();
      drag = null;
    });

    // ---------- persistence (per origin) ----------
    function persist() {
      if (!transport || !transport.storage) return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        transport.storage.set('panel', {
          filter: state.filter,
          avoidableOnly: state.avoidableOnly,
          view: state.view,
          streamCollapsed: state.streamCollapsed,
          collapsed: [...state.collapsed],
          treeWidth: state.treeWidth,
          flashOn: state.flashOn,
        });
      }, 150);
    }

    function restore(saved) {
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.filter === 'string') {
        state.filter = saved.filter;
        search.value = saved.filter;
      }
      if (typeof saved.avoidableOnly === 'boolean') {
        state.avoidableOnly = saved.avoidableOnly;
        avoidCheck.checked = saved.avoidableOnly;
      }
      if (Array.isArray(saved.collapsed)) state.collapsed = new Set(saved.collapsed.filter((x) => typeof x === 'string'));
      if (typeof saved.streamCollapsed === 'boolean') {
        state.streamCollapsed = saved.streamCollapsed;
        stream.classList.toggle('collapsed', state.streamCollapsed);
      }
      if (typeof saved.treeWidth === 'number' && saved.treeWidth > 100) {
        state.treeWidth = saved.treeWidth;
        left.style.width = saved.treeWidth + 'px';
      }
      if (typeof saved.flashOn === 'boolean') state.flashOn = saved.flashOn;
      if (saved.view && viewButtons.has(saved.view)) state.view = saved.view;
      for (const n of state.nodesByKey.values()) n.expanded = !state.collapsed.has(n.key);
      setView(state.view);
      renderStream();
    }

    // ---------- model ----------
    function keyOf(path) {
      return path.join(' ');
    }

    function nodeFor(path) {
      const key = keyOf(path);
      const found = state.nodesByKey.get(key);
      if (found) return found;
      let parent = state.tree;
      for (let i = 0; i < path.length; i++) {
        const k = keyOf(path.slice(0, i + 1));
        let n = state.nodesByKey.get(k);
        if (!n) {
          n = { name: path[i], children: new Map(), reports: [], total: 0, avoidable: 0, wasted: 0, expanded: !state.collapsed.has(k), path: path.slice(0, i + 1), key: k };
          state.nodesByKey.set(k, n);
          parent.children.set(path[i], n);
        }
        parent = n;
      }
      return parent;
    }

    function commitKeyFor(report) {
      if (report.commitId > 0) return report.commitId;
      // Protocol 1 libraries have no commit id: reports delivered in one flush count as one commit.
      return -state.legacyCommit;
    }

    function ingest(report) {
      if (typeof report.receivedAt !== 'number') report.receivedAt = Date.now();
      state.reports.push(report);
      if (state.reports.length > MAX_REPORTS) state.reports.shift();
      const node = nodeFor([].concat(report.path, [report.component]));
      node.reports.push(report);
      if (node.reports.length > MAX_PER_NODE) node.reports.shift();
      node.total++;
      if (report.avoidable) {
        node.avoidable++;
        if (typeof report.selfDuration === 'number') node.wasted += report.selfDuration;
      }
      node.lastReport = report;
      node.flash = true;
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

    /** Drain the queue: one tree render per batch, one stream item per report. */
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
        appendToStream(r);
        if (r.avoidable) avoidableCount++;
        if (state.selectedKey === node.key) {
          touchedSelected = true;
          if (state.tab === 'latest') state.selectedReport = r;
        }
      }
      renderLeft();
      if (touchedSelected || state.view === 'commits' || state.view === 'fixes') renderDetails();
      if (state.polling && avoidableCount) call('badge', state.reports.filter((r) => r.avoidable).length);
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
      queue = [];
      renderLeft();
      renderDetails();
      renderStream();
    }

    function matchesFilter(name) {
      if (!state.filter) return true;
      const f = state.filter.trim();
      const m = /^\/(.+)\/([a-z]*)$/.exec(f);
      if (m) {
        try {
          return new RegExp(m[1], m[2]).test(name);
        } catch {
          /* invalid regex: fall through to text */
        }
      }
      return name.toLowerCase().includes(f.toLowerCase());
    }

    /** A node is shown if it or any descendant matches the filter (and has avoidable reports when that filter is on). */
    function visible(node) {
      const own = (!state.avoidableOnly || node.avoidable > 0) && matchesFilter(node.name) && node.total > 0;
      if (own) return true;
      for (const c of node.children.values()) if (visible(c)) return true;
      return false;
    }

    const filteredReports = () => state.reports.filter((r) => (!state.avoidableOnly || r.avoidable) && matchesFilter(r.component));

    // ---------- left pane ----------
    function setView(view) {
      state.view = view;
      for (const [id, b] of viewButtons) b.classList.toggle('active', id === view);
      tree.hidden = view !== 'tree';
      table.hidden = view === 'tree';
      renderLeft();
      renderDetails();
      persist();
    }

    function renderLeft() {
      if (state.view === 'tree') renderTree();
      else if (state.view === 'offenders') renderOffenders();
      else if (state.view === 'commits') renderCommits();
      else renderFixes();
    }

    // Row elements are kept per node and updated in place, so a click is never lost to a rebuild.
    let flatRows = [];
    const rowEls = new Map();
    let emptyEl = null;
    function renderTree() {
      flatRows = [];
      if (state.tree.children.size === 0) {
        for (const r of rowEls.values()) r.remove();
        rowEls.clear();
        if (!emptyEl) {
          emptyEl = el('div', { class: 'empty' }, [
            el('div', { text: 'No re-renders reported yet.' }),
            el('div', null, ['Call ', el('code', { text: 'init({ notifier: createDevtoolsNotifier() })' }), ' in the page, or enable injection in Settings, then interact with it.']),
          ]);
        }
        if (!emptyEl.parentNode) tree.append(emptyEl);
        return;
      }
      if (emptyEl && emptyEl.parentNode) emptyEl.remove();
      const seen = new Set();
      let cursor = tree.firstChild;
      const place = (row) => {
        if (row === cursor) cursor = cursor.nextSibling;
        else tree.insertBefore(row, cursor);
      };
      const walk = (node, depth) => {
        for (const child of node.children.values()) {
          if (!visible(child)) continue;
          seen.add(child.key);
          place(rowFor(child, depth));
          flatRows.push(child);
          if (child.expanded) walk(child, depth + 1);
        }
      };
      walk(state.tree, 0);
      for (const [key, row] of rowEls) {
        if (!seen.has(key)) {
          row.remove();
          rowEls.delete(key);
        }
      }
    }

    function hoverHighlight(node, on) {
      const r = node && node.lastReport;
      if (!r || !r.instanceId) return;
      call('highlight', on ? r.instanceId : null);
    }

    function rowFor(node, depth) {
      let row = rowEls.get(node.key);
      if (!row) {
        row = el('div', {
          class: 'row',
          'data-key': node.key,
          role: 'treeitem',
          onclick: () => select(node),
          onmouseenter: () => hoverHighlight(node, true),
          onmouseleave: () => hoverHighlight(node, false),
          onanimationend: () => row.classList.remove('flash'),
        });
        row.append(el('span', { class: 'indent' }));
        row.append(
          el('span', {
            class: 'chevron',
            onclick: (e) => {
              e.stopPropagation();
              toggleExpanded(node);
            },
          }),
        );
        row.append(
          el('span', { class: 'tag' }, [
            el('span', { class: 'bracket', text: '<' }),
            el('span', { class: 'name', text: node.name }),
            el('span', { class: 'bracket', text: '>' }),
          ]),
        );
        row.append(el('span', { class: 'badges' }));
        rowEls.set(node.key, row);
      }
      row.classList.toggle('selected', state.selectedKey === node.key);
      const indent = row.querySelector('.indent');
      if (indent.childElementCount !== depth) {
        indent.textContent = '';
        for (let i = 0; i < depth; i++) indent.append(el('span', { class: 'guide' }));
      }
      const hasChildren = [...node.children.values()].some(visible);
      const chevron = row.querySelector('.chevron');
      chevron.classList.toggle('leaf', !hasChildren);
      chevron.textContent = node.expanded ? '\u25BE' : '\u25B8';
      const badges = row.querySelector('.badges');
      badges.textContent = '';
      if (node.avoidable) badges.append(el('span', { class: 'badge avoid', title: 'avoidable re-renders', text: String(node.avoidable) }));
      if (node.total) badges.append(el('span', { class: 'badge', title: 're-renders', text: String(node.total) }));
      if (node.flash) {
        node.flash = false;
        row.classList.remove('flash');
        void row.offsetWidth; // restart the animation
        row.classList.add('flash');
      }
      return row;
    }

    function toggleExpanded(node, value) {
      node.expanded = value === undefined ? !node.expanded : value;
      if (node.expanded) state.collapsed.delete(node.key);
      else state.collapsed.add(node.key);
      renderTree();
      persist();
    }

    function select(node, report) {
      state.selectedKey = node.key;
      state.selectedReport = report || node.lastReport || null;
      // Picking a specific report shows it, unless the caller asked for the Fix tab.
      if (report && state.tab !== 'fix') state.tab = 'latest';
      if (state.tab === 'commit' || state.tab === 'fixlist') state.tab = 'latest';
      renderLeft();
      renderDetails();
      const row = tree.querySelector(`[data-key="${cssEscape(node.key)}"]`);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function cssEscape(s) {
      return global.CSS && global.CSS.escape ? global.CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
    }

    function onTreeKey(e) {
      if (!flatRows.length) return;
      const idx = flatRows.findIndex((n) => n.key === state.selectedKey);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        select(flatRows[Math.min(flatRows.length - 1, idx + 1)]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        select(flatRows[Math.max(0, idx - 1)]);
      } else if (e.key === 'ArrowRight' && idx >= 0) {
        toggleExpanded(flatRows[idx], true);
      } else if (e.key === 'ArrowLeft' && idx >= 0) {
        toggleExpanded(flatRows[idx], false);
      } else if (e.key === 'Escape') {
        call('highlight', null);
      }
    }

    function sortableHeader(label, key, numeric) {
      const active = state.sort.key === key;
      return el(
        'th',
        {
          class: (active ? 'sorted ' : '') + (numeric ? 'num' : ''),
          onclick: () => {
            state.sort = { key, dir: active ? -state.sort.dir : numeric ? -1 : 1 };
            renderLeft();
          },
        },
        label + (active ? (state.sort.dir < 0 ? ' \u25BE' : ' \u25B4') : ''),
      );
    }

    function offenderRows() {
      const byName = new Map();
      for (const r of filteredReports()) {
        let o = byName.get(r.component);
        if (!o) {
          o = { component: r.component, total: 0, avoidable: 0, wasted: 0, paths: new Set(), reports: [] };
          byName.set(r.component, o);
        }
        o.total++;
        if (r.avoidable) {
          o.avoidable++;
          if (typeof r.selfDuration === 'number') o.wasted += r.selfDuration;
        }
        o.paths.add(keyOf(r.path));
        o.reports.push(r);
      }
      const rows = [...byName.values()];
      for (const o of rows) {
        const fixes = rankFixes(o.reports);
        o.fix = fixes.length ? fixes[0].label : '';
      }
      const { key, dir } = state.sort;
      rows.sort((a, b) => {
        const va = a[key];
        const vb = b[key];
        const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return c * dir || b.avoidable - a.avoidable;
      });
      return rows;
    }

    function renderOffenders() {
      table.textContent = '';
      const rows = offenderRows();
      if (!rows.length) {
        table.append(el('div', { class: 'empty', text: 'No re-renders reported yet.' }));
        return;
      }
      const t = el('table', { class: 'grid' });
      t.append(
        el('thead', null, el('tr', null, [sortableHeader('Component', 'component'), sortableHeader('Avoidable', 'avoidable', true), sortableHeader('Total', 'total', true), sortableHeader('Wasted', 'wasted', true), el('th', { text: 'Top fix' })])),
      );
      const body = el('tbody');
      for (const o of rows) {
        body.append(
          el(
            'tr',
            {
              class: o.avoidable ? 'has-avoid' : '',
              onclick: () => {
                const last = o.reports[o.reports.length - 1];
                const node = nodeFor([].concat(last.path, [last.component]));
                state.tab = 'fix';
                select(node, last);
              },
            },
            [
              el('td', { class: 'c' }, [el('span', { class: 'name', text: o.component }), o.paths.size > 1 ? el('span', { class: 'meta', text: ` \u00D7${o.paths.size} places` }) : null]),
              el('td', { class: 'num' }, o.avoidable ? el('span', { class: 'badge avoid', text: String(o.avoidable) }) : '0'),
              el('td', { class: 'num', text: String(o.total) }),
              el('td', { class: 'num', text: o.wasted ? fmtMs(o.wasted) : '' }),
              el('td', { class: 'fix', text: o.fix }),
            ],
          ),
        );
      }
      t.append(body);
      table.append(t);
    }

    function commitSummaries() {
      const out = [];
      for (let i = state.commitOrder.length - 1; i >= 0; i--) {
        const reports = state.commits.get(state.commitOrder[i]);
        if (!reports) continue;
        const kept = reports.filter((r) => (!state.avoidableOnly || r.avoidable) && matchesFilter(r.component));
        if (!kept.length) continue;
        out.push({ key: state.commitOrder[i], analysis: analyzeCommit(reports), shown: kept.length });
      }
      return out;
    }

    function renderCommits() {
      table.textContent = '';
      const items = commitSummaries();
      if (!items.length) {
        table.append(el('div', { class: 'empty', text: 'No commits yet.' }));
        return;
      }
      const list = el('ul', { class: 'commits' });
      for (const { key, analysis } of items) {
        const root = analysis.roots[0];
        list.append(
          el(
            'li',
            {
              class: (state.selectedCommit === key ? 'selected ' : '') + (analysis.avoidable ? 'has-avoid' : ''),
              onclick: () => {
                state.selectedCommit = key;
                state.tab = 'commit';
                renderLeft();
                renderDetails();
              },
            },
            [
              el('span', { class: 'id', text: key > 0 ? `#${key}` : '\u2014' }),
              el('span', { class: 't', text: fmtTime(analysis.receivedAt) }),
              el('span', { class: 'n', text: `${analysis.total} render${analysis.total === 1 ? '' : 's'}` }),
              analysis.avoidable ? el('span', { class: 'badge avoid', text: `${analysis.avoidable} avoidable` }) : el('span', { class: 'badge', text: 'ok' }),
              el('span', { class: 'root', text: root ? `\u2190 <${root.name}> (${root.trigger})` : '' }),
            ],
          ),
        );
      }
      table.append(list);
    }

    function renderFixes() {
      table.textContent = '';
      const fixes = rankFixes(filteredReports());
      const contexts = contextAttribution(filteredReports());
      if (!fixes.length && !contexts.length) {
        table.append(el('div', { class: 'empty', text: 'No avoidable re-renders, nothing to fix.' }));
        return;
      }
      if (fixes.length) {
        const list = el('ol', { class: 'fixes' });
        for (const f of fixes) {
          list.append(
            el(
              'li',
              {
                class: state.selectedFix === f.key ? 'selected' : '',
                onclick: () => {
                  state.selectedFix = f.key;
                  state.tab = 'fixlist';
                  renderLeft();
                  renderDetails();
                },
              },
              [
                el('span', { class: 'badge avoid', title: 'avoidable re-renders removed', text: String(f.count) }),
                el('span', { class: 'label', text: f.label }),
                el('span', { class: 'meta', text: [...f.components].map(([c, n]) => `<${c}>${n > 1 ? ' \u00D7' + n : ''}`).join(', ') }),
              ],
            ),
          );
        }
        table.append(el('div', { class: 'section-title', text: 'Ranked by avoidable re-renders removed' }), list);
      }
      if (contexts.length) {
        const list = el('ul', { class: 'contexts' });
        for (const c of contexts) {
          list.append(
            el('li', null, [
              el('span', { class: 'name', text: c.name }),
              el('span', { class: 'meta', text: ` changed in ${c.commits.size} commit${c.commits.size === 1 ? '' : 's'}, ${c.consumers} consumer re-render${c.consumers === 1 ? '' : 's'}${c.avoidable ? `, ${c.avoidable} with an equal value` : ''}: ${[...c.components].map(([n, k]) => `<${n}>${k > 1 ? ' \u00D7' + k : ''}`).join(', ')}` }),
            ]),
          );
        }
        table.append(el('div', { class: 'section-title', text: 'Contexts' }), list);
      }
    }

    // ---------- details ----------
    function renderDetails() {
      const openLabels = new Set([...details.querySelectorAll('details.obj[open] > summary')].map((x) => x.textContent));
      details.textContent = '';
      if (state.tab === 'commit' && state.selectedCommit !== null) renderCommitDetails();
      else if (state.tab === 'fixlist' && state.selectedFix) renderFixDetails();
      else renderNodeDetails(state.selectedKey ? state.nodesByKey.get(state.selectedKey) : null);
      if (openLabels.size) {
        for (const d of details.querySelectorAll('details.obj')) {
          if (openLabels.has(d.querySelector('summary').textContent)) d.open = true;
        }
      }
    }

    const reportActions = () => ({
      openSource: transport && transport.openResource ? (src) => transport.openResource(src.fileName, src.lineNumber, src.columnNumber) : null,
      highlight: transport && transport.highlight ? (id) => transport.highlight(id) : null,
      copy: copyText,
    });

    function tabButton(id, label, onclick) {
      return el('button', { class: state.tab === id ? 'active' : '', onclick }, label);
    }

    function renderNodeDetails(node) {
      if (!node) {
        details.append(el('div', { class: 'empty', text: 'Select a component to see why it re-rendered.' }));
        return;
      }
      const header = el('div', { class: 'details-header' }, [
        el('span', { class: 'title' }, [
          el('span', { class: 'bracket', text: '<' }),
          el('span', { class: 'name', text: node.name }),
          el('span', { class: 'bracket', text: '>' }),
        ]),
        el('span', { class: 'meta', text: `${node.total} re-render${node.total === 1 ? '' : 's'}, ${node.avoidable} avoidable${node.wasted ? ', ' + fmtMs(node.wasted) + ' wasted' : ''}` }),
        el('span', { class: 'tabs' }, [
          tabButton('latest', 'Report', () => {
            state.tab = 'latest';
            state.selectedReport = node.lastReport;
            renderDetails();
          }),
          tabButton('history', `History (${node.reports.length})`, () => {
            state.tab = 'history';
            renderDetails();
          }),
          tabButton('fix', 'Fix', () => {
            state.tab = 'fix';
            renderDetails();
          }),
        ]),
      ]);
      details.append(header);
      const body = el('div', { class: 'details-body' });
      details.append(body);
      if (state.tab === 'history') {
        const list = el('ul', { class: 'history' });
        for (const r of [...node.reports].reverse()) {
          list.append(
            el(
              'li',
              {
                class: state.selectedReport === r ? 'selected' : '',
                onclick: () => {
                  state.selectedReport = r;
                  state.tab = 'latest';
                  renderDetails();
                },
              },
              [
                el('span', { class: 't', text: fmtTime(r.receivedAt) }),
                el('span', { class: 'n', text: '#' + r.renderCount }),
                el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }),
                el('span', { class: 'sum', text: summarize(r) }),
              ],
            ),
          );
        }
        body.append(list);
        return;
      }
      if (state.tab === 'fix') {
        body.append(fixView(rankFixes(node.reports), { copy: copyText }));
        return;
      }
      const r = state.selectedReport || node.lastReport;
      if (!r) return;
      body.append(reportView(r, reportActions()));
    }

    function renderCommitDetails() {
      const reports = state.commits.get(state.selectedCommit);
      if (!reports) {
        details.append(el('div', { class: 'empty', text: 'This commit is no longer buffered.' }));
        return;
      }
      const a = analyzeCommit(reports);
      details.append(
        el('div', { class: 'details-header' }, [
          el('span', { class: 'title', text: state.selectedCommit > 0 ? `Commit #${state.selectedCommit}` : 'Commit' }),
          el('span', { class: 'meta', text: `${a.total} render${a.total === 1 ? '' : 's'}, ${a.avoidable} avoidable${a.wasted ? ', ' + fmtMs(a.wasted) + ' wasted' : ''} \u00B7 ${fmtTime(a.receivedAt)}` }),
        ]),
      );
      const body = el('div', { class: 'details-body' });
      details.append(body);
      if (a.roots.length) {
        body.append(
          el('div', { class: 'section' }, [
            el('h3', { text: 'Root causes' }),
            el(
              'ul',
              { class: 'roots' },
              a.roots.map((root) =>
                el('li', null, [
                  el('b', { text: `<${root.name}>` }),
                  ` (${root.trigger}) \u2192 ${root.count} avoidable re-render${root.count === 1 ? '' : 's'}: `,
                  el('span', { class: 'meta', text: [...root.components].map(([c, n]) => `<${c}>${n > 1 ? ' \u00D7' + n : ''}`).join(', ') }),
                ]),
              ),
            ),
          ]),
        );
      }
      if (a.contexts.length) {
        body.append(
          el('div', { class: 'section' }, [
            el('h3', { text: 'Contexts that changed' }),
            el('ul', { class: 'roots' }, a.contexts.map((c) => el('li', null, [el('b', { text: c.name }), ` \u2192 ${c.consumers} consumer${c.consumers === 1 ? '' : 's'} re-rendered${c.avoidable ? ` (${c.avoidable} with an equal value)` : ''}`]))),
          ]),
        );
      }
      const cascade = el('div', { class: 'cascade' });
      const walk = (node, depth) => {
        for (const child of node.children.values()) {
          const r = child.report;
          const line = el(
            'div',
            {
              class: 'cascade-row' + (r ? (r.avoidable ? ' avoid' : ' ok') : ' untracked'),
              style: `padding-left:${depth * 14}px`,
              onclick: r
                ? () => {
                    const n = nodeFor([].concat(r.path, [r.component]));
                    select(n, r);
                  }
                : null,
            },
            [
              el('span', { class: 'tag' }, [el('span', { class: 'bracket', text: '<' }), el('span', { class: 'name', text: child.name }), el('span', { class: 'bracket', text: '>' })]),
              r ? el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }) : el('span', { class: 'meta', text: 'did not render or untracked' }),
              child.count > 1 ? el('span', { class: 'meta', text: ` \u00D7${child.count}` }) : null,
              r && r.avoidable ? el('span', { class: 'meta', text: ' ' + summarize(r) }) : null,
            ],
          );
          cascade.append(line);
          walk(child, depth + 1);
        }
      };
      walk(cascadeTree(reports), 0);
      body.append(el('div', { class: 'section' }, [el('h3', { text: 'Render cascade' }), cascade]));
      if (a.fixes.length) {
        body.append(el('div', { class: 'section-title', text: 'Fixes for this commit' }));
        body.append(fixView(a.fixes, { copy: copyText }));
      }
    }

    function renderFixDetails() {
      const fix = rankFixes(filteredReports()).find((f) => f.key === state.selectedFix);
      if (!fix) {
        details.append(el('div', { class: 'empty', text: 'Select a fix.' }));
        return;
      }
      details.append(el('div', { class: 'details-header' }, [el('span', { class: 'title', text: fix.label }), el('span', { class: 'meta', text: `removes ${fix.count} avoidable re-render${fix.count === 1 ? '' : 's'}` })]));
      const body = el('div', { class: 'details-body' });
      details.append(body);
      body.append(fixView([fix], { copy: copyText }));
      const list = el('ul', { class: 'history' });
      for (const r of fix.reports.slice().reverse()) {
        list.append(
          el(
            'li',
            {
              onclick: () => {
                select(nodeFor([].concat(r.path, [r.component])), r);
              },
            },
            [el('span', { class: 't', text: fmtTime(r.receivedAt) }), el('span', { class: 'comp', text: `<${r.component}>` }), el('span', { class: 'sum', text: summarize(r) })],
          ),
        );
      }
      body.append(el('div', { class: 'section' }, [el('h3', { text: 'Affected re-renders' }), list]));
    }

    // ---------- stream ----------
    let streamShown = 0;
    function streamItem(r) {
      return el(
        'li',
        {
          onclick: () => {
            const node = nodeFor([].concat(r.path || [], [r.component]));
            select(node, r);
          },
        },
        [
          el('span', { class: 't', text: fmtTime(r.receivedAt) }),
          el('span', { class: 'c', text: r.component }),
          el('span', { class: 'v ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'avoidable' : r.trigger }),
          el('span', { class: 's', text: summarize(r) }),
        ],
      );
    }

    /** Full rebuild: used after clear and filter changes. */
    function renderStream() {
      streamList.textContent = '';
      const items = state.avoidableOnly ? state.reports.filter((r) => r.avoidable) : state.reports;
      streamShown = items.length;
      streamCount.textContent = `${streamShown} report${streamShown === 1 ? '' : 's'}`;
      const frag = document.createDocumentFragment();
      for (const r of items.slice(-MAX_STREAM).reverse()) frag.append(streamItem(r));
      streamList.append(frag);
    }

    /** Incremental: prepend one item, keep existing elements (and any click in progress) intact. */
    function appendToStream(r) {
      if (state.avoidableOnly && !r.avoidable) return;
      streamShown++;
      streamCount.textContent = `${streamShown} report${streamShown === 1 ? '' : 's'}`;
      streamList.prepend(streamItem(r));
      while (streamList.childElementCount > MAX_STREAM) streamList.lastElementChild.remove();
    }

    // ---------- export / import ----------
    function exportJson() {
      const data = { rerenderLens: true, version: PROTOCOL, exportedAt: new Date().toISOString(), origin: state.origin, reports: state.reports };
      const text = JSON.stringify(data, null, 2);
      const name = `rerender-lens-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      if (call('download', name, text) === undefined) {
        try {
          const blob = new Blob([text], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          copyText(text);
        }
      }
    }

    function importData(data) {
      const reports = Array.isArray(data) ? data : data && Array.isArray(data.reports) ? data.reports : null;
      if (!reports) throw new Error('not a rerender-lens export');
      clearAll();
      let n = 0;
      for (const p of reports) {
        const r = normalizeReport(p);
        if (r) {
          enqueue(r);
          n++;
        }
      }
      flush();
      toast(`Imported ${n} report${n === 1 ? '' : 's'}`);
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

    // ---------- status / settings ----------
    function renderStatus() {
      const lib = state.library;
      let text;
      let cls = 'none';
      let title = '';
      if (lib) {
        const react = lib.react && lib.react[0];
        text = `connected \u00B7 lib ${lib.library || '?'}${react && react.version ? ` \u00B7 React ${react.version}` : ''}${lib.production ? ' (prod)' : ''}`;
        cls = 'connected';
        title = state.relay ? 'live via content script' : 'polling the page';
      } else if (state.relay || state.polling) {
        text = 'no library in page';
        cls = 'partial';
        title = 'rerender-lens is not running in this page';
      } else {
        text = 'no page';
      }
      status.className = 'status ' + cls;
      status.title = title;
      status.querySelector('.status-text').textContent = text;
      // warnings
      banner.textContent = '';
      const warnings = [];
      if (lib && typeof lib.protocol === 'number' && lib.protocol !== PROTOCOL) {
        warnings.push(
          lib.protocol < PROTOCOL
            ? `The page runs rerender-lens ${lib.library || ''} (protocol ${lib.protocol}); this panel expects protocol ${PROTOCOL}. Update the rerender-lens package for commit grouping, source links and settings.`
            : `The page runs a newer rerender-lens (protocol ${lib.protocol}) than this panel (${PROTOCOL}). Update the extension.`,
        );
      }
      if (lib && lib.production) warnings.push('Production React build detected: component names may be minified and hooks are unlabeled. Use a development build.');
      if (lib && lib.enabled === false) warnings.push('rerender-lens is present but disabled in this page.');
      banner.hidden = warnings.length === 0;
      for (const w of warnings) banner.append(el('div', { text: w }));
    }

    function setRelay(on) {
      state.relay = on;
      if (!on) state.library = null;
      renderStatus();
    }

    function setLibrary(info) {
      state.library = info && typeof info === 'object' ? info : { library: '?', protocol: 1 };
      renderStatus();
      if (state.settingsOpen) renderSettings();
      if (state.flashOn) call('flashAvoidable', true);
    }

    function toggleSettings(open) {
      state.settingsOpen = open === undefined ? !state.settingsOpen : open;
      settings.hidden = !state.settingsOpen;
      settingsBtn.classList.toggle('active', state.settingsOpen);
      if (state.settingsOpen) renderSettings();
    }

    function optionRow(label, key, current, onchange) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!current[key];
      input.addEventListener('change', () => onchange({ [key]: input.checked }));
      return el('label', { class: 'opt' }, [input, label]);
    }

    async function renderSettings() {
      settings.textContent = '';
      settings.append(el('div', { class: 'drawer-header' }, [el('b', { text: 'Settings' }), el('button', { onclick: () => toggleSettings(false) }, '\u2715')]));
      const body = el('div', { class: 'drawer-body' });
      settings.append(body);

      // --- site ---
      if (transport && transport.originStatus) {
        const site = el('div', { class: 'section' }, [el('h3', { text: 'This site' }), el('div', { class: 'meta', text: state.origin || '' })]);
        body.append(site);
        try {
          const st = await transport.originStatus();
          if (st) {
            const enabled = el('input', { type: 'checkbox' });
            enabled.checked = st.enabled;
            enabled.disabled = st.builtIn;
            const inject = el('input', { type: 'checkbox' });
            inject.checked = st.inject;
            inject.disabled = !st.enabled;
            const msg = el('div', { class: 'meta' });
            const apply = async () => {
              try {
                if (enabled.checked && !st.permitted && transport.requestPermission) {
                  const ok = await transport.requestPermission();
                  if (!ok) {
                    msg.textContent = 'Permission not granted. You can also enable the site from the toolbar icon.';
                    enabled.checked = false;
                    return;
                  }
                }
                await transport.setOrigin({ enabled: enabled.checked, inject: enabled.checked && inject.checked });
                renderSettings();
              } catch (e) {
                msg.textContent = String(e && e.message ? e.message : e);
              }
            };
            enabled.addEventListener('change', () => {
              if (!enabled.checked) inject.checked = false;
              apply();
            });
            inject.addEventListener('change', apply);
            site.append(
              el('label', { class: 'opt' }, [enabled, st.builtIn ? 'Enabled (local development host)' : 'Enable on this site']),
              el('label', { class: 'opt' }, [inject, 'Inject the library into the page (no app code needed)']),
              el('div', { class: 'meta', text: st.inject ? 'Injection is on. Reload the page after changing it.' : 'Without injection the page must call init({ notifier: createDevtoolsNotifier() }).' }),
              msg,
            );
          }
        } catch (e) {
          site.append(el('div', { class: 'meta', text: String(e && e.message ? e.message : e) }));
        }
      }

      // --- panel ---
      const flash = el('input', { type: 'checkbox' });
      flash.checked = state.flashOn;
      flash.addEventListener('change', () => {
        state.flashOn = flash.checked;
        call('flashAvoidable', state.flashOn);
        persist();
      });
      body.append(el('div', { class: 'section' }, [el('h3', { text: 'Panel' }), el('label', { class: 'opt' }, [flash, 'Flash avoidable re-renders in the page'])]));

      // --- library options ---
      const lib = state.library;
      const sec = el('div', { class: 'section' }, [el('h3', { text: 'Library options' })]);
      body.append(sec);
      if (!lib || !transport || !transport.configure) {
        sec.append(el('div', { class: 'meta', text: 'Connect to a page running rerender-lens to change its options.' }));
        return;
      }
      if (lib.protocol < PROTOCOL) {
        sec.append(el('div', { class: 'meta', text: 'The page library is too old to be configured from here.' }));
        return;
      }
      const current = Object.assign({}, lib.options || {});
      const applyOptions = async (patch) => {
        Object.assign(current, patch);
        try {
          const applied = await transport.configure(patch);
          if (applied) state.library.options = applied;
          if (transport.storage) transport.storage.set('settings', Object.assign({}, state.library.options));
          toast('Applied');
        } catch (e) {
          toast(`Failed: ${e.message}`);
        }
      };
      sec.append(
        optionRow('Track every React.memo / PureComponent', 'trackAllMemoized', current, applyOptions),
        optionRow('Track every component (noisy)', 'trackAllComponents', current, applyOptions),
        optionRow('Diff hook state and contexts', 'trackHooks', { trackHooks: current.trackHooks !== false }, applyOptions),
        optionRow('Ignore Fast Refresh commits', 'ignoreHotReload', { ignoreHotReload: current.ignoreHotReload !== false }, applyOptions),
        optionRow('Print to the page console', 'silent', { silent: !current.silent }, (p) => applyOptions({ silent: !p.silent })),
        optionRow('Print genuine re-renders too (logAll)', 'logAll', current, applyOptions),
      );
      const listInput = (label, key) => {
        const input = el('input', { type: 'text', placeholder: 'Name, /regex/, ...', value: (current[key] || []).join(', ') });
        input.addEventListener('change', () => applyOptions({ [key]: input.value.split(',').map((s) => s.trim()).filter(Boolean) }));
        return el('label', { class: 'opt col' }, [label, input]);
      };
      sec.append(listInput('Include (display names)', 'include'), listInput('Exclude', 'exclude'));
      const max = el('input', { type: 'number', min: '0', value: String(current.maxReportsPerComponent || 0) });
      max.addEventListener('change', () => applyOptions({ maxReportsPerComponent: Math.max(0, Number(max.value) || 0) }));
      sec.append(el('label', { class: 'opt col' }, ['Stop printing a component after N reports (0 = never)', max]));
    }

    // ---------- transport ----------
    function handle(message) {
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'connected':
          setRelay(true);
          break;
        case 'disconnected':
          setRelay(false);
          break;
        case 'polling':
          state.polling = !!message.on;
          renderStatus();
          break;
        case 'hello':
          setLibrary(message.payload && typeof message.payload === 'object' ? Object.assign({ protocol: message.version || 1 }, message.payload) : { protocol: message.version || 1 });
          break;
        case 'clear':
        case 'navigated':
          clearAll();
          if (message.type === 'navigated') {
            state.library = null;
            renderStatus();
          }
          break;
        case 'report': {
          if (state.paused) break;
          const r = normalizeReport(message.payload);
          if (r) enqueue(r);
          break;
        }
      }
    }

    if (options.theme === 'dark') document.documentElement.classList.add('theme-dark');
    state.origin = (transport && transport.origin) || null;
    setView(state.view);
    renderDetails();
    renderStream();
    renderStatus();
    if (transport && transport.storage) {
      Promise.resolve(transport.storage.get('panel')).then(restore, () => {});
    }
    transport.subscribe(handle);

    return {
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
    };
  }

  // ---------- boot: extension ----------
  function bootExtension() {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    let listener = null;
    let relayConnected = false;
    let pollTimer = null;
    let since = 0;
    const evalIn = (code) =>
      new Promise((resolve, reject) =>
        chrome.devtools.inspectedWindow.eval(code, (result, err) => {
          if (err && (err.isException || err.isError)) reject(new Error(err.value || err.description || 'eval failed'));
          else resolve(result);
        }),
      );
    const bridge = (expr) => evalIn(`(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;if(!b)return null;try{return (${expr});}catch(e){return {__error:String(e)}}})()`).then((r) => {
      if (r && r.__error) throw new Error(r.__error);
      return r;
    });
    const send = (message) =>
      new Promise((resolve, reject) =>
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (!res || !res.ok) reject(new Error((res && res.error) || 'no response'));
          else resolve(res.result);
        }),
      );
    let origin = null;
    let panelPort = null;
    const emit = (m) => listener && listener(m);

    async function resolveOrigin() {
      try {
        origin = await evalIn('location.origin');
      } catch {
        origin = null;
      }
      transport.origin = origin;
    }

    /** Ask the page for its hello and, when the relay is down, poll `pull()` for reports. */
    async function syncWithPage() {
      try {
        const info = await bridge('b.info?b.info():{count:b.size,protocol:b.version}');
        if (info) {
          emit({ type: 'hello', version: info.protocol || 1, payload: info });
          return true;
        }
      } catch {
        /* page not ready */
      }
      return false;
    }

    async function pollOnce() {
      try {
        const res = await bridge(`b.pull?b.pull(${since}):null`);
        if (!res) return;
        if (res.dropped) emit({ type: 'clear' });
        for (const p of res.reports) emit({ type: 'report', payload: p });
        since = res.seq;
      } catch {
        /* ignore */
      }
    }

    function setPolling(on) {
      if (on && !pollTimer) {
        pollTimer = setInterval(pollOnce, 500);
        emit({ type: 'polling', on: true });
      } else if (!on && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        emit({ type: 'polling', on: false });
      }
    }

    const transport = {
      origin,
      subscribe(fn) {
        listener = fn;
        connect();
        chrome.devtools.network.onNavigated.addListener(async () => {
          since = 0;
          fn({ type: 'navigated' });
          await resolveOrigin();
          setTimeout(async () => {
            if (relayConnected) bridge('b.replay()').catch(() => {});
            else if (await syncWithPage()) setPolling(true);
          }, 1200);
        });
        resolveOrigin().then(async () => {
          // Late panel: the relay (if any) buffered nothing, so ask the page to replay; otherwise start polling.
          if (!(await syncWithPage())) return;
          if (relayConnected) bridge('b.replay()').catch(() => {});
          else {
            const res = await bridge('b.pull?b.pull(0):null').catch(() => null);
            if (res) {
              for (const p of res.reports) emit({ type: 'report', payload: p });
              since = res.seq;
            } else bridge('b.replay()').catch(() => {});
            setPolling(true);
          }
        });
      },
      replay() {
        if (relayConnected) bridge('b.replay()').catch(() => {});
        else {
          since = 0;
          emit({ type: 'clear' });
          syncWithPage().then(() => pollOnce());
        }
      },
      clear() {
        bridge('b.clear()').catch(() => {});
        since = 0;
      },
      configure: (options) => bridge(`b.configure(${JSON.stringify(options)})`),
      highlight: (id) => bridge(`b.highlight(${id === null ? 'null' : Number(id)})`).catch(() => {}),
      flashAvoidable: (on) => bridge(`b.flashAvoidable(${!!on})`).catch(() => {}),
      openResource(url, line, col) {
        if (chrome.devtools.panels.openResource) chrome.devtools.panels.openResource(url, Math.max(0, (line || 1) - 1), Math.max(0, (col || 1) - 1), () => {});
      },
      originStatus: () => (origin ? send({ type: 'origin:status', origin }) : Promise.resolve(null)),
      setOrigin: (cfg) => send({ type: 'origin:set', origin, enabled: cfg.enabled, inject: cfg.inject }),
      requestPermission: () => chrome.permissions.request({ origins: [origin + '/*'] }),
      storage: {
        get: (key) => new Promise((resolve) => chrome.storage.local.get(`${key}:${origin}`, (got) => resolve(got ? got[`${key}:${origin}`] : undefined))),
        set: (key, value) => new Promise((resolve) => chrome.storage.local.set({ [`${key}:${origin}`]: value }, resolve)),
      },
      badge(count) {
        if (panelPort) panelPort.postMessage({ type: 'badge', count });
      },
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
    };

    function connect() {
      panelPort = chrome.runtime.connect({ name: 'rerender-lens-panel' });
      panelPort.postMessage({ type: 'init', tabId });
      panelPort.onMessage.addListener((m) => {
        if (!m) return;
        if (m.type === 'connected') {
          relayConnected = true;
          setPolling(false);
        } else if (m.type === 'disconnected') {
          relayConnected = false;
          syncWithPage().then((ok) => ok && setPolling(true));
        }
        emit(m);
      });
      panelPort.onDisconnect.addListener(() => {
        panelPort = null;
        setTimeout(connect, 1000);
      });
    }
    const prefersDark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = chrome.devtools.panels.themeName === 'dark' || prefersDark ? 'dark' : 'light';
    createPanel(document.getElementById('root'), transport, { theme });
  }

  // ---------- boot: demo ----------
  function sampleReports() {
    const fn = (name) => FN_PREFIX + name;
    return [
      {
        component: 'ProductRow', path: ['App', 'ProductPage', 'ProductList'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 4, commitId: 1,
        owner: 'ProductList', parent: { name: 'ProductPage', trigger: 'state' }, selfDuration: 0.8,
        source: { fileName: 'http://localhost:5199/src/ProductList.tsx', lineNumber: 14, columnNumber: 7 },
        props: {
          prev: { product: { id: 1, name: 'Keyboard', price: 49 }, style: { color: 'red' }, onSelect: fn('onSelect'), selected: false },
          next: { product: { id: 1, name: 'Keyboard', price: 49 }, style: { color: 'red' }, onSelect: fn('onSelect'), selected: false },
        },
        propChanges: [
          { path: 'style', kind: 'deep-equal', prev: { color: 'red' }, next: { color: 'red' } },
          { path: 'onSelect', kind: 'function', prev: fn('onSelect'), next: fn('onSelect') },
        ],
        stateChanges: [], hookChanges: [],
        reasons: [
          'caused by <ProductPage> re-rendering (its state changed).',
          'prop "style" is a new reference but deep-equal to the previous value: memoize the object with useMemo, or hoist it to module scope if it is constant.',
          'prop "onSelect" is a new function instance on every render: wrap it in useCallback (or hoist it out of the parent\'s render).',
        ],
      },
      {
        component: 'Toolbar', path: ['App', 'ProductPage'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 2, commitId: 1,
        owner: 'ProductPage', parent: { name: 'ProductPage', trigger: 'state' }, selfDuration: 0.3,
        props: { prev: { title: 'Products', count: 3 }, next: { title: 'Products', count: 3 } }, propChanges: [], stateChanges: [], hookChanges: [],
        reasons: ['re-rendered with identical props because <ProductPage> re-rendered (its state changed). Wrap "Toolbar" in React.memo (or extend PureComponent).'],
      },
      {
        component: 'ProductPage', path: ['App'], trigger: 'state', avoidable: false, renderCount: 1, instanceId: 3, commitId: 1,
        owner: 'App', parent: null,
        props: { prev: { placeholder: 'Search' }, next: { placeholder: 'Search' } }, propChanges: [], stateChanges: [],
        hookChanges: [{ path: 'useState#0', hook: 'useState', index: 0, kind: 'different', prev: 'ab', next: 'abc' }], reasons: ['useState #0 changed.'],
      },
      {
        component: 'Sidebar', path: ['App'], trigger: 'hooks', avoidable: false, renderCount: 1, instanceId: 5, owner: 'App', parent: null, commitId: 2,
        props: { prev: {}, next: {} }, propChanges: [], stateChanges: [],
        hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: 'light', next: 'dark' }], reasons: ['useContext #0 changed.'],
      },
    ];
  }

  function bootDemo() {
    const sample = sampleReports();
    let i = 0;
    let commit = 0;
    const mem = {};
    const transport = {
      origin: 'http://localhost:5199',
      subscribe(fn) {
        fn({ type: 'connected' });
        fn({ type: 'hello', version: PROTOCOL, payload: { count: 0, library: 'demo', protocol: PROTOCOL, react: [{ version: '19.2.0', bundleType: 1 }], production: false, enabled: true, options: { trackAllMemoized: true, silent: true } } });
        const tick = () => {
          const r = JSON.parse(JSON.stringify(sample[i % sample.length]));
          r.renderCount = Math.floor(i / sample.length) + 1;
          if (i % sample.length === 0) commit++;
          r.commitId = commit + (r.commitId === 2 ? 100 : 0);
          fn({ type: 'report', payload: r });
          i++;
          if (i < 14) setTimeout(tick, i < 4 ? 50 : 900);
        };
        tick();
      },
      replay() {},
      clear() {},
      configure: (o) => Promise.resolve(o),
      highlight() {},
      flashAvoidable() {},
      originStatus: () => Promise.resolve({ origin: 'http://localhost:5199', builtIn: true, permitted: true, enabled: true, inject: false }),
      setOrigin: () => Promise.resolve(),
      storage: { get: (k) => Promise.resolve(mem[k]), set: (k, v) => Promise.resolve((mem[k] = v)) },
    };
    const dark = /theme=dark/.test(location.search) || (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    createPanel(document.getElementById('root'), transport, { theme: dark ? 'dark' : 'light' });
  }

  global.RerenderLensPanel = {
    PROTOCOL,
    createPanel,
    summarize,
    valueNode,
    reportView,
    fixView,
    normalizeReport,
    reportToMarkdown,
    sampleReports,
    analysis: { firstDifferentPath, fixesFor, rankFixes, rootCauseOf, analyzeCommit, contextAttribution, cascadeTree },
  };
  if (global.chrome && global.chrome.devtools && global.chrome.devtools.inspectedWindow && /panel\.html/.test(String(global.location && global.location.pathname))) bootExtension();
  else if (typeof location !== 'undefined' && /[?&]demo/.test(location.search)) bootDemo();
})(typeof window !== 'undefined' ? window : globalThis);
