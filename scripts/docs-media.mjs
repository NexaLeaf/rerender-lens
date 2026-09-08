// Captures the screenshots and the GIF used by the docs site into docs/media/ (committed).
// Needs `npm run build` and Playwright's Chromium (`npx playwright install chromium`).
// Usage: node scripts/docs-media.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'media');
mkdirSync(out, { recursive: true });
const panel = 'file://' + join(root, 'extension', 'panel.html');

const browser = await chromium.launch({ channel: 'chromium', headless: true });

async function shot(name, query, width, height, actions) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${panel}?demo${query}`);
  await page.waitForSelector('.row .name');
  await page.waitForTimeout(1600);
  if (actions) await actions(page);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}
await shot('panel-report', '', 1200, 760, (p) => p.locator('.row .name', { hasText: 'ProductRow' }).first().click());
await shot('panel-fixes-dark', '&theme=dark', 1200, 760, async (p) => {
  await p.getByRole('button', { name: 'Fixes' }).click();
  await p.locator('.fixes li').first().click();
});
await shot('panel-commits', '', 1200, 760, async (p) => {
  await p.getByRole('button', { name: 'Commits' }).click();
  await p.locator('.commits li').last().click();
});
await shot('panel-sidepanel', '', 380, 760, (p) => p.locator('.row .name', { hasText: 'ProductRow' }).first().click());

// A short GIF: tree → Fixes → snippet. Recorded as webm by Playwright, converted with its ffmpeg.
const videoDir = join(out, '.video');
rmSync(videoDir, { recursive: true, force: true });
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, recordVideo: { dir: videoDir, size: { width: 960, height: 600 } } });
const page = await ctx.newPage();
await page.goto(`${panel}?demo`);
await page.waitForSelector('.row .name');
await page.waitForTimeout(1800);
await page.locator('.row .name', { hasText: 'ProductRow' }).first().click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Fix', exact: true }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Fixes' }).click();
await page.waitForTimeout(1200);
await page.locator('.fixes li').first().click();
await page.waitForTimeout(1800);
await page.close();
await ctx.close();
await browser.close();

const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
// Playwright ships an ffmpeg build in its browser cache; use it when no system ffmpeg is on PATH.
let ffmpeg = null;
const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright'), join(process.env.HOME || '', '.cache', 'ms-playwright'), join(process.env.LOCALAPPDATA || '', 'ms-playwright')].filter(Boolean);
for (const cache of caches) {
  if (!existsSync(cache)) continue;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('ffmpeg')).sort().reverse()) {
    const bin = readdirSync(join(cache, dir)).find((f) => f.startsWith('ffmpeg'));
    if (bin) {
      ffmpeg = join(cache, dir, bin);
      break;
    }
  }
  if (ffmpeg) break;
}
try {
  execFileSync(ffmpeg || 'ffmpeg', ['-y', '-i', join(videoDir, webm), '-vf', 'fps=8,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer', '-loop', '0', join(out, 'fixes-flow.gif')], { stdio: 'ignore' });
  console.log('fixes-flow.gif written');
} catch (e) {
  console.warn('ffmpeg not available, keeping the webm instead:', e.message);
  renameSync(join(videoDir, webm), join(out, 'fixes-flow.webm'));
}
rmSync(videoDir, { recursive: true, force: true });
console.log('media:', readdirSync(out).filter((f) => existsSync(join(out, f))).join(', '));
