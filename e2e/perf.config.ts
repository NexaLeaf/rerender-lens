import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The cost-per-commit run against examples/vite-react (`npm run e2e:perf`). Needs `npm run build`
// and `npm --prefix examples/vite-react install`.
export default defineConfig({
  testDir: '.',
  testMatch: /perf\.spec\.ts/,
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'npm --prefix examples/vite-react run dev',
    cwd: root,
    url: 'http://localhost:5199/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
