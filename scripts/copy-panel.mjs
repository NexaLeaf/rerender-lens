// Post-build: copies the panel page into panel/ (served by the Vite plugin and the relay) and the
// injectable IIFE bundle into dist/ (used by `rerender-lens/playwright`).
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'panel');
mkdirSync(out, { recursive: true });
for (const f of ['panel.html', 'panel.js', 'panel.css']) copyFileSync(join(root, 'extension', f), join(out, f));
copyFileSync(join(root, 'extension', 'vendor', 'rerender-lens.js'), join(root, 'dist', 'rerender-lens.iife.js'));
console.log('panel/: panel.html, panel.js, panel.css; dist/rerender-lens.iife.js');
