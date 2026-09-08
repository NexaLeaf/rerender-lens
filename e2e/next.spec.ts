import { expect, test } from '@playwright/test';

const RELAY = 'http://127.0.0.1:4142';

interface Report {
  component: string;
  avoidable: boolean;
}

test('a Next.js app started from instrumentation-client.ts reaches the relay panel, which drives it back', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'rerender-lens Next.js example' })).toBeVisible();
  // `rerender-lens/setup` ran before the app: the bridge exists and knows the relay.
  await expect.poll(() => page.evaluate(() => typeof window.__RERENDER_LENS_DEVTOOLS__)).toBe('object');
  const info = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info());
  expect(info.react[0]?.version).toMatch(/^19\./);
  expect(info.options.trackAllMemoized).toBe(true);
  await expect.poll(async () => (await (await fetch(`${RELAY}/status`)).json()).apps).toBeGreaterThan(0);

  await page.getByRole('button', { name: /Re-render App/ }).click();
  await page.getByRole('button', { name: /Re-render App/ }).click();
  const pulled = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.pull(0));
  const avoidable = (pulled.reports as Report[]).filter((r) => r.avoidable).map((r) => r.component);
  expect(avoidable).toEqual(expect.arrayContaining(['Toolbar', 'ProductList']));

  // The panel served by the relay attaches to the app and replays what it buffered.
  const panel = await context.newPage();
  const res = await panel.goto(`${RELAY}/`);
  expect(res?.url()).toContain('/panel.html?relay=');
  await expect(panel.locator('.status-text')).toHaveText(/connected · lib 0\.\d+\.\d+ · React 19/);
  await expect(panel.locator('.tab-chip')).toHaveText('relay 127.0.0.1:4142');
  await expect(panel.locator('.stream')).toContainText('4 reports'); // replayed from the app's buffer
  await expect(panel.locator('.stream')).toContainText('Toolbar');
  // Next.js wraps the page in ~30 framework components and the tree is virtualized: scroll to the end.
  await panel.locator('.tree').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(panel.locator('.row .name', { hasText: 'Toolbar' }).first()).toBeVisible();
  // live traffic after the panel connected
  await page.getByRole('button', { name: /Re-render App/ }).click();
  await expect(panel.locator('.stream')).toContainText('6 reports');
  // commands go back through the relay: hovering highlights in the app
  await panel.locator('.row .name', { hasText: 'Toolbar' }).first().hover();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#rerender-lens-overlay > div').length)).toBeGreaterThan(0);
  await panel.close();
});
