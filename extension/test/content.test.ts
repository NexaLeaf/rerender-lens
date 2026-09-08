import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeChrome, settle, type FakeChrome, type FakePort } from './fake-chrome';

const source = readFileSync(join(__dirname, '..', 'content.js'), 'utf8');

/** Runs content.js against a stand-in window whose `message` listener we can call directly. */
function load(chrome: FakeChrome) {
  let handler: ((e: { source: unknown; data: unknown }) => void) | null = null;
  const posted: Record<string, unknown>[] = [];
  const win = {
    addEventListener: (type: string, fn: (e: { source: unknown; data: unknown }) => void) => {
      if (type === 'message') handler = fn;
    },
    postMessage: (m: Record<string, unknown>) => posted.push(m),
  };
  new Function('chrome', 'window', source)(chrome, win);
  return {
    posted,
    message: (data: unknown) => handler!({ source: win, data }),
    port: (i = 0) => chrome.runtime.connect.mock.results[i]!.value as FakePort,
  };
}

const page = (type: string, payload?: unknown) => ({ __rerenderLens: true, type, version: 2, payload });

describe('content script', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces one macrotask of page messages into a single port message, in order; a lone message goes as-is', async () => {
    const chrome = makeChrome();
    const c = load(chrome);
    const port = c.port();
    expect(port.name).toBe('rerender-lens-content');
    // announced itself to the page once on load
    expect(c.posted).toEqual([{ __rerenderLensReady: true }]);

    c.message(page('hello', { library: '0.3.0' }));
    c.message(page('report', { component: 'A' }));
    c.message(page('report', { component: 'B' }));
    c.message({ notOurs: true }); // ignored
    expect(port.sent).toEqual([]);
    // hello is answered immediately (the library starts posting only after hearing it)
    expect(c.posted).toHaveLength(2);
    await settle();
    expect(port.sent).toEqual([
      {
        type: 'batch',
        items: [
          { type: 'hello', version: 2, payload: { library: '0.3.0' } },
          { type: 'report', version: 2, payload: { component: 'A' } },
          { type: 'report', version: 2, payload: { component: 'B' } },
        ],
      },
    ]);

    c.message(page('clear'));
    await settle();
    expect(port.sent).toHaveLength(2);
    expect(port.sent[1]).toEqual({ type: 'clear', version: 2, payload: undefined });
  });

  it('keeps messages while the port is down (newest 500) and sends them as one batch after reconnecting', async () => {
    vi.useFakeTimers();
    const chrome = makeChrome();
    const c = load(chrome);
    c.port(0).onDisconnect.emit();
    for (let i = 0; i < 510; i++) c.message(page('report', { component: `C${i}` }));
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    const port = c.port(1);
    expect(port.sent).toHaveLength(1);
    const batch = port.sent[0] as { type: string; items: { payload: { component: string } }[] };
    expect(batch.type).toBe('batch');
    expect(batch.items).toHaveLength(500);
    expect(batch.items[0]!.payload.component).toBe('C10');
    expect(batch.items[499]!.payload.component).toBe('C509');
  });
});
