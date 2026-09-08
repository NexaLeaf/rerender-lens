// Relays rerender-lens messages posted on window to the extension (isolated world -> background),
// and hands the page the options saved for this origin (for the injected library).
(function () {
  if (window.__rerenderLensRelay) return; // defensive: run once per page even if registered twice
  window.__rerenderLensRelay = true;

  const QUEUE_MAX = 500; // messages kept while the port is down

  let port = null;
  let queue = []; // messages waiting for a port
  let pending = []; // messages of the current macrotask, sent as one port message
  let flushTimer = null;

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
    if (queue.length) {
      const items = queue;
      queue = [];
      post(items);
    }
  }

  function keep(items) {
    queue = queue.concat(items);
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
  }

  /** One port message per macrotask: a commit with thousands of reports is thousands of window messages, but one IPC. */
  function post(items) {
    if (!port) {
      keep(items);
      return;
    }
    try {
      port.postMessage(items.length === 1 ? items[0] : { type: 'batch', items });
    } catch {
      keep(items);
    }
  }

  function flushPending() {
    flushTimer = null;
    const items = pending;
    pending = [];
    if (items.length) post(items);
  }

  function send(message) {
    pending.push(message);
    if (flushTimer === null) flushTimer = setTimeout(flushPending, 0);
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
