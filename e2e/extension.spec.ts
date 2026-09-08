import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'extension');

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'rerender-lens-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

// `window.__RERENDER_LENS_DEVTOOLS__` is typed by the library (src/devtools.ts); its reports are `unknown`.
interface Report {
  component: string;
  avoidable: boolean;
  commitId: number;
}
declare global {
  interface Window {
    __RERENDER_LENS_INJECTED__?: string;
  }
}

test('relays reports from a page that runs the library itself and counts them on the badge', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  // The content script connected to the background for this tab.
  await expect.poll(() => worker.evaluate(() => contentByTab.size)).toBeGreaterThan(0);

  await page.getByRole('button', { name: /Re-render App/ }).click();
  await page.getByRole('button', { name: /Re-render App/ }).click();

  const pulled = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.pull(0));
  const reports = pulled.reports as Report[];
  expect(reports.length).toBeGreaterThan(0);
  const avoidable = reports.filter((r) => r.avoidable);
  expect(avoidable.map((r) => r.component)).toEqual(expect.arrayContaining(['Toolbar', 'ProductList', 'Row']));
  expect(new Set(reports.map((r) => r.commitId)).size).toBe(2);

  const info = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info());
  expect(info.protocol).toBe(2);
  expect(info.production).toBe(false);
  expect(info.react[0]?.version).toMatch(/^19\./);

  // The badge shows the avoidable count for that tab.
  await expect
    .poll(async () => {
      const [tab] = await worker.evaluate(() => chrome.tabs.query({ url: 'http://localhost:5199/*' }));
      return tab ? worker.evaluate((id: number) => chrome.action.getBadgeText({ tabId: id }), tab.id!) : '';
    })
    .toBe(String(avoidable.length));
});

test('injects the library into a page that does not load it when injection is enabled for the origin', async ({ context, worker }) => {
  // Before enabling: nothing in the page.
  let page = await context.newPage();
  await page.goto('/plain.html');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  expect(await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__ === undefined)).toBe(true);
  await page.close();

  // Enable injection for the origin the way the popup / panel do (via storage + reconcile).
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ origins: { 'http://localhost:5199': { inject: true } } });
    await reconcile();
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id))).toContain('inject:http://localhost:5199');

  page = await context.newPage();
  await page.goto('/plain.html');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  expect(await page.evaluate(() => typeof window.__RERENDER_LENS_INJECTED__)).toBe('string');
  await page.getByRole('button', { name: /Re-render App/ }).click();
  const pulled = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.pull(0));
  // trackAllMemoized is the injected default: Toolbar and ProductList are memo components with defeated props.
  expect((pulled.reports as Report[]).filter((r) => r.avoidable).map((r) => r.component)).toEqual(expect.arrayContaining(['Toolbar', 'ProductList']));

  const info = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info());
  expect(info.source).toBe('extension');
  expect(info.injected).toBe(true);
  await page.close();

  // Deferred mode: the hook is created one task later, which is still before react-dom loads.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ origins: { 'http://localhost:5199': { inject: true, deferHook: true } } });
    await reconcile();
  });
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).find((s) => s.id.startsWith('inject:'))?.js))
    .toEqual(['vendor/rerender-lens.core.js', 'vendor/rerender-lens.engine.js', 'vendor/rerender-lens.js', 'inject-deferred.js', 'inject.js']);
  page = await context.newPage();
  await page.goto('/plain.html');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  await page.getByRole('button', { name: /Re-render App/ }).click();
  await expect.poll(() => page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__?.size ?? 0)).toBeGreaterThan(0);

  // On the page that runs the library itself, the injected copy steps aside and says so.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  const own = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info());
  expect(own.source).toBe('page');
  expect(own.injected).toBe(true);

  // Disabling removes the registration again.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ origins: {} });
    await removeOrigin('http://localhost:5199');
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(0);
});

test('the panel page renders its demo data with fixes and commits', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/panel.html?demo`);
  await expect(page.locator('.row .name').first()).toBeVisible();
  await expect(page.locator('.status-text')).toHaveText(/connected · lib demo/);
  await page.locator('.row .name', { hasText: 'ProductRow' }).first().click();
  await expect(page.locator('.details-header .name')).toHaveText('ProductRow');
  await page.getByRole('button', { name: 'Fix', exact: true }).click();
  await expect(page.locator('.snippet').first()).toContainText('useCallback');
  await page.getByRole('button', { name: 'Commits' }).click();
  await expect(page.locator('.commits li').first()).toContainText('avoidable');
  await page.getByRole('button', { name: 'Fixes' }).click();
  await expect(page.locator('.fixes li').first()).toContainText('in <ProductList>');
});

test('the side panel page follows a tab through the relay and chrome.scripting, outside DevTools', async ({ context, worker, extensionId }) => {
  const app = await context.newPage();
  await app.goto('/');
  await expect(app.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  const [tab] = await worker.evaluate(() => chrome.tabs.query({ url: 'http://localhost:5199/*' }));
  const side = await context.newPage();
  await side.setViewportSize({ width: 380, height: 800 }); // side-panel width
  await side.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tab!.id}`);
  await expect(side.locator('.status-text')).toHaveText(/connected · lib 0\.\d+\.\d+ · React 19/);
  await expect(side.locator('.tab-chip')).toContainText('localhost:5199');
  await expect(side.locator('#root')).toHaveClass(/compact/);
  await app.getByRole('button', { name: /Re-render App/ }).click();
  await expect(side.locator('.row .name', { hasText: 'Toolbar' }).first()).toBeVisible();
  await expect(side.locator('.summary .stat.bad b').first()).not.toHaveText('0');
  // hovering a row highlights the component in the app page
  await side.locator('.row .name', { hasText: 'Toolbar' }).first().hover();
  await expect.poll(() => app.evaluate(() => document.querySelectorAll('#rerender-lens-overlay > div').length)).toBeGreaterThan(0);
  await side.close();
  await app.close();
});

test('the panel served by the Vite plugin works without the extension, over a BroadcastChannel', async ({ context }) => {
  const app = await context.newPage();
  await app.goto('/');
  await expect(app.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();
  const panel = await context.newPage();
  const res = await panel.goto('/__rerender-lens/');
  expect(res?.url()).toContain('/__rerender-lens/panel.html?channel=rerender-lens');
  await expect(panel.locator('.status-text')).toHaveText(/connected · lib 0\.\d+\.\d+ · React 19/);
  await expect(panel.locator('.tab-chip')).toHaveText('channel "rerender-lens"');
  await app.getByRole('button', { name: /Re-render App/ }).click();
  await expect(panel.locator('.row .name', { hasText: 'Toolbar' }).first()).toBeVisible();
  // commands travel back: hovering highlights in the app tab
  await panel.locator('.row .name', { hasText: 'Toolbar' }).first().hover();
  await expect.poll(() => app.evaluate(() => document.querySelectorAll('#rerender-lens-overlay > div').length)).toBeGreaterThan(0);
  // settings go through the channel too
  await panel.getByRole('button', { name: 'Settings' }).click();
  const all = panel.locator('label.opt', { hasText: 'Track every component' }).locator('input');
  await all.check();
  await expect(panel.locator('.toast')).toHaveText('Applied');
  await panel.close();
  await app.close();
});

declare const contentByTab: Map<number, unknown>;
declare function reconcile(): Promise<void>;
declare function removeOrigin(origin: string): Promise<void>;
