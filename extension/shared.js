/* Helpers shared by background.js, popup.js and panel.js (loaded as a classic script; no build step). */
(function (global) {
  'use strict';

  /** Origins the static manifest content script already covers (no permission request needed). */
  function isBuiltInOrigin(origin) {
    try {
      const u = new URL(origin);
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost'))) return true;
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.endsWith('.local')) return true;
    } catch {
      /* not a URL */
    }
    return false;
  }

  function originOf(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin;
    } catch {
      return null;
    }
  }

  /** Match pattern covering every page of an origin. */
  function patternFor(origin) {
    return origin + '/*';
  }

  const STORAGE_KEY = 'origins';

  /** `{ [origin]: { inject: boolean } }` for origins the user enabled. */
  async function loadOrigins() {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    return (got && got[STORAGE_KEY]) || {};
  }

  async function saveOrigins(origins) {
    await chrome.storage.local.set({ [STORAGE_KEY]: origins });
  }

  /** Open the panel next to the page (Chrome side panel, pinned to the tab) or in its own window. */
  async function openPanel(mode, tabId) {
    if (mode === 'sidepanel' && chrome.sidePanel) {
      const path = 'sidepanel.html?tabId=' + encodeURIComponent(tabId);
      await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
      await chrome.sidePanel.open({ tabId });
      return true;
    }
    if (mode === 'sidepanel' && chrome.sidebarAction) {
      // Firefox: one sidebar per window, follows the active tab.
      await chrome.sidebarAction.open();
      return true;
    }
    return new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({ type: 'window:open', tabId }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error((res && res.error) || 'could not open a window'));
        else resolve(true);
      }),
    );
  }

  global.RerenderLensShared = { isBuiltInOrigin, originOf, patternFor, loadOrigins, saveOrigins, openPanel };
})(typeof self !== 'undefined' ? self : globalThis);
