// Runs in the page (MAIN world) at document_start on origins where injection is enabled,
// right after vendor/rerender-lens.js defined `window.RerenderLens`. Creates the React DevTools
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
  L.ensureDevtoolsHook();
  L.init({ trackAllMemoized: true, silent: true, notifier: L.createDevtoolsNotifier() });
  window.__RERENDER_LENS_INJECTED__ = L.VERSION;
  if (pending && window.__RERENDER_LENS_DEVTOOLS__) window.__RERENDER_LENS_DEVTOOLS__.configure(pending);
})();
