/* Helpers shared by background.js, popup.js and panel.js (loaded as a classic script; no build step). */
(function (global) {
  'use strict';

  const DEFAULT_ORIGINS = ['http://localhost', 'http://127.0.0.1'];

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

  /** Per-origin library options the panel persisted (`SerializableOptions`). */
  async function loadSettings(origin) {
    const key = 'settings:' + origin;
    const got = await chrome.storage.local.get(key);
    return (got && got[key]) || null;
  }

  async function saveSettings(origin, settings) {
    await chrome.storage.local.set({ ['settings:' + origin]: settings });
  }

  global.RerenderLensShared = { DEFAULT_ORIGINS, isBuiltInOrigin, originOf, patternFor, loadOrigins, saveOrigins, loadSettings, saveSettings };
})(typeof self !== 'undefined' ? self : globalThis);
