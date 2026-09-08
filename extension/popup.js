/* Toolbar popup: enable rerender-lens on the current site, with or without injecting the library. */
(function () {
  'use strict';
  const S = window.RerenderLensShared;
  const root = document.getElementById('root');

  const send = (message) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error((res && res.error) || 'no response'));
        else resolve(res.result);
      }),
    );

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (typeof v === 'boolean') {
          if (v) node.setAttribute(k, '');
        } else node.setAttribute(k, v);
      }
    }
    if (children) for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  }

  async function currentOrigin() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.url ? S.originOf(tab.url) : null;
  }

  async function render(error) {
    root.textContent = '';
    root.append(el('h1', { text: 'rerender-lens' }));
    const origin = await currentOrigin();
    if (!origin) {
      root.append(el('div', { class: 'hint', text: 'Open an http(s) page to enable rerender-lens on it.' }));
      return;
    }
    root.append(el('div', { class: 'origin', text: origin }));
    const st = await send({ type: 'origin:status', origin });

    const enabled = el('input', { type: 'checkbox' });
    enabled.checked = st.enabled;
    enabled.disabled = st.builtIn;
    const inject = el('input', { type: 'checkbox' });
    inject.checked = st.inject;
    inject.disabled = !st.enabled;

    const apply = async () => {
      try {
        if (enabled.checked && !st.permitted) {
          const ok = await chrome.permissions.request({ origins: [S.patternFor(origin)] });
          if (!ok) return render('Permission was not granted.');
        }
        await send({ type: 'origin:set', origin, enabled: enabled.checked, inject: enabled.checked && inject.checked });
        render();
      } catch (e) {
        render(String(e.message || e));
      }
    };
    enabled.addEventListener('change', () => {
      if (!enabled.checked) inject.checked = false;
      apply();
    });
    inject.addEventListener('change', apply);

    root.append(
      el('div', { class: 'row' }, [el('label', null, [enabled, st.builtIn ? 'Enabled (local development host)' : 'Enable on this site'])]),
      el('div', { class: 'row' }, [el('label', null, [inject, 'Inject the library (no app code needed)'])]),
      el('div', { class: 'hint', text: st.inject ? 'Reload the page for injection to take effect.' : 'Without injection the page must call init({ notifier: createDevtoolsNotifier() }) itself.' }),
    );
    if (error) root.append(el('div', { class: 'err', text: error }));
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.classList.add('theme-dark');
  }

  render();
})();
