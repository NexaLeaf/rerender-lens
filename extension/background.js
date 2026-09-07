// Routes messages between the content script of a tab and the DevTools panel(s) inspecting it.
const panelsByTab = new Map();   // tabId -> Set<Port>
const contentByTab = new Map();  // tabId -> Port

function panelsFor(tabId) {
  let set = panelsByTab.get(tabId);
  if (!set) {
    set = new Set();
    panelsByTab.set(tabId, set);
  }
  return set;
}

function broadcast(tabId, message) {
  for (const p of panelsFor(tabId)) {
    try {
      p.postMessage(message);
    } catch {
      /* panel gone */
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'rerender-lens-content') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId == null) return;
    contentByTab.set(tabId, port);
    broadcast(tabId, { type: 'connected' });
    port.onMessage.addListener((message) => broadcast(tabId, message));
    port.onDisconnect.addListener(() => {
      if (contentByTab.get(tabId) === port) contentByTab.delete(tabId);
      broadcast(tabId, { type: 'disconnected' });
    });
    return;
  }
  if (port.name === 'rerender-lens-panel') {
    let tabId = null;
    port.onMessage.addListener((message) => {
      if (message && message.type === 'init') {
        tabId = message.tabId;
        panelsFor(tabId).add(port);
        port.postMessage({ type: contentByTab.has(tabId) ? 'connected' : 'disconnected' });
      }
    });
    port.onDisconnect.addListener(() => {
      if (tabId != null) panelsFor(tabId).delete(port);
    });
  }
});
