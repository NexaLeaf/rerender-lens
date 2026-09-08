import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const define = { __RERENDER_LENS_VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    entry: { index: 'src/index.ts', vite: 'src/vite.ts', setup: 'src/setup.ts', cli: 'src/cli.ts', relay: 'src/relay.ts', playwright: 'src/playwright.ts', vitest: 'src/vitest.ts', 'vitest-setup': 'src/vitest-setup.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: 'es2020',
    external: ['react'],
    define,
    shims: true, // import.meta.url in the CJS build (vite.ts locates panel/)
  },
  // Self-contained bundle the Chrome extension injects into pages (`window.RerenderLens`).
  {
    entry: { 'rerender-lens': 'src/inject.ts' },
    format: ['iife'],
    globalName: 'RerenderLens',
    outDir: 'extension/vendor',
    outExtension: () => ({ js: '.js' }),
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
    minify: false,
    platform: 'browser',
    target: 'es2020',
    define,
  },
  // The DevTools panel. Output is committed so the extension loads unpacked and jsdom tests need no build.
  {
    entry: { panel: 'extension/src/panel.ts' },
    format: ['iife'],
    outDir: 'extension',
    outExtension: () => ({ js: '.js' }),
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: false,
    minify: false,
    platform: 'browser',
    target: 'es2020',
    banner: { js: '/* Built from extension/src/panel.ts by `npm run build`; do not edit by hand. */' },
  },
]);
