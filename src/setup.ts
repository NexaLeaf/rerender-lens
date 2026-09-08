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

declare const process: { env?: { NODE_ENV?: string } } | undefined;

const isProduction = (): boolean => {
  try {
    return typeof process !== 'undefined' && !!process && !!process.env && process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
};

if (!isProduction() && typeof window !== 'undefined' && !window.__RERENDER_LENS_DEVTOOLS__) {
  init({ trackAllMemoized: true, notifier: createDevtoolsNotifier() });
}

export {};
