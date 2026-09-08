/* Service worker: routes messages between a tab's content script and the DevTools panel(s)
 * inspecting it, keeps the per-tab avoidable-render badge, and manages the origins on which
 * the library is relayed or injected. */
// Chrome: service worker. Firefox: event page (shared.js is listed before this file in its manifest).
if (typeof importScripts === 'function') importScripts('shared.js');

const S = self.RerenderLensShared;

const panelsByTab = new Map(); // tabId -> Set<Port>
const contentByTab = new Map(); // tabId -> Port
const badgeByTab = new Map(); // tabId -> avoidable count

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

// ---------- badge ----------
function setBadge(tabId, count) {
  badgeByTab.set(tabId, count);
  const text = count > 999 ? '999+' : count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (count > 0) chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' }).catch(() => {});
}

function bumpBadge(tabId, message) {
  if (message.type === 'report' && message.payload && message.payload.avoidable) {
    setBadge(tabId, (badgeByTab.get(tabId) || 0) + 1);
  } else if (message.type === 'clear') {
    setBadge(tabId, 0);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  badgeByTab.delete(tabId);
  panelsByTab.delete(tabId);
  contentByTab.delete(tabId);
});
chrome.webNavigation?.onCommitted?.addListener?.((d) => {
  if (d.frameId === 0) setBadge(d.tabId, 0);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, 0);
});

// ---------- ports ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'rerender-lens-content') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId == null) return;
    contentByTab.set(tabId, port);
    broadcast(tabId, { type: 'connected' });
    port.onMessage.addListener((message) => {
      bumpBadge(tabId, message);
      broadcast(tabId, message);
    });
    port.onDisconnect.addListener(() => {
      if (contentByTab.get(tabId) === port) contentByTab.delete(tabId);
      broadcast(tabId, { type: 'disconnected' });
    });
    return;
  }
  if (port.name === 'rerender-lens-panel') {
    let tabId = null;
    port.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === 'init') {
        tabId = message.tabId;
        panelsFor(tabId).add(port);
        port.postMessage({ type: contentByTab.has(tabId) ? 'connected' : 'disconnected' });
      } else if (message.type === 'badge' && tabId != null) {
        // The panel polled the page directly (no content script); it reports the count itself.
        setBadge(tabId, message.count | 0);
      }
    });
    port.onDisconnect.addListener(() => {
      if (tabId != null) panelsFor(tabId).delete(port);
    });
  }
});

// ---------- origins: relay + injection registration ----------
const RELAY_FILES = ['content.js'];
const INJECT_FILES = ['vendor/rerender-lens.js', 'inject.js'];

const relayId = (origin) => 'relay:' + origin;
const injectId = (origin) => 'inject:' + origin;

async function registered() {
  const list = await chrome.scripting.getRegisteredContentScripts();
  return new Set(list.map((s) => s.id));
}

async function hasPermission(origin) {
  if (S.isBuiltInOrigin(origin)) return true;
  try {
    return await chrome.permissions.contains({ origins: [S.patternFor(origin)] });
  } catch {
    return false;
  }
}

/** Register (or update) the scripts for one origin according to `{ inject }`. */
async function applyOrigin(origin, config) {
  const have = await registered();
  const matches = [S.patternFor(origin)];
  const wanted = [];
  if (!S.isBuiltInOrigin(origin)) {
    wanted.push({ id: relayId(origin), matches, js: RELAY_FILES, runAt: 'document_start', world: 'ISOLATED' });
  }
  if (config && config.inject) {
    wanted.push({ id: injectId(origin), matches, js: INJECT_FILES, runAt: 'document_start', world: 'MAIN' });
  }
  const toUpdate = wanted.filter((s) => have.has(s.id));
  const toRegister = wanted.filter((s) => !have.has(s.id));
  const wantedIds = new Set(wanted.map((s) => s.id));
  const toRemove = [relayId(origin), injectId(origin)].filter((id) => have.has(id) && !wantedIds.has(id));
  if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
  if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
}

async function removeOrigin(origin) {
  const have = await registered();
  const ids = [relayId(origin), injectId(origin)].filter((id) => have.has(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}

/** Re-apply every stored origin (after install/update/startup; also drops origins whose permission went away). */
async function reconcile() {
  const origins = await S.loadOrigins();
  let changed = false;
  for (const origin of Object.keys(origins)) {
    if (await hasPermission(origin)) {
      try {
        await applyOrigin(origin, origins[origin]);
      } catch (err) {
        console.warn('[rerender-lens] could not register scripts for', origin, err);
      }
    } else {
      delete origins[origin];
      changed = true;
      await removeOrigin(origin).catch(() => {});
    }
  }
  if (changed) await S.saveOrigins(origins);
}

chrome.runtime.onInstalled.addListener(() => {
  reconcile();
});
chrome.runtime.onStartup.addListener(() => {
  reconcile();
});
chrome.permissions.onRemoved.addListener(() => {
  reconcile();
});

/** Status of an origin: enabled/injecting/permission/builtIn. */
async function originStatus(origin) {
  const origins = await S.loadOrigins();
  const cfg = origins[origin];
  return {
    origin,
    builtIn: S.isBuiltInOrigin(origin),
    permitted: await hasPermission(origin),
    enabled: S.isBuiltInOrigin(origin) || !!cfg,
    inject: !!(cfg && cfg.inject),
  };
}

// Messages from the panel / popup. Permission requests must happen in the caller (user gesture);
// the background only records and registers.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  (async () => {
    switch (message.type) {
      case 'origin:status':
        return originStatus(message.origin);
      case 'origin:set': {
        const origins = await S.loadOrigins();
        const origin = message.origin;
        if (message.enabled === false && !S.isBuiltInOrigin(origin)) {
          delete origins[origin];
          await removeOrigin(origin);
        } else {
          if (!(await hasPermission(origin))) throw new Error('no host permission for ' + origin);
          const cfg = { inject: !!message.inject };
          if (S.isBuiltInOrigin(origin) && !cfg.inject) delete origins[origin];
          else origins[origin] = cfg;
          await applyOrigin(origin, cfg);
        }
        await S.saveOrigins(origins);
        return originStatus(origin);
      }
      case 'origins:list':
        return S.loadOrigins();
      default:
        return null;
    }
  })().then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }),
  );
  return true;
});
