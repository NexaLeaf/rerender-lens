import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs the unit suite against another React installed outside node_modules:
 *
 *   npm i --prefix .react18 react@18 react-dom@18
 *   REACT_COMPAT_DIR=.react18/node_modules npx vitest run --config test/react-compat.config.ts
 *
 * (`npm run test:react18` / `test:react17` do exactly that.) `react`, `react-dom` and the JSX
 * runtimes are aliased to that directory; react-dom's own `react` and `scheduler` resolve from it too.
 */
const dir = resolve(process.env.REACT_COMPAT_DIR || '.react18/node_modules');
if (!existsSync(resolve(dir, 'react/package.json'))) throw new Error(`REACT_COMPAT_DIR: no react in ${dir} (npm i --prefix .react18 react@18 react-dom@18)`);
const r = (p: string): string => resolve(dir, p);
// React 17 has no root API; the harness gets a shim with createRoot on top of ReactDOM.render.
const client = existsSync(r('react-dom/client.js')) ? r('react-dom/client.js') : resolve('test/react17-client-shim.ts');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: client },
      { find: /^react-dom\/test-utils$/, replacement: r('react-dom/test-utils.js') },
      { find: /^react-dom$/, replacement: r('react-dom/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: r('react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: r('react/jsx-dev-runtime.js') },
      { find: /^react$/, replacement: r('react/index.js') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'extension/test/**/*.test.ts'],
    globals: false,
    setupFiles: ['test/setup.ts'],
  },
});
