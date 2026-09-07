// Relays rerender-lens messages posted on window to the extension (isolated world -> background).
(function () {
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

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__rerenderLens !== true) return;
    send({ type: data.type, version: data.version, payload: data.payload });
  });

  connect();
})();
