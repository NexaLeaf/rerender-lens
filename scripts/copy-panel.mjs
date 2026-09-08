// Post-build: copies the panel page into panel/ (served by the Vite plugin and the relay) and
// concatenates the vendor parts into dist/rerender-lens.iife.js (used by `rerender-lens/playwright`).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'panel');
mkdirSync(out, { recursive: true });
for (const f of ['panel.html', 'panel.js', 'panel.css']) copyFileSync(join(root, 'extension', f), join(out, f));

const VENDOR_PARTS = ['rerender-lens.core.js', 'rerender-lens.engine.js', 'rerender-lens.js'];
const bundle = VENDOR_PARTS.map((f) => readFileSync(join(root, 'extension', 'vendor', f), 'utf8')).join('\n;\n');
writeFileSync(join(root, 'dist', 'rerender-lens.iife.js'), bundle);
console.log('panel/: panel.html, panel.js, panel.css; dist/rerender-lens.iife.js');
