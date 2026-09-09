import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'panel.js'), 'utf8');

interface Transport {
  subscribe(fn: (m: unknown) => void): void;
  configure(o: unknown): Promise<unknown>;
  tabLabel: string;
  storage: { get(k: string): unknown; set(k: string, v: unknown): void };
  [k: string]: unknown;
}
interface Panel {
  state: { reports: unknown[]; view: string };
  flush(): void;
  setView(v: string): void;
}
interface Factory {
  createPanel(root: HTMLElement, t: Transport, o?: object): Panel;
  createRelayClientTransport(url: string, ES: unknown): Transport;
}

/** Stands in for the relay's SSE stream. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  push(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(): void {
    this.closed = true;
  }
}

const report = (over: Record<string, unknown> = {}) => ({
  component: 'Row', path: ['App', 'List'], trigger: 'parent', avoidable: true, renderCount: 1, instanceId: 1, commitId: 1,
  owner: 'List', parent: { name: 'App', trigger: 'state' },
  props: { prev: { n: 1 }, next: { n: 1 } },
  propChanges: [{ path: 'style', kind: 'deep-equal', prev: { a: 1 }, next: { a: 1 } }],
  stateChanges: [], hookChanges: [], reasons: [],
  ...over,
});

describe('relay client transport', () => {
  let factory: Factory;
  let root: HTMLElement;
  const posted: Record<string, unknown>[] = [];
  beforeEach(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.RerenderLensPanel;
    new Function('window', 'document', 'chrome', source)(window, document, undefined);
    factory = w.RerenderLensPanel as Factory;
    root = document.createElement('div');
    document.body.appendChild(root);
    FakeEventSource.instances = [];
    posted.length = 0;
    // The relay's POST endpoint: commands are answered by a pretend app through the SSE stream.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        expect(url).toBe('http://127.0.0.1:4141/message');
        const cmd = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
        posted.push(cmd);
        const result = cmd.cmd === 'info' ? { count: 1, library: '0.3.0', protocol: 2, react: [{ version: '19.2.0' }], enabled: true, options: {}, commits: 2 } : cmd.cmd === 'pull' ? { seq: 1, reports: [report()], dropped: false } : cmd.cmd === 'configure' ? { include: ['Row'] } : true;
        setTimeout(() => FakeEventSource.instances[0]?.push({ __rerenderLensReply: true, id: cmd.id, result }), 0);
        return new Response(null, { status: 204 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    root.remove();
  });

  it('connects over SSE, drives commands through POST, and follows apps coming and going', async () => {
    const transport = factory.createRelayClientTransport('http://127.0.0.1:4141/', FakeEventSource);
    expect(transport.tabLabel).toBe('relay 127.0.0.1:4141');
    const panel = factory.createPanel(root, transport);
    expect(FakeEventSource.instances[0]!.url).toBe('http://127.0.0.1:4141/events?role=panel');
    // Nothing is sent until the relay's first message says the stream is up (a reply before that would be lost).
    expect(posted).toHaveLength(0);
    FakeEventSource.instances[0]!.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1 } });
    for (let i = 0; i < 50 && panel.state.reports.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      panel.flush();
    }
    expect(posted.map((c) => c.cmd).slice(0, 2)).toEqual(['info', 'pull']);
    expect(root.querySelector('.status-text')!.textContent).toBe('connected · lib 0.3.0 · React 19.2.0');
    expect(root.querySelector('.tab-chip')!.textContent).toBe('relay 127.0.0.1:4141');
    expect(panel.state.reports).toHaveLength(1);

    // live traffic from the app, single messages and batches alike
    const stream = FakeEventSource.instances[0]!;
    stream.push({ __rerenderLens: true, version: 2, type: 'report', payload: report({ component: 'Live', instanceId: 2 }) });
    stream.push([{ __rerenderLens: true, version: 2, type: 'report', payload: report({ component: 'Batch', instanceId: 3 }) }]);
    panel.flush();
    expect(panel.state.reports).toHaveLength(3);

    // the app goes away, then a new one connects: the panel re-attaches (info + pull again)
    stream.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 0 } });
    panel.flush();
    expect(root.querySelector('.status-text')!.textContent).toBe('no page');
    const before = posted.length;
    stream.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1 } });
    await vi.waitFor(() => expect(posted.slice(before).map((c) => c.cmd)).toEqual(['info', 'pull']));

    expect(await transport.configure({ include: ['Row'] })).toEqual({ include: ['Row'] });
    // storage is per relay URL
    transport.storage.set('panel', { view: 'offenders' });
    expect(JSON.parse(localStorage.getItem('rerender-lens:relay:http://127.0.0.1:4141:panel') || '{}').view).toBe('offenders');
    expect(transport.storage.get('panel')).toEqual({ view: 'offenders' });
  });

  it('several apps on one relay: a picker appears, commands name the app, other apps are ignored', async () => {
    const transport = factory.createRelayClientTransport('http://127.0.0.1:4141/', FakeEventSource);
    const panel = factory.createPanel(root, transport);
    const stream = FakeEventSource.instances[0]!;
    const picker = (): HTMLSelectElement => root.querySelector('.app-picker') as HTMLSelectElement;

    // one app: nothing to choose
    stream.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1, list: [{ id: 'a1', label: 'shop' }] } });
    await vi.waitFor(() => expect(posted.map((c) => c.cmd)).toEqual(['info', 'pull']));
    expect(picker().hidden).toBe(true);
    expect(posted.every((c) => c.app === 'a1')).toBe(true); // still addressed, so the other apps stay quiet

    // a second app connects: the picker appears with both, still watching the first
    stream.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 2, list: [{ id: 'a1', label: 'shop' }, { id: 'a2', label: 'admin' }] } });
    panel.flush();
    expect(picker().hidden).toBe(false);
    expect([...picker().options].map((o) => [o.value, o.textContent])).toEqual([['a1', 'shop'], ['a2', 'admin']]);
    expect(picker().value).toBe('a1');

    // reports from the app being watched arrive; the other app's do not
    stream.push({ __rerenderLens: true, version: 2, type: 'report', app: 'a1', payload: report({ component: 'Shop', instanceId: 9 }) });
    stream.push({ __rerenderLens: true, version: 2, type: 'report', app: 'a2', payload: report({ component: 'Admin', instanceId: 10 }) });
    panel.flush();
    expect(panel.state.reports.map((r) => (r as { component: string }).component)).toContain('Shop');
    expect(panel.state.reports.map((r) => (r as { component: string }).component)).not.toContain('Admin');

    // switching apps starts over on the other one and addresses it
    const before = posted.length;
    picker().value = 'a2';
    picker().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(posted.slice(before).map((c) => c.cmd)).toEqual(['info', 'pull']));
    expect(posted.slice(before).every((c) => c.app === 'a2')).toBe(true);
    panel.flush();
    expect(panel.state.reports.map((r) => (r as { component: string }).component)).not.toContain('Shop');
    stream.push({ __rerenderLens: true, version: 2, type: 'report', app: 'a2', payload: report({ component: 'Admin', instanceId: 10 }) });
    panel.flush();
    expect(panel.state.reports.map((r) => (r as { component: string }).component)).toContain('Admin');

    // the watched app goes away: the panel falls back to the one that is left
    stream.push({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: 1, list: [{ id: 'a1', label: 'shop' }] } });
    panel.flush();
    expect(picker().hidden).toBe(true);
    await vi.waitFor(() => expect(posted.at(-1)!.app).toBe('a1'));
  });
});
