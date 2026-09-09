/* Elements-panel sidebar: re-render details for the selected DOM node ($0). */
(function () {
  'use strict';
  const P = window.RerenderLensPanel;
  const root = document.getElementById('root');
  const evalIn = (code) =>
    new Promise((resolve) => chrome.devtools.inspectedWindow.eval(code, (result, err) => resolve(err ? { error: err } : result)));

  // `inspect` carries the tracking verdict; `getOptions` gives the include list to append to.
  const INSPECT =
    '(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;if(!b)return {missing:true};' +
    'if(typeof $0==="undefined"||!$0)return {none:true};try{var r=b.inspect($0);' +
    'if(r)r.options=b.getOptions?b.getOptions():{};return r}catch(e){return {error:String(e)}}})()';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  }

  async function refresh() {
    const r = await evalIn(INSPECT);
    root.textContent = '';
    // `null` is a real answer from inspect(): the element has no React component above it.
    if (r === null) {
      root.append(el('div', { class: 'empty', text: 'No React component renders this element.' }));
      return;
    }
    if (!r || r.missing) {
      root.append(el('div', { class: 'empty', text: 'rerender-lens is not running in this page.' }));
      return;
    }
    if (r.none) {
      root.append(el('div', { class: 'empty', text: 'Select an element.' }));
      return;
    }
    if (r.error) {
      root.append(el('div', { class: 'empty', text: String(r.error) }));
      return;
    }
    root.append(
      el('div', { class: 'sb-title' }, [
        el('span', { class: 'bracket', text: '<' }),
        el('span', { class: 'name', text: r.component }),
        el('span', { class: 'bracket', text: '>' }),
        r.path && r.path.length ? el('span', { class: 'meta', text: '  in ' + r.path.join(' › ') }) : null,
      ]),
    );
    // A tracked component with no reports is the good case (it has not re-rendered); an untracked one
    // is the "why does the panel show nothing?" case, and gets the reason and a one-click fix.
    root.append(
      el('div', { class: 'sb-row' }, [
        el('span', { class: 'verdict ' + (r.tracked ? 'ok' : ''), text: r.tracked ? 'tracked' : 'not tracked' }),
        el('span', {
          class: 'meta',
          text: r.reports.length
            ? `${r.reports.length} recent report${r.reports.length === 1 ? '' : 's'}`
            : r.tracked
              ? 'no re-renders yet'
              : 'no re-renders reported',
        }),
      ]),
    );
    const verdict = r.tracking;
    if (verdict) {
      root.append(el('div', { class: 'sb-reason', text: verdict.reason }));
      if (verdict.fix) root.append(el('div', { class: 'sb-fix', text: verdict.fix }));
    }
    const actions = el('div', { class: 'sb-actions' });
    if (r.instanceId != null) {
      actions.append(
        el('button', { onclick: () => evalIn(`window.__RERENDER_LENS_DEVTOOLS__.highlight(${r.instanceId})`) }, 'Highlight'),
        el('button', { onclick: () => evalIn('window.__RERENDER_LENS_DEVTOOLS__.highlight(null)') }, 'Clear'),
      );
    }
    const name = verdict && verdict.name;
    if (verdict && !verdict.tracked && name && name !== 'Anonymous' && name === r.component) {
      actions.append(
        el(
          'button',
          {
            title: "Adds this display name to the library's include list",
            onclick: async () => {
              const include = ((r.options && r.options.include) || []).slice();
              if (include.indexOf(name) < 0) include.push(name);
              await evalIn('window.__RERENDER_LENS_DEVTOOLS__.configure(' + JSON.stringify({ include: include }) + ')');
              refresh();
            },
          },
          'Track this component',
        ),
      );
    }
    root.append(actions);
    const last = r.reports[r.reports.length - 1];
    if (last && P && P.reportView) root.append(P.reportView(last, { compact: true }));
  }

  chrome.devtools.panels.elements.onSelectionChanged.addListener(refresh);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (chrome.devtools.panels.themeName === 'dark' || prefersDark) document.documentElement.classList.add('theme-dark');
  refresh();
})();
