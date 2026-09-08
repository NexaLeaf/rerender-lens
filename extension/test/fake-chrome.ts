/* A minimal in-memory `chrome` for exercising the extension's runtime scripts in jsdom. */
import { vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

export function makeEvent() {
  const listeners: Listener[] = [];
  return {
    addListener: (fn: Listener) => listeners.push(fn),
    removeListener: (fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
    emit: (...args: unknown[]) => listeners.map((fn) => fn(...args)),
    listeners,
  };
}

export interface FakePort {
  name: string;
  sender?: { tab?: { id: number } };
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof makeEvent>;
  onDisconnect: ReturnType<typeof makeEvent>;
  sent: unknown[];
}

export function makePort(name: string, tabId?: number): FakePort {
  const sent: unknown[] = [];
  return {
    name,
    sender: tabId === undefined ? undefined : { tab: { id: tabId } },
    postMessage: vi.fn((m: unknown) => sent.push(m)),
    onMessage: makeEvent(),
    onDisconnect: makeEvent(),
    sent,
  };
}

export function makeChrome(opts: { permitted?: string[]; activeUrl?: string; evalResult?: unknown } = {}) {
  const store: Record<string, unknown> = {};
  const registered = new Map<string, Record<string, unknown>>();
  const permitted = new Set(opts.permitted ?? []);
  const badges = new Map<number, string>();
  const chrome = {
    storage: {
      local: {
        get: (key: string | string[], cb?: (got: Record<string, unknown>) => void) => {
          const keys = Array.isArray(key) ? key : [key];
          const got: Record<string, unknown> = {};
          for (const k of keys) if (k in store) got[k] = store[k];
          if (cb) cb(got);
          return Promise.resolve(got);
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          Object.assign(store, obj);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(() => Promise.resolve([...registered.values()])),
      registerContentScripts: vi.fn((list: Record<string, unknown>[]) => {
        for (const s of list) registered.set(s.id as string, s);
        return Promise.resolve();
      }),
      updateContentScripts: vi.fn((list: Record<string, unknown>[]) => {
        for (const s of list) registered.set(s.id as string, { ...registered.get(s.id as string), ...s });
        return Promise.resolve();
      }),
      unregisterContentScripts: vi.fn(({ ids }: { ids: string[] }) => {
        for (const id of ids) registered.delete(id);
        return Promise.resolve();
      }),
    },
    permissions: {
      contains: vi.fn(({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => permitted.has(o)))),
      request: vi.fn(({ origins }: { origins: string[] }) => {
        for (const o of origins) permitted.add(o);
        return Promise.resolve(true);
      }),
      onRemoved: makeEvent(),
    },
    runtime: {
      onConnect: makeEvent(),
      onMessage: makeEvent(),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      lastError: undefined as { message: string } | undefined,
      connect: vi.fn((o: { name: string }) => makePort(o.name)),
      /** Routes to the registered onMessage listener like the browser would. */
      sendMessage: (message: unknown, cb: (res: unknown) => void) => {
        const listener = chrome.runtime.onMessage.listeners[0];
        if (!listener) return cb(undefined);
        listener(message, {}, cb);
      },
    },
    tabs: {
      onRemoved: makeEvent(),
      onUpdated: makeEvent(),
      query: vi.fn(() => Promise.resolve(opts.activeUrl ? [{ id: 7, url: opts.activeUrl }] : [])),
    },
    action: {
      setBadgeText: vi.fn(({ tabId, text }: { tabId: number; text: string }) => {
        badges.set(tabId, text);
        return Promise.resolve();
      }),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    },
    devtools: {
      inspectedWindow: {
        tabId: 7,
        eval: vi.fn((_code: string, cb: (result: unknown, err?: unknown) => void) => cb(opts.evalResult)),
      },
      panels: {
        themeName: 'default',
        elements: { onSelectionChanged: makeEvent() },
      },
    },
    _store: store,
    _registered: registered,
    _permitted: permitted,
    _badges: badges,
  };
  return chrome;
}

export type FakeChrome = ReturnType<typeof makeChrome>;

/** Wait for pending promise chains inside the scripts to settle. */
export const settle = () => new Promise((r) => setTimeout(r, 0));
