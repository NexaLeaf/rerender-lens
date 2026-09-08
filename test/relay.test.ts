import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createCollector, combineNotifiers, createDevtoolsNotifier, disable, init, track } from '../src/index';
import { createRelayServer, findPanelDir, type RelayServer } from '../src/relay';
import { main } from '../src/cli';
import { FetchEventSource } from './sse';
import { h, mount } from './helpers';

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
  return { Parent, rerender: () => React.act(bump) };
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
    const app = new FetchEventSource(`${relay.url}/events?role=app`);
    const toPanel: unknown[] = [];
    const toApp: unknown[] = [];
    panel.onmessage = (e) => toPanel.push(JSON.parse(e.data));
    app.onmessage = (e) => toApp.push(JSON.parse(e.data));
    await vi.waitFor(() => expect(relay!.counts()).toEqual({ apps: 1, panels: 1 }));
    // app connected -> panels learn about it
    await vi.waitFor(() => expect(toPanel).toContainEqual({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1 } }));
    const post = (m: unknown) => fetch(`${relay!.url}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    expect((await post({ __rerenderLens: true, type: 'report', payload: { component: 'A' } })).status).toBe(204);
    expect((await post([{ __rerenderLensCmd: true, id: '1', cmd: 'info' }, { __rerenderLensReply: true, id: '1', result: 42 }])).status).toBe(204);
    await vi.waitFor(() => {
      expect(toApp).toEqual([{ __rerenderLensCmd: true, id: '1', cmd: 'info' }]);
      expect(toPanel).toContainEqual({ __rerenderLens: true, type: 'report', payload: { component: 'A' } });
      expect(toPanel).toContainEqual({ __rerenderLensReply: true, id: '1', result: 42 });
    });
    expect((await fetch(`${relay.url}/message`, { method: 'POST', body: 'not json{' })).status).toBe(400);
    expect(JSON.parse(await (await fetch(`${relay.url}/status`)).text())).toEqual({ ok: true, apps: 1, panels: 1 });
    app.close();
    await vi.waitFor(() => expect(relay!.counts().apps).toBe(0));
    await vi.waitFor(() => expect(toPanel.at(-1)).toEqual({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 0 } }));
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

  it('CLI: `panel` starts the relay and stops on SIGINT', async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    try {
      const exit = main(['panel', '--port', '0']);
      await vi.waitFor(() => expect(out.join('\n')).toMatch(/rerender-lens panel: http:\/\/127\.0\.0\.1:\d+\//));
      const url = /panel: (http:\/\/[^/]+)\//.exec(out.join('\n'))![1]!;
      expect(JSON.parse(await (await fetch(`${url}/status`)).text()).ok).toBe(true);
      process.emit('SIGINT');
      expect(await exit).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
