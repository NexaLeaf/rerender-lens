/**
 * Vite plugin: `rerenderLens()` in `vite.config.ts` starts rerender-lens in dev before React loads,
 * with the DevTools notifier, so the extension panel works without touching the app.
 *
 * With `panel: true` it also serves the panel itself at `/__rerender-lens/` (no extension needed): the
 * app publishes on a same-origin `BroadcastChannel`, the panel tab listens and sends commands back.
 *
 * The plugin serves a virtual module that imports `rerender-lens` and calls `init`, and injects a
 * `<script type="module">` for it at the top of `<head>`. Module scripts execute in document order,
 * so it runs before the app entry (and after Vite's Fast Refresh preamble, which is fine: `init`
 * wraps whatever DevTools hook exists). Nothing happens in `vite build`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from './types';

/** `Options` minus the parts that cannot be serialized into a module (functions). Matchers may be strings or RegExps. */
export type VitePluginOptions = Omit<Options, 'notifier' | 'console' | 'include' | 'exclude'> & {
  include?: (string | RegExp)[];
  exclude?: (string | RegExp)[];
  /** Also post reports to the DevTools bridge for the extension. Default true. */
  devtools?: boolean;
  /** Apply in `vite build` too (for staging builds you want to inspect). Default false. */
  applyInBuild?: boolean;
  /**
   * Serve the panel from the dev server (default path `/__rerender-lens/`) and publish reports on a
   * BroadcastChannel so it works without the extension. `true`, or a mount path. Default false.
   */
  panel?: boolean | string;
  /** BroadcastChannel name used with `panel`. Default `rerender-lens`. */
  channel?: string;
  /** Which HTML pages get the setup script: an allow-list of paths (`/`, `/admin.html`) or a predicate. Default all. */
  pages?: string[] | ((path: string) => boolean);
};

export const VIRTUAL_ID = 'virtual:rerender-lens';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
/** URL Vite serves the virtual module under (the `\0` prefix is spelled `__x00__`). */
export const VIRTUAL_URL = '/@id/__x00__' + VIRTUAL_ID;
export const DEFAULT_PANEL_PATH = '/__rerender-lens/';

const serializeMatcher = (m: string | RegExp): string => (m instanceof RegExp ? `new RegExp(${JSON.stringify(m.source)}, ${JSON.stringify(m.flags)})` : JSON.stringify(m));

/** Source of the virtual module. Exported for tests and for other bundlers' loaders. */
export function renderSetupModule(options: VitePluginOptions = {}): string {
  const { devtools = true, applyInBuild: _applyInBuild, panel, channel, pages: _pages, include, exclude, ...rest } = options;
  const entries: string[] = [];
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) entries.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  if (include) entries.push(`include: [${include.map(serializeMatcher).join(', ')}]`);
  if (exclude) entries.push(`exclude: [${exclude.map(serializeMatcher).join(', ')}]`);
  const notifierOptions = panel ? `{ channel: ${JSON.stringify(channel || 'rerender-lens')} }` : '';
  if (devtools || panel) entries.push(`notifier: createDevtoolsNotifier(${notifierOptions})`);
  return [
    `import { init${devtools || panel ? ', createDevtoolsNotifier' : ''} } from 'rerender-lens';`,
    `init({ ${entries.join(', ')} });`,
    '',
  ].join('\n');
}

/** Minimal shape of a Vite plugin, so `vite` stays an optional peer. */
export interface RerenderLensVitePlugin {
  name: string;
  apply?: 'serve' | 'build';
  enforce?: 'pre' | 'post';
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  transformIndexHtml: {
    order: 'pre';
    handler(html: string, ctx?: { path?: string; filename?: string }): { tag: string; attrs: Record<string, string>; injectTo: 'head-prepend' }[];
  };
  configureServer?(server: ViteServerLike): void;
}

/** The parts of Vite's dev server the plugin uses. */
export interface ViteServerLike {
  /** Connect-style; mounting without a path keeps `req.url` intact (a mount path would strip the prefix). */
  middlewares: { use(handler: (req: IncomingLike, res: ResponseLike, next: () => void) => void): void };
  config?: { logger?: { info(msg: string): void }; server?: { port?: number; host?: string | boolean } };
  resolvedUrls?: { local?: string[] } | null;
  httpServer?: { once(event: 'listening', cb: () => void): void } | null;
}
interface IncomingLike {
  url?: string;
  method?: string;
}
interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array): void;
}

/** Directory holding panel.html/js/css: `panel/` next to `dist/` in the package, or the extension folder in this repo. */
export function panelDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [join(here, '..', 'panel'), join(here, '..', 'extension'), join(here, '..', '..', 'extension')]) {
    if (existsSync(join(dir, 'panel.html')) && existsSync(join(dir, 'panel.js'))) return dir;
  }
  return null;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Middleware serving the panel under `mount` (exported for tests). */
export function panelMiddleware(mount: string, channel: string, dir: string | null): (req: IncomingLike, res: ResponseLike, next: () => void) => void {
  const base = mount.endsWith('/') ? mount : mount + '/';
  return (req, res, next) => {
    const url = req.url || '/';
    if (!url.startsWith(base.slice(0, -1))) return next();
    const [pathOnly, query = ''] = url.split('?', 2);
    if (pathOnly === base.slice(0, -1) || pathOnly === base) {
      // The panel boots in channel mode from its query string.
      res.statusCode = 302;
      res.setHeader('Location', `${base}panel.html?channel=${encodeURIComponent(channel)}${query ? '&' + query : ''}`);
      res.end();
      return;
    }
    const file = pathOnly!.slice(base.length);
    if (!/^panel\.(html|js|css)$/.test(file)) return next();
    if (!dir) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('rerender-lens: panel files not found (is the package built?)');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(join(dir, file)));
  };
}

export function rerenderLens(options: VitePluginOptions = {}): RerenderLensVitePlugin {
  const defaults: VitePluginOptions = { trackAllMemoized: true };
  const merged = { ...defaults, ...options };
  const pages = merged.pages;
  const wants = (path: string | undefined): boolean => {
    if (!pages) return true;
    const p = path || '/';
    if (typeof pages === 'function') return pages(p);
    return pages.some((x) => x === p || (x === '/' && p === '/index.html') || (x === '/index.html' && p === '/'));
  };
  const mount = typeof merged.panel === 'string' ? merged.panel : DEFAULT_PANEL_PATH;
  const plugin: RerenderLensVitePlugin = {
    name: 'rerender-lens',
    enforce: 'pre',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? renderSetupModule(merged) : undefined;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        if (!wants(ctx?.path)) return [];
        return [{ tag: 'script', attrs: { type: 'module', src: VIRTUAL_URL }, injectTo: 'head-prepend' }];
      },
    },
  };
  if (!merged.applyInBuild) plugin.apply = 'serve';
  if (merged.panel) {
    plugin.configureServer = (server) => {
      server.middlewares.use(panelMiddleware(mount, merged.channel || 'rerender-lens', panelDir()));
      const announce = (): void => {
        const local = server.resolvedUrls?.local?.[0];
        server.config?.logger?.info(`  ➜  rerender-lens panel: ${local ? local.replace(/\/$/, '') : ''}${mount}`);
      };
      if (server.httpServer) server.httpServer.once('listening', () => setTimeout(announce, 0));
    };
  }
  return plugin;
}
