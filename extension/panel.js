/* rerender-lens DevTools panel. Plain JS, no build step.
 * Exposes window.RerenderLensPanel.createPanel(root, transport) for tests and demo mode. */
(function (global) {
  'use strict';

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

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) node.setAttribute(k, v);
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

  function summarize(report) {
    const counts = new Map();
    for (const c of [].concat(report.propChanges || [], report.stateChanges || [], report.hookChanges || [])) {
      counts.set(c.kind, (counts.get(c.kind) || 0) + 1);
    }
    if (counts.size === 0) return 'no changes';
    return [...counts].map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(', ');
  }

  /** Render a serialized value (see library `serialize`). */
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

  function createPanel(root, transport, options) {
    options = options || {};
    const state = {
      tree: { name: '', children: new Map(), reports: [], total: 0, avoidable: 0, expanded: true, path: [] },
      nodesByKey: new Map(),
      reports: [],
      selectedKey: null,
      selectedReport: null,
      tab: 'latest',
      paused: false,
      avoidableOnly: false,
      filter: '',
      connected: false,
      streamCollapsed: false,
    };

    // ---------- DOM skeleton ----------
    root.textContent = '';
    const search = el('input', {
      type: 'search',
      placeholder: 'Search components (text or /regex/)',
      oninput: () => {
        state.filter = search.value;
        renderTree();
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
          if (transport.clear) transport.clear();
        },
      },
      '\u2298 Clear',
    );
    const replayBtn = el(
      'button',
      { title: 'Replay buffered reports from the page', onclick: () => transport.replay && transport.replay() },
      '\u21BB Replay',
    );
    const avoidCheck = el('input', {
      type: 'checkbox',
      onchange: () => {
        state.avoidableOnly = avoidCheck.checked;
        renderTree();
        renderStream();
      },
    });
    const status = el('span', { class: 'status' }, [el('span', { class: 'dot' }), el('span', { class: 'status-text', text: 'no page' })]);
    const toolbar = el('div', { class: 'toolbar' }, [
      search,
      el('span', { class: 'sep' }),
      pauseBtn,
      clearBtn,
      replayBtn,
      el('span', { class: 'sep' }),
      el('label', null, [avoidCheck, 'Avoidable only']),
      el('span', { class: 'spacer' }),
      status,
    ]);
    const tree = el('div', { class: 'tree', tabindex: '0', onkeydown: onTreeKey });
    const details = el('div', { class: 'details' });
    const main = el('div', { class: 'main' }, [tree, details]);
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
          },
        },
        [el('span', { text: '\u25BE Live stream' }), streamCount],
      ),
      streamList,
    ]);
    root.append(toolbar, main, stream);

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
          n = { name: path[i], children: new Map(), reports: [], total: 0, avoidable: 0, expanded: true, path: path.slice(0, i + 1), key: k };
          state.nodesByKey.set(k, n);
          parent.children.set(path[i], n);
        }
        parent = n;
      }
      return parent;
    }

    function addReport(report) {
      report.receivedAt = Date.now();
      state.reports.push(report);
      if (state.reports.length > 2000) state.reports.shift();
      const node = nodeFor([].concat(report.path || [], [report.component]));
      node.reports.push(report);
      if (node.reports.length > 200) node.reports.shift();
      node.total++;
      if (report.avoidable) node.avoidable++;
      node.lastReport = report;
      node.flash = true;
      renderTree();
      appendToStream(report);
      if (state.selectedKey === node.key) {
        if (state.tab === 'latest') state.selectedReport = report;
        renderDetails();
      }
    }

    function clearAll() {
      state.tree.children.clear();
      state.nodesByKey.clear();
      state.reports = [];
      state.selectedKey = null;
      state.selectedReport = null;
      renderTree();
      renderDetails();
      renderStream();
    }

    function matchesFilter(node) {
      if (!state.filter) return true;
      const f = state.filter.trim();
      const m = /^\/(.+)\/([a-z]*)$/.exec(f);
      if (m) {
        try {
          return new RegExp(m[1], m[2]).test(node.name);
        } catch {
          /* invalid regex: fall through to text */
        }
      }
      return node.name.toLowerCase().includes(f.toLowerCase());
    }

    /** A node is shown if it or any descendant matches the filter (and has avoidable reports when that filter is on). */
    function visible(node) {
      const own = (!state.avoidableOnly || node.avoidable > 0) && matchesFilter(node) && node.total > 0;
      if (own) return true;
      for (const c of node.children.values()) if (visible(c)) return true;
      return false;
    }

    // ---------- tree ----------
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
            el('div', null, ['Call ', el('code', { text: 'init({ notifier: createDevtoolsNotifier() })' }), ' in the page, then interact with it.']),
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

    function rowFor(node, depth) {
      let row = rowEls.get(node.key);
      if (!row) {
        row = el('div', { class: 'row', 'data-key': node.key, role: 'treeitem', onclick: () => select(node), onanimationend: () => row.classList.remove('flash') });
        row.append(el('span', { class: 'indent' }));
        row.append(
          el('span', {
            class: 'chevron',
            onclick: (e) => {
              e.stopPropagation();
              node.expanded = !node.expanded;
              renderTree();
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

    function select(node, report) {
      state.selectedKey = node.key;
      state.selectedReport = report || node.lastReport || null;
      if (report) state.tab = 'latest';
      renderTree();
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
        flatRows[idx].expanded = true;
        renderTree();
      } else if (e.key === 'ArrowLeft' && idx >= 0) {
        flatRows[idx].expanded = false;
        renderTree();
      }
    }

    // ---------- details ----------
    function renderDetails() {
      const openLabels = new Set([...details.querySelectorAll('details.obj[open] > summary')].map((x) => x.textContent));
      details.textContent = '';
      const node = state.selectedKey ? state.nodesByKey.get(state.selectedKey) : null;
      renderDetailsInner(node);
      if (openLabels.size) {
        for (const d of details.querySelectorAll('details.obj')) {
          if (openLabels.has(d.querySelector('summary').textContent)) d.open = true;
        }
      }
    }

    function renderDetailsInner(node) {
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
        el('span', { class: 'meta', text: `${node.total} re-render${node.total === 1 ? '' : 's'}, ${node.avoidable} avoidable` }),
        el('span', { class: 'tabs' }, [
          el(
            'button',
            {
              class: state.tab === 'latest' ? 'active' : '',
              onclick: () => {
                state.tab = 'latest';
                state.selectedReport = node.lastReport;
                renderDetails();
              },
            },
            'Report',
          ),
          el(
            'button',
            {
              class: state.tab === 'history' ? 'active' : '',
              onclick: () => {
                state.tab = 'history';
                renderDetails();
              },
            },
            `History (${node.reports.length})`,
          ),
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
      const r = state.selectedReport || node.lastReport;
      if (!r) return;
      body.append(reportView(r));
    }

    function reportView(r) {
      const frag = document.createDocumentFragment();
      const duration = typeof r.selfDuration === 'number' ? ` \u00B7 ${r.selfDuration.toFixed(1)} ms` : '';
      frag.append(
        el('div', { class: 'section' }, [
          el('h3', { text: 'Why did this render?' }),
          el('div', null, [
            el('span', { class: 'verdict ' + (r.avoidable ? 'avoid' : 'ok'), text: r.avoidable ? 'Avoidable re-render' : `Re-render (${r.trigger})` }),
            el('span', { class: 'meta', text: `  #${r.renderCount} \u00B7 ${summarize(r)}${duration}` }),
          ]),
          el('ul', { class: 'reasons' }, (r.reasons || []).map((x) => el('li', { text: x }))),
        ]),
      );
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

    function changeRow(label, c, suffix) {
      const tr = el('tr', { class: 'changed' + (AVOIDABLE_KINDS.has(c.kind) ? '' : ' real') });
      tr.append(el('td', { class: 'k', text: label }));
      const td = el('td');
      td.append(valueNode(c.prev), el('span', { class: 'arrow', text: '\u2192' }));
      td.append(c.kind === 'removed' ? el('span', { class: 'v nil', text: '(removed)' }) : valueNode(c.next));
      td.append(el('span', { class: 'kind', text: (KIND_LABEL[c.kind] || c.kind) + (suffix || '') }));
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
      for (const r of items.slice(-300).reverse()) frag.append(streamItem(r));
      streamList.append(frag);
    }

    /** Incremental: prepend one item, keep existing elements (and any click in progress) intact. */
    function appendToStream(r) {
      if (state.avoidableOnly && !r.avoidable) return;
      streamShown++;
      streamCount.textContent = `${streamShown} report${streamShown === 1 ? '' : 's'}`;
      streamList.prepend(streamItem(r));
      while (streamList.childElementCount > 300) streamList.lastElementChild.remove();
    }

    // ---------- transport ----------
    function setConnected(on) {
      state.connected = on;
      status.classList.toggle('connected', on);
      status.querySelector('.status-text').textContent = on ? 'connected' : 'no page';
    }

    function handle(message) {
      if (!message) return;
      switch (message.type) {
        case 'connected':
        case 'hello':
          setConnected(true);
          break;
        case 'disconnected':
          setConnected(false);
          break;
        case 'clear':
        case 'navigated':
          clearAll();
          break;
        case 'report':
          if (!state.paused && message.payload) addReport(message.payload);
          break;
      }
    }

    if (options.theme === 'dark') document.documentElement.classList.add('theme-dark');
    renderTree();
    renderDetails();
    renderStream();
    transport.subscribe(handle);

    return {
      state,
      handle,
      clearAll,
      select: (name) => {
        for (const n of state.nodesByKey.values()) if (n.name === name) return select(n);
      },
    };
  }

  // ---------- boot ----------
  function bootExtension() {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    let listener = null;
    const evalIn = (code) => chrome.devtools.inspectedWindow.eval(code);
    const replayCode = 'window.__RERENDER_LENS_DEVTOOLS__ && window.__RERENDER_LENS_DEVTOOLS__.replay()';
    const transport = {
      subscribe(fn) {
        listener = fn;
        connect();
        chrome.devtools.network.onNavigated.addListener(() => {
          fn({ type: 'navigated' });
          setTimeout(() => evalIn(replayCode), 1500);
        });
        evalIn(replayCode);
      },
      replay() {
        evalIn(replayCode);
      },
      clear() {
        evalIn('window.__RERENDER_LENS_DEVTOOLS__ && window.__RERENDER_LENS_DEVTOOLS__.clear()');
      },
    };
    function connect() {
      const port = chrome.runtime.connect({ name: 'rerender-lens-panel' });
      port.postMessage({ type: 'init', tabId });
      port.onMessage.addListener((m) => listener && listener(m));
      port.onDisconnect.addListener(() => setTimeout(connect, 1000));
    }
    const prefersDark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = chrome.devtools.panels.themeName === 'dark' || prefersDark ? 'dark' : 'light';
    createPanel(document.getElementById('root'), transport, { theme });
  }

  function bootDemo() {
    const fn = (name) => FN_PREFIX + name;
    const sample = [
      {
        component: 'ProductRow', path: ['App', 'ProductPage', 'ProductList'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 4,
        owner: 'ProductList', parent: { name: 'ProductPage', trigger: 'state' }, selfDuration: 0.8,
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
        component: 'Toolbar', path: ['App', 'ProductPage'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 2,
        owner: 'ProductPage', parent: { name: 'ProductPage', trigger: 'state' },
        props: { prev: { title: 'Products', count: 3 }, next: { title: 'Products', count: 3 } }, propChanges: [], stateChanges: [], hookChanges: [],
        reasons: ['re-rendered with identical props because <ProductPage> re-rendered (its state changed). Wrap "Toolbar" in React.memo (or extend PureComponent).'],
      },
      {
        component: 'SearchBox', path: ['App', 'ProductPage'], trigger: 'state', avoidable: false, renderCount: 1, instanceId: 3,
        owner: 'ProductPage', parent: null,
        props: { prev: { placeholder: 'Search' }, next: { placeholder: 'Search' } }, propChanges: [], stateChanges: [],
        hookChanges: [{ path: 'useState#0', hook: 'useState', index: 0, kind: 'different', prev: 'ab', next: 'abc' }], reasons: ['useState #0 changed.'],
      },
      {
        component: 'Sidebar', path: ['App'], trigger: 'hooks', avoidable: false, renderCount: 1, instanceId: 5, owner: 'App', parent: null,
        props: { prev: {}, next: {} }, propChanges: [], stateChanges: [],
        hookChanges: [{ path: 'useContext(Theme)', hook: 'useContext', index: 0, kind: 'different', prev: 'light', next: 'dark' }], reasons: ['useContext #0 changed.'],
      },
    ];
    let i = 0;
    const transport = {
      subscribe(fn) {
        fn({ type: 'connected' });
        const tick = () => {
          const r = JSON.parse(JSON.stringify(sample[i % sample.length]));
          r.renderCount = Math.floor(i / sample.length) + 1;
          fn({ type: 'report', payload: r });
          i++;
          if (i < 14) setTimeout(tick, i < 4 ? 50 : 900);
        };
        tick();
      },
      replay() {},
      clear() {},
    };
    const dark = /theme=dark/.test(location.search) || (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    createPanel(document.getElementById('root'), transport, { theme: dark ? 'dark' : 'light' });
  }

  global.RerenderLensPanel = { createPanel, summarize, valueNode };
  if (global.chrome && global.chrome.devtools && global.chrome.devtools.inspectedWindow) bootExtension();
  else if (typeof location !== 'undefined' && /[?&]demo/.test(location.search)) bootDemo();
})(typeof window !== 'undefined' ? window : globalThis);
