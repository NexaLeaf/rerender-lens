/**
 * Side-effect entry: `import 'rerender-lens/setup'` starts rerender-lens with sensible defaults
 * (every memo / PureComponent tracked, console + DevTools bridge) outside production.
 *
 * Use it where a bundler runs code before React: Next.js `instrumentation-client.ts`, a Webpack
 * entry array (`entry: ['rerender-lens/setup', './src/index']`), or the first import of your app.
 * `process.env.NODE_ENV` is read defensively so it works in the browser without a bundler define.
 */
import { init } from './tracker';
import { createDevtoolsNotifier } from './devtools';

declare const process: { env?: { NODE_ENV?: string; RERENDER_LENS_RELAY?: string; NEXT_PUBLIC_RERENDER_LENS_RELAY?: string } } | undefined;

const env = (key: 'NODE_ENV' | 'RERENDER_LENS_RELAY' | 'NEXT_PUBLIC_RERENDER_LENS_RELAY'): string | undefined => {
  try {
    return typeof process !== 'undefined' && process && process.env ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
};

if (env('NODE_ENV') !== 'production' && typeof window !== 'undefined' && !window.__RERENDER_LENS_DEVTOOLS__) {
  // `npx rerender-lens panel` prints the relay URL; put it in RERENDER_LENS_RELAY (or the NEXT_PUBLIC_
  // variant for Next.js) to reach the panel from any app. `createDevtoolsNotifier` also honours
  // `window.__RERENDER_LENS_RELAY__` set before the app loads.
  const relay = env('RERENDER_LENS_RELAY') || env('NEXT_PUBLIC_RERENDER_LENS_RELAY');
  init({ trackAllMemoized: true, notifier: createDevtoolsNotifier(relay ? { relay } : {}) });
}

export {};
