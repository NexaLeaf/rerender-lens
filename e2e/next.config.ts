import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The Next.js example (examples/next, `rerender-lens/setup` from instrumentation-client.ts) against
// the relay panel (`rerender-lens panel`). Needs `npm run build` and `npm --prefix examples/next install`.
export default defineConfig({
  testDir: '.',
  testMatch: /next\.spec\.ts/,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3005' },
  webServer: [
    {
      command: 'node dist/cli.js panel --port 4142',
      cwd: root,
      url: 'http://127.0.0.1:4142/status',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm --prefix examples/next run dev',
      cwd: root,
      url: 'http://localhost:3005/',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
