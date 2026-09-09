import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The real thing: a minified production build of the example (`examples/vite-react/dist`, source
 * maps kept on purpose) served by `vite preview`, with the relay panel resolving its names.
 * Needs `npm run build` and `npm --prefix examples/vite-react run build` first; `npm run e2e:prod`
 * does both.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /prod\.spec\.ts/,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5200' },
  webServer: [
    {
      command: 'node dist/cli.js panel --port 4143',
      cwd: root,
      url: 'http://127.0.0.1:4143/status',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm --prefix examples/vite-react run preview',
      cwd: root,
      url: 'http://localhost:5200/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
