// Runs in the page (MAIN world) at document_start on origins where injection is enabled,
// right after the vendor/rerender-lens.*.js scripts defined `window.RerenderLens`. Creates the React DevTools
// hook before react-dom loads and starts reporting, so the app needs no code change.
(function () {
  const L = window.RerenderLens;
  if (!L || window.__RERENDER_LENS_DEVTOOLS__) return; // the page already runs the library itself
  let pending = null;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__rerenderLensConfig !== true || !data.options) return;
    const bridge = window.__RERENDER_LENS_DEVTOOLS__;
    if (bridge && bridge.configure) bridge.configure(data.options);
    else pending = data.options;
  });

  function start() {
    if (window.__RERENDER_LENS_DEVTOOLS__) return; // the page's own init() won the race
    L.ensureDevtoolsHook(); // wraps an existing hook (React DevTools, Fast Refresh) or creates one
    window.__RERENDER_LENS_INJECTED__ = L.VERSION;
    // includeState is off by default here: snapshotting every hook/context/state value for every report is the
    // single biggest per-commit cost on large apps. Settings can turn it on per origin.
    L.init({ trackAllMemoized: true, includeState: false, silent: true, notifier: L.createDevtoolsNotifier({ source: 'extension' }) });
    if (pending && window.__RERENDER_LENS_DEVTOOLS__) window.__RERENDER_LENS_DEVTOOLS__.configure(pending);
  }

  // With "defer to React DevTools" on, give the other extension's document_start script a chance
  // to install the global hook first; we then wrap it instead of blocking it. Page module scripts
  // are deferred past this point, so react-dom still finds the hook.
  if (window.__RERENDER_LENS_DEFER_HOOK__ && !window.__REACT_DEVTOOLS_GLOBAL_HOOK__) setTimeout(start, 0);
  else start();
})();
