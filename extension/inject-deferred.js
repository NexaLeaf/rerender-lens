// Listed before inject.js when "Let React DevTools create the hook" is on for the origin.
// inject.js then waits one macrotask before touching the DevTools hook, so React DevTools'
// own document_start script (if installed and run after ours) can install it first.
window.__RERENDER_LENS_DEFER_HOOK__ = true;
