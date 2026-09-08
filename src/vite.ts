/**
 * Vite plugin: `rerenderLens()` in `vite.config.ts` starts rerender-lens in dev before React loads,
 * with the DevTools notifier, so the extension panel works without touching the app.
 *
 * The plugin serves a virtual module that imports `rerender-lens` and calls `init`, and injects a
 * `<script type="module">` for it at the top of `<head>`. Module scripts execute in document order,
 * so it runs before the app entry (and after Vite's Fast Refresh preamble, which is fine: `init`
 * wraps whatever DevTools hook exists). Nothing happens in `vite build`.
 */
import type { Options } from './types';

/** `Options` minus the parts that cannot be serialized into a module (functions). Matchers may be strings or RegExps. */
export type VitePluginOptions = Omit<Options, 'notifier' | 'console' | 'include' | 'exclude'> & {
  include?: (string | RegExp)[];
  exclude?: (string | RegExp)[];
  /** Also post reports to the DevTools bridge for the extension. Default true. */
  devtools?: boolean;
  /** Apply in `vite build` too (for staging builds you want to inspect). Default false. */
  applyInBuild?: boolean;
};

export const VIRTUAL_ID = 'virtual:rerender-lens';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
/** URL Vite serves the virtual module under (the `\0` prefix is spelled `__x00__`). */
export const VIRTUAL_URL = '/@id/__x00__' + VIRTUAL_ID;

const serializeMatcher = (m: string | RegExp): string => (m instanceof RegExp ? `new RegExp(${JSON.stringify(m.source)}, ${JSON.stringify(m.flags)})` : JSON.stringify(m));

/** Source of the virtual module. Exported for tests and for other bundlers' loaders. */
export function renderSetupModule(options: VitePluginOptions = {}): string {
  const { devtools = true, applyInBuild: _applyInBuild, include, exclude, ...rest } = options;
  const entries: string[] = [];
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) entries.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  if (include) entries.push(`include: [${include.map(serializeMatcher).join(', ')}]`);
  if (exclude) entries.push(`exclude: [${exclude.map(serializeMatcher).join(', ')}]`);
  if (devtools) entries.push('notifier: createDevtoolsNotifier()');
  return [
    `import { init${devtools ? ', createDevtoolsNotifier' : ''} } from 'rerender-lens';`,
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
    handler(): { tag: string; attrs: Record<string, string>; injectTo: 'head-prepend' }[];
  };
}

export function rerenderLens(options: VitePluginOptions = {}): RerenderLensVitePlugin {
  const defaults: VitePluginOptions = { trackAllMemoized: true };
  const merged = { ...defaults, ...options };
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
      handler() {
        return [{ tag: 'script', attrs: { type: 'module', src: VIRTUAL_URL }, injectTo: 'head-prepend' }];
      },
    },
  };
  if (!merged.applyInBuild) plugin.apply = 'serve';
  return plugin;
}
