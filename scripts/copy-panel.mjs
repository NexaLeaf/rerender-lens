// Copies the panel page into panel/ so the npm package can serve it (Vite plugin `panel: true`).
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'panel');
mkdirSync(out, { recursive: true });
for (const f of ['panel.html', 'panel.js', 'panel.css']) copyFileSync(join(root, 'extension', f), join(out, f));
console.log('panel/: panel.html, panel.js, panel.css');
