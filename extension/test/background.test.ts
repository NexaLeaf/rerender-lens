import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeChrome, makePort, settle, type FakeChrome } from './fake-chrome';

const shared = readFileSync(join(__dirname, '..', 'shared.js'), 'utf8');
const background = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');

interface Api {
  reconcile(): Promise<void>;
  removeOrigin(origin: string): Promise<void>;
  contentByTab: Map<number, unknown>;
}

function load(chrome: FakeChrome): Api {
  // The service worker's top-level functions become globals; capture the ones the e2e and tests use.
  const self = { RerenderLensShared: undefined as unknown };
  const fn = new Function('chrome', 'self', 'importScripts', `${shared}\n${background}\nreturn { reconcile, removeOrigin, contentByTab };`);
  return fn(chrome, self, undefined) as Api;
}

const send = (chrome: FakeChrome, message: unknown) =>
  new Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>((resolve) => chrome.runtime.sendMessage(message, (r) => resolve(r as never)));

describe('background', () => {
  let chrome: FakeChrome;
  let api: Api;
  beforeEach(() => {
    chrome = makeChrome();
    api = load(chrome);
  });

  it('routes content-script messages to the panels of the same tab and tracks the badge', async () => {
    const panel = makePort('rerender-lens-panel');
    chrome.runtime.onConnect.emit(panel);
    panel.onMessage.emit({ type: 'init', tabId: 3 });
    expect(panel.sent).toEqual([{ type: 'disconnected' }]);

    const content = makePort('rerender-lens-content', 3);
    chrome.runtime.onConnect.emit(content);
    expect(panel.sent.at(-1)).toEqual({ type: 'connected' });
    expect(api.contentByTab.has(3)).toBe(true);

    content.onMessage.emit({ type: 'report', payload: { component: 'A', avoidable: true } });
    content.onMessage.emit({ type: 'report', payload: { component: 'B', avoidable: false } });
    content.onMessage.emit({ type: 'report', payload: { component: 'C', avoidable: true } });
    expect(panel.sent.filter((m) => (m as { type: string }).type === 'report')).toHaveLength(3);
    expect(chrome._badges.get(3)).toBe('2');

    // another tab's panel gets nothing
    const other = makePort('rerender-lens-panel');
    chrome.runtime.onConnect.emit(other);
    other.onMessage.emit({ type: 'init', tabId: 4 });
    content.onMessage.emit({ type: 'report', payload: { component: 'D', avoidable: true } });
    expect(other.sent).toEqual([{ type: 'disconnected' }]);

    content.onMessage.emit({ type: 'clear' });
    expect(chrome._badges.get(3)).toBe('');
    chrome.tabs.onUpdated.emit(3, { status: 'loading' });
    expect(chrome._badges.get(3)).toBe('');

    // a polling panel reports its own count
    panel.onMessage.emit({ type: 'badge', count: 5 });
    expect(chrome._badges.get(3)).toBe('5');

    content.onDisconnect.emit();
    expect(panel.sent.at(-1)).toEqual({ type: 'disconnected' });
    expect(api.contentByTab.has(3)).toBe(false);
  });

  it('origin:status reports built-in hosts as enabled without any registration', async () => {
    const res = await send(chrome, { type: 'origin:status', origin: 'http://localhost:5199' });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ origin: 'http://localhost:5199', builtIn: true, permitted: true, enabled: true, inject: false, deferHook: false });
    const remote = await send(chrome, { type: 'origin:status', origin: 'https://app.example.com' });
    expect(remote.result).toMatchObject({ builtIn: false, permitted: false, enabled: false });
  });

  it('origin:set registers relay + injection scripts, honours deferHook, and refuses without permission', async () => {
    const refused = await send(chrome, { type: 'origin:set', origin: 'https://app.example.com', enabled: true, inject: true });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/no host permission/);

    chrome._permitted.add('https://app.example.com/*');
    const res = await send(chrome, { type: 'origin:set', origin: 'https://app.example.com', enabled: true, inject: true, deferHook: true });
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ enabled: true, inject: true, deferHook: true, permitted: true });
    const ids = [...chrome._registered.keys()];
    expect(ids).toEqual(['relay:https://app.example.com', 'inject:https://app.example.com']);
    expect(chrome._registered.get('relay:https://app.example.com')).toMatchObject({ world: 'ISOLATED', js: ['content.js'], matches: ['https://app.example.com/*'] });
    expect(chrome._registered.get('inject:https://app.example.com')).toMatchObject({ world: 'MAIN', js: ['vendor/rerender-lens.core.js', 'vendor/rerender-lens.engine.js', 'vendor/rerender-lens.js', 'inject-deferred.js', 'inject.js'], runAt: 'document_start' });
    expect(chrome._store.origins).toEqual({ 'https://app.example.com': { inject: true, deferHook: true } });

    // turning injection off updates in place (relay stays); deferHook cannot survive without inject
    await send(chrome, { type: 'origin:set', origin: 'https://app.example.com', enabled: true, inject: false, deferHook: true });
    expect([...chrome._registered.keys()]).toEqual(['relay:https://app.example.com']);
    expect(chrome._store.origins).toEqual({ 'https://app.example.com': { inject: false, deferHook: false } });

    // built-in host: only the injection script is registered (the manifest relay already runs)
    await send(chrome, { type: 'origin:set', origin: 'http://localhost:5199', enabled: true, inject: true });
    expect(chrome._registered.get('inject:http://localhost:5199')).toMatchObject({ js: ['vendor/rerender-lens.core.js', 'vendor/rerender-lens.engine.js', 'vendor/rerender-lens.js', 'inject.js'] });
    expect(chrome._registered.has('relay:http://localhost:5199')).toBe(false);
    // and switching injection off on a built-in host forgets the origin entirely
    await send(chrome, { type: 'origin:set', origin: 'http://localhost:5199', enabled: true, inject: false });
    expect(chrome._store.origins).toEqual({ 'https://app.example.com': { inject: false, deferHook: false } });

    // disabling a remote origin unregisters everything
    await send(chrome, { type: 'origin:set', origin: 'https://app.example.com', enabled: false });
    expect(chrome._registered.size).toBe(0);
    expect(chrome._store.origins).toEqual({});
  });

  it('reconcile re-registers stored origins and drops those whose permission is gone', async () => {
    chrome._store.origins = { 'https://kept.example.com': { inject: true }, 'https://lost.example.com': { inject: true } };
    chrome._permitted.add('https://kept.example.com/*');
    chrome._registered.set('inject:https://lost.example.com', { id: 'inject:https://lost.example.com' });
    await api.reconcile();
    expect([...chrome._registered.keys()].sort()).toEqual(['inject:https://kept.example.com', 'relay:https://kept.example.com']);
    expect(chrome._store.origins).toEqual({ 'https://kept.example.com': { inject: true } });
    // startup and permission removal both trigger it
    chrome._permitted.clear();
    chrome.permissions.onRemoved.emit();
    await settle();
    await settle();
    expect(chrome._registered.size).toBe(0);
  });
});
