import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createCollector, combineNotifiers, createDevtoolsNotifier, disable, init, track } from '../src/index';
import { createRelayServer, findPanelDir, type RelayServer } from '../src/relay';
import { main } from '../src/cli';
import { FetchEventSource } from './sse';
import { h, mount } from './helpers';
import { act } from './react-act';

let relay: RelayServer | null = null;
afterEach(async () => {
  disable();
  await relay?.close();
  relay = null;
});

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => act(bump) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('relay server', () => {
  it('serves the panel, routes app messages to panels and panel commands to apps, with CORS', async () => {
    relay = await createRelayServer({ port: 0, keepAliveMs: 50 });
    expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const root = await fetch(`${relay.url}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe(`/panel.html?relay=${encodeURIComponent(relay.url)}`);
    expect(root.headers.get('access-control-allow-origin')).toBe('*');
    expect(findPanelDir()).not.toBeNull();
    expect(await (await fetch(`${relay.url}/panel.js`)).text()).toContain('RerenderLensPanel');
    expect((await fetch(`${relay.url}/nope`)).status).toBe(404);
    expect((await fetch(`${relay.url}/message`, { method: 'OPTIONS' })).status).toBe(204);

    const panel = new FetchEventSource(`${relay.url}/events?role=panel`);
    const app = new FetchEventSource(`${relay.url}/events?role=app&label=localhost%3A3000%2Fshop`);
    const toPanel: unknown[] = [];
    const toApp: unknown[] = [];
    panel.onmessage = (e) => toPanel.push(JSON.parse(e.data));
    app.onmessage = (e) => toApp.push(JSON.parse(e.data));
    await vi.waitFor(() => expect(relay!.counts()).toEqual({ apps: 1, panels: 1 }));
    // app connected -> panels learn the roster; the app learns its own id
    await vi.waitFor(() => expect(toPanel).toContainEqual({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1, list: [{ id: 'a1', label: 'localhost:3000/shop' }] } }));
    await vi.waitFor(() => expect(toApp).toContainEqual({ __rerenderLensRelay: true, version: 2, app: 'a1' }));
    toApp.length = 0;
    const post = (m: unknown) => fetch(`${relay!.url}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    expect((await post({ __rerenderLens: true, type: 'report', payload: { component: 'A' } })).status).toBe(204);
    expect((await post([{ __rerenderLensCmd: true, id: '1', cmd: 'info' }, { __rerenderLensReply: true, id: '1', result: 42 }])).status).toBe(204);
    await vi.waitFor(() => {
      expect(toApp).toEqual([{ __rerenderLensCmd: true, id: '1', cmd: 'info' }]);
      expect(toPanel).toContainEqual({ __rerenderLens: true, type: 'report', payload: { component: 'A' } });
      expect(toPanel).toContainEqual({ __rerenderLensReply: true, id: '1', result: 42 });
    });
    expect((await fetch(`${relay.url}/message`, { method: 'POST', body: 'not json{' })).status).toBe(400);
    expect(JSON.parse(await (await fetch(`${relay.url}/status`)).text())).toEqual({ ok: true, apps: 1, panels: 1, list: [{ id: 'a1', label: 'localhost:3000/shop' }] });
    app.close();
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(0));
    await vi.waitFor(() => expect(toPanel.at(-1)).toEqual({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 0, list: [] } }));
    panel.close();
  });

  it('several apps on one relay: messages are stamped, a command reaches one app or all of them', async () => {
    relay = await createRelayServer({ port: 0, keepAliveMs: 50 });
    const panel = new FetchEventSource(`${relay.url}/events?role=panel`);
    const toPanel: Record<string, unknown>[] = [];
    panel.onmessage = (e) => toPanel.push(JSON.parse(e.data) as Record<string, unknown>);
    const shop = new FetchEventSource(`${relay.url}/events?role=app&label=shop`);
    const admin = new FetchEventSource(`${relay.url}/events?role=app&label=admin`);
    const toShop: Record<string, unknown>[] = [];
    const toAdmin: Record<string, unknown>[] = [];
    shop.onmessage = (e) => toShop.push(JSON.parse(e.data) as Record<string, unknown>);
    admin.onmessage = (e) => toAdmin.push(JSON.parse(e.data) as Record<string, unknown>);
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(2));
    await vi.waitFor(() => expect(relay!.appList()).toEqual([{ id: 'a1', label: 'shop' }, { id: 'a2', label: 'admin' }]));
    // each app was told its own id, and panels have the full roster
    await vi.waitFor(() => expect(toShop[0]).toEqual({ __rerenderLensRelay: true, version: 2, app: 'a1' }));
    await vi.waitFor(() => expect(toAdmin[0]).toEqual({ __rerenderLensRelay: true, version: 2, app: 'a2' }));
    await vi.waitFor(() => expect(toPanel.at(-1)).toEqual({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 2, list: [{ id: 'a1', label: 'shop' }, { id: 'a2', label: 'admin' }] } }));

    // an app stamps its id on what it posts (via ?app=), and the panel sees who sent it
    const post = (m: unknown, from?: string) =>
      fetch(`${relay!.url}/message${from ? `?app=${from}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    await post({ __rerenderLens: true, type: 'report', payload: { component: 'Row' } }, 'a2');
    await vi.waitFor(() => expect(toPanel).toContainEqual({ __rerenderLens: true, type: 'report', payload: { component: 'Row' }, app: 'a2' }));

    // a command naming an app reaches only that one; without a name, all of them
    toShop.length = 0;
    toAdmin.length = 0;
    await post({ __rerenderLensCmd: true, id: 'q1', cmd: 'info', app: 'a1' });
    await vi.waitFor(() => expect(toShop).toEqual([{ __rerenderLensCmd: true, id: 'q1', cmd: 'info', app: 'a1' }]));
    expect(toAdmin).toEqual([]);
    await post({ __rerenderLensCmd: true, id: 'q2', cmd: 'clear' });
    await vi.waitFor(() => {
      expect(toShop).toHaveLength(2);
      expect(toAdmin).toEqual([{ __rerenderLensCmd: true, id: 'q2', cmd: 'clear' }]);
    });
    // a command for an app that went away falls back to everyone rather than vanishing
    shop.close();
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(1));
    toAdmin.length = 0;
    await post({ __rerenderLensCmd: true, id: 'q3', cmd: 'info', app: 'a1' });
    await vi.waitFor(() => expect(toAdmin).toEqual([{ __rerenderLensCmd: true, id: 'q3', cmd: 'info', app: 'a1' }]));
    admin.close();
    panel.close();
  });

  it('the library forwards reports to the relay and answers commands from it', async () => {
    relay = await createRelayServer({ port: 0, keepAliveMs: 50 });
    const collector = createCollector();
    const panel = new FetchEventSource(`${relay.url}/events?role=panel`);
    const toPanel: Record<string, unknown>[] = [];
    panel.onmessage = (e) => {
      const parsed = JSON.parse(e.data);
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) toPanel.push(m);
    };
    init({
      notifier: combineNotifiers(collector.notifier, createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window, relay: relay.url, eventSource: FetchEventSource as never })),
      silent: true,
    });
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(1));
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    await vi.waitFor(() => expect(toPanel.some((m) => m.type === 'report' && (m.payload as { component: string }).component === 'Child')).toBe(true));
    expect(toPanel.some((m) => m.type === 'hello')).toBe(true);
    // the library learned its id from the relay and stamps what it posts, so a panel can tell apps apart
    expect(relay!.appList()).toEqual([{ id: 'a1', label: expect.any(String) }]);
    expect(toPanel.find((m) => m.type === 'report')!.app).toBe('a1');
    const post = (m: unknown) => fetch(`${relay!.url}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    await post({ __rerenderLensCmd: true, id: 'q1', cmd: 'pull', arg: 0 });
    await vi.waitFor(() => expect(toPanel.find((m) => m.__rerenderLensReply && m.id === 'q1')).toBeTruthy());
    const reply = toPanel.find((m) => m.__rerenderLensReply && m.id === 'q1')!;
    expect((reply.result as { reports: unknown[] }).reports).toHaveLength(1);
    await post({ __rerenderLensCmd: true, id: 'q2', cmd: 'configure', arg: { include: ['Zed'] } });
    await vi.waitFor(() => expect(toPanel.find((m) => m.__rerenderLensReply && m.id === 'q2')).toBeTruthy());
    expect((toPanel.find((m) => m.__rerenderLensReply && m.id === 'q2')!.result as { include: string[] }).include).toEqual(['Zed']);
    hn.unmount();
    panel.close();
    await wait(20);
  });

  it('the relay URL can come from window.__RERENDER_LENS_RELAY__', async () => {
    relay = await createRelayServer({ port: 0, keepAliveMs: 50 });
    (window as unknown as { __RERENDER_LENS_RELAY__?: string }).__RERENDER_LENS_RELAY__ = relay.url;
    try {
      init({ notifier: createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window, eventSource: FetchEventSource as never }), silent: true });
      await vi.waitFor(() => expect(relay!.counts().apps).toBe(1));
    } finally {
      delete (window as unknown as { __RERENDER_LENS_RELAY__?: string }).__RERENDER_LENS_RELAY__;
    }
  });

  it('a token locks down everything that carries data; the panel URL and the library carry it', async () => {
    relay = await createRelayServer({ port: 0, keepAliveMs: 50, token: 'sekret' });
    expect(relay.connectUrl).toBe(`${relay.url}?token=sekret`);
    // the redirect hands the panel a relay URL with the token in it
    const root = await fetch(`${relay.url}/`, { redirect: 'manual' });
    expect(root.headers.get('location')).toBe(`/panel.html?relay=${encodeURIComponent(`${relay.url}?token=sekret`)}`);
    // static panel files stay open (the page has to load before it can authenticate)
    expect((await fetch(`${relay.url}/panel.js`)).status).toBe(200);
    // everything that carries data does not
    for (const path of ['/status', '/events?role=panel', '/message']) {
      const res = await fetch(`${relay.url}${path}`, { method: path === '/message' ? 'POST' : 'GET', body: path === '/message' ? '{}' : undefined });
      expect(res.status, path).toBe(401);
    }
    expect((await fetch(`${relay.url}/status?token=nope`)).status).toBe(401);
    expect((await fetch(`${relay.url}/status?token=sekret`)).status).toBe(200);
    expect((await fetch(`${relay.url}/status`, { headers: { 'x-rerender-lens-token': 'sekret' } })).status).toBe(200);

    // the library takes the token out of the relay URL it is given and authenticates with it
    const panel = new FetchEventSource(`${relay.url}/events?role=panel&token=sekret`);
    const toPanel: Record<string, unknown>[] = [];
    panel.onmessage = (e) => {
      const parsed = JSON.parse(e.data);
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) toPanel.push(m);
    };
    init({ notifier: createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window, relay: relay.connectUrl, eventSource: FetchEventSource as never }), silent: true });
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(1));
    await vi.waitFor(() => expect(toPanel.some((m) => m.type === 'hello')).toBe(true));
    panel.close();
    await wait(20);
  });

  it('CLI: `panel` starts the relay and stops on SIGINT', async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    try {
      const exit = main(['panel', '--port', '0']);
      await vi.waitFor(() => expect(out.join('\n')).toMatch(/rerender-lens panel: http:\/\/127\.0\.0\.1:\d+\//));
      const url = /panel: (http:\/\/[^/?]+)/.exec(out.join('\n'))![1]!;
      expect(JSON.parse(await (await fetch(`${url}/status`)).text()).ok).toBe(true);
      expect(out.join('\n')).not.toContain('token='); // loopback needs none
      process.emit('SIGINT');
      expect(await exit).toBe(0);

      // off loopback it generates one and says why
      out.length = 0;
      const exposed = main(['panel', '--port', '0', '--host', '0.0.0.0']);
      await vi.waitFor(() => expect(out.join('\n')).toMatch(/panel: http:\/\/localhost:\d+\?token=[\w-]{20,}/));
      expect(out.join('\n')).toContain("reports carry your app's prop, state and context values");
      const secured = /panel: (http:\/\/[^/?]+)\?token=([\w-]+)/.exec(out.join('\n'))!;
      expect((await fetch(`${secured[1]}/status`)).status).toBe(401);
      expect((await fetch(`${secured[1]}/status?token=${secured[2]}`)).status).toBe(200);
      process.emit('SIGINT');
      expect(await exposed).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
