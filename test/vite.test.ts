import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { renderSetupModule, rerenderLens, VIRTUAL_URL } from '../src/vite';

const example = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'vite-react');

describe('vite plugin', () => {
  let server: ViteDevServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('renders the setup module from options (matchers as strings or RegExps, devtools notifier by default)', () => {
    const src = renderSetupModule({ trackAllMemoized: true, include: ['Sidebar', /^Grid/i], silent: true, maxReportsPerComponent: 3 });
    expect(src).toBe(
      [
        "import { init, createDevtoolsNotifier } from 'rerender-lens';",
        'init({ "trackAllMemoized": true, "silent": true, "maxReportsPerComponent": 3, include: ["Sidebar", new RegExp("^Grid", "i")], notifier: createDevtoolsNotifier() });',
        '',
      ].join('\n'),
    );
    expect(renderSetupModule({ devtools: false })).toBe("import { init } from 'rerender-lens';\ninit({  });\n");
  });

  it('is dev-only by default and injects the virtual module first in <head>', async () => {
    const plugin = rerenderLens({ include: ['Row'] });
    expect(plugin.apply).toBe('serve');
    expect(rerenderLens({ applyInBuild: true }).apply).toBeUndefined();
    expect(plugin.resolveId('virtual:rerender-lens')).toBe('\0virtual:rerender-lens');
    expect(plugin.resolveId('other')).toBeUndefined();
    expect(plugin.load('\0virtual:rerender-lens')).toContain('include: ["Row"]');
    expect(plugin.transformIndexHtml.handler()).toEqual([{ tag: 'script', attrs: { type: 'module', src: VIRTUAL_URL }, injectTo: 'head-prepend' }]);
  }, 20_000);

  it('works inside a real Vite dev server: the html gets the script and the module resolves to library code', async () => {
    server = await createServer({
      root: example,
      configFile: false,
      logLevel: 'silent',
      plugins: [rerenderLens({ trackAllComponents: true, silent: true }) as never],
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const html = await server.transformIndexHtml('/plain.html', '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/src/plain.tsx"></script></body></html>');
    const first = html.indexOf(VIRTUAL_URL);
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(html.indexOf('/src/plain.tsx'));
    const mod = await server.transformRequest('\0virtual:rerender-lens');
    expect(mod?.code).toContain('trackAllComponents');
    expect(mod?.code).toContain('createDevtoolsNotifier');
    expect(mod?.code).toMatch(/from\s+["'][^"']*rerender-lens/);
  }, 30_000);
});
