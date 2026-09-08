// Web Store assets into extension/store/media/ (committed): five 1280x800 screenshots of the panel
// with its demo data, a 440x280 small promo tile and a 1400x560 marquee. Needs `npm run build`
// (panel.js) and Playwright's Chromium (`npx playwright install chromium`).
// Usage: node scripts/store-media.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension', 'store', 'media');
mkdirSync(out, { recursive: true });
const panel = 'file://' + join(root, 'extension', 'panel.html');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const browser = await chromium.launch({ channel: 'chromium', headless: true });

async function shot(name, query, actions) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(`${panel}?demo${query}`);
  await page.waitForSelector('.row .name');
  await page.waitForTimeout(1600);
  if (actions) await actions(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}

await shot('1-report', '', (p) => p.locator('.row .name', { hasText: 'ProductRow' }).first().click());
await shot('2-offenders', '', async (p) => {
  await p.getByRole('button', { name: 'Offenders' }).click();
  await p.locator('table.grid tbody tr').first().click();
});
await shot('3-commits', '', async (p) => {
  await p.getByRole('button', { name: 'Commits' }).click();
  await p.locator('.commits li').last().click();
});
await shot('4-fixes-dark', '&theme=dark', async (p) => {
  await p.getByRole('button', { name: 'Fixes' }).click();
  await p.locator('.fixes li').first().click();
});
await shot('5-sessions', '', (p) => p.getByRole('button', { name: 'Sessions' }).click());

// Promo images: the icon, the name and the one-line pitch on a plain background (the store shows
// them small; text that reads at 440 px wins over a screenshot that does not).
const icon = readFileSync(join(root, 'extension', 'icons', 'icon128.png')).toString('base64');
const promo = (w, h, iconPx, titlePx, textPx) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${Math.round(iconPx / 3)}px;background:linear-gradient(135deg,#0b1220,#1c2a4a);color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
  <img src="data:image/png;base64,${icon}" width="${iconPx}" height="${iconPx}" style="border-radius:${Math.round(iconPx / 5)}px;box-shadow:0 8px 30px rgba(0,0,0,.4)">
  <div style="max-width:${Math.round(w * 0.6)}px">
    <div style="font-size:${titlePx}px;font-weight:700;letter-spacing:-0.02em;line-height:1.05">rerender-lens</div>
    <div style="font-size:${textPx}px;opacity:.9;margin-top:${Math.round(textPx * 0.5)}px;line-height:1.3">Avoidable React re-renders, the prop that caused each one, and the fix. A DevTools panel.</div>
  </div>
</body></html>`;
for (const [name, w, h, i, t, s] of [
  ['promo-small-440x280', 440, 280, 96, 34, 15],
  ['promo-marquee-1400x560', 1400, 560, 220, 84, 34],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(promo(w, h, i, t, s));
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
}
await browser.close();
console.log(`store media ${version}: 1-report, 2-offenders, 3-commits, 4-fixes-dark, 5-sessions (1280x800), promo-small-440x280, promo-marquee-1400x560 -> extension/store/media/`);
