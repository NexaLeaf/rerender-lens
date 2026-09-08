// Relays rerender-lens messages posted on window to the extension (isolated world -> background),
// and hands the page the options saved for this origin (for the injected library).
(function () {
  if (window.__rerenderLensRelay) return; // defensive: run once per page even if registered twice
  window.__rerenderLensRelay = true;

  let port = null;
  let queue = [];

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'rerender-lens-content' });
    } catch {
      port = null;
      return;
    }
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 1000);
    });
    for (const m of queue) send(m);
    queue = [];
  }

  function send(message) {
    if (!port) {
      queue.push(message);
      if (queue.length > 500) queue.shift();
      return;
    }
    try {
      port.postMessage(message);
    } catch {
      queue.push(message);
    }
  }

  // The library posts reports on window only after hearing this (so pages without the extension pay
  // nothing per report); say it now and again whenever a library announces itself.
  const ready = () => window.postMessage({ __rerenderLensReady: true }, '*');
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__rerenderLens !== true) return;
    if (data.type === 'hello') ready();
    send({ type: data.type, version: data.version, payload: data.payload });
  });
  ready();

  // Saved options for this origin -> injected library (inject.js listens for this).
  try {
    chrome.storage.local.get('settings:' + location.origin, (got) => {
      const settings = got && got['settings:' + location.origin];
      if (settings) window.postMessage({ __rerenderLensConfig: true, options: settings }, '*');
    });
  } catch {
    /* storage unavailable */
  }

  connect();
})();
