/**
 * Side-effect entry: `import 'rerender-lens/setup'` starts rerender-lens with sensible defaults
 * (every memo / PureComponent tracked, console + DevTools bridge) outside production.
 *
 * Use it where a bundler runs code before React: Next.js `instrumentation-client.ts`, a Webpack
 * entry array (`entry: ['rerender-lens/setup', './src/index']`), or the first import of your app.
 *
 * The environment is read through static `process.env.X` member expressions on purpose: Next.js,
 * Webpack's DefinePlugin, Vite and esbuild inline those at build time, and none of them inlines a
 * dynamic `process.env[key]`. In a plain browser `process` does not exist; the reads throw and
 * fall back to "not set".
 */
import { init } from './tracker';
import { createDevtoolsNotifier } from './devtools';

declare const process: { env: { NODE_ENV?: string; RERENDER_LENS_RELAY?: string; NEXT_PUBLIC_RERENDER_LENS_RELAY?: string } };

const read = (get: () => string | undefined): string | undefined => {
  try {
    return get();
  } catch {
    return undefined;
  }
};

const production = read(() => process.env.NODE_ENV) === 'production';

if (!production && typeof window !== 'undefined' && !window.__RERENDER_LENS_DEVTOOLS__) {
  // `npx rerender-lens panel` prints the relay URL; put it in RERENDER_LENS_RELAY (or the NEXT_PUBLIC_
  // variant for Next.js) to reach the panel from any app. `createDevtoolsNotifier` also honours
  // `window.__RERENDER_LENS_RELAY__` set before the app loads.
  const relay = read(() => process.env.RERENDER_LENS_RELAY) || read(() => process.env.NEXT_PUBLIC_RERENDER_LENS_RELAY);
  init({ trackAllMemoized: true, notifier: createDevtoolsNotifier(relay ? { relay } : {}) });
}

export {};
