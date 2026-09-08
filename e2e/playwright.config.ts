import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Runs Chromium with the unpacked extension against the example app (port 5199).
// `npm run build` must have run first (it produces the extension/vendor/rerender-lens.*.js scripts).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'npm --prefix examples/vite-react run dev',
    cwd: root,
    url: 'http://localhost:5199/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
