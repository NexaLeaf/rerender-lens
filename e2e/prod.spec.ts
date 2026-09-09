import { expect, test } from '@playwright/test';
import { installRerenderLens } from '../src/playwright';

const RELAY = 'http://127.0.0.1:4143';

interface Report {
  component: string;
  avoidable: boolean;
}

/**
 * A minified production build is where a lot of real investigation happens, and where the tool used
 * to be nearly useless: React is production, so names are whatever the minifier chose. This drives
 * the whole path — inject into the built app, report, then have the panel map the names back
 * through the bundle's source map.
 */
test('a minified production build reports minified names, and the panel resolves them', async ({ page, context }) => {
  await installRerenderLens(page, { trackAllComponents: true, relay: RELAY });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'rerender-lens example' })).toBeVisible();

  const info = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.info());
  expect(info.production, 'the example must be built for production').toBe(true);
  expect(info.scripts.some((s: string) => /assets\/.*\.js/.test(s)), 'the page must expose its bundle').toBe(true);

  await page.getByRole('button', { name: /Re-render App/ }).click();
  await page.getByRole('button', { name: /Re-render App/ }).click();
  const pulled = await page.evaluate(() => window.__RERENDER_LENS_DEVTOOLS__!.pull(0));
  const names = [...new Set((pulled.reports as Report[]).map((r) => r.component))];
  expect(names.length).toBeGreaterThan(0);
  // The point of the test: without resolution these are the minifier's names, not the source's.
  // `Toolbar` and `ProductList` keep theirs through `displayName`; the plain ones do not.
  expect(names, `got ${names.join(', ')}`).not.toContain('Row');

  // The panel: the production banner offers to resolve, and the names come back.
  const panel = await context.newPage();
  await panel.goto(`${RELAY}/`);
  await expect(panel.locator('.status-text')).toHaveText(/connected · lib 0\.\d+\.\d+/);
  await expect(panel.locator('.banner')).toContainText('Production React build');
  await panel.getByRole('button', { name: /Resolve names/ }).click();
  await expect(panel.locator('.banner')).toContainText(/\d+ of \d+ names resolved/, { timeout: 30_000 });
  // `Row` is a plain function component in src/Row.tsx: its identifier survives in the bundle, so
  // the source map can name it. (Tree rows read `<Row>`.)
  const treeNames = async (): Promise<string[]> => panel.locator('.row .name').allTextContents();
  await expect.poll(treeNames, { timeout: 15_000 }).toContain('Row');
  await expect(panel.locator('.row .name', { hasText: /^Row$/ }).first()).toHaveAttribute('title', /minified as/);
  // `App` too: both are plain function components, so both keep an identifier in the bundle.
  await expect.poll(treeNames).toContain('App');
  await panel.close();
});
