// Packages extension/ into dist-extension/{chrome,firefox,edge}/ (unpacked) and matching .zip files.
// Requires `npm run build` first (it produces extension/vendor/rerender-lens.js).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { zip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension');
const out = join(root, 'dist-extension');

// Keep manifest.json in sync with package.json.
await import('./sync-version.mjs');

if (!existsSync(join(src, 'vendor', 'rerender-lens.js'))) {
  console.error('extension/vendor/rerender-lens.js is missing: run `npm run build` first.');
  process.exit(1);
}

const EXCLUDE = new Set(['test', 'README.md', 'store', '.DS_Store']);

function listFiles(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...listFiles(p, base));
    else files.push(relative(base, p));
  }
  return files.sort();
}

const base = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));

const targets = {
  chrome: (m) => m,
  edge: (m) => m,
  firefox: (m) => {
    const f = { ...m };
    delete f.minimum_chrome_version;
    // Firefox MV3 runs the background as an event page, not a service worker.
    f.background = { scripts: ['shared.js', 'background.js'] };
    f.browser_specific_settings = { gecko: { id: 'rerender-lens@nexaleaf.dev', strict_min_version: '128.0' } };
    // Chrome's side panel becomes Firefox's sidebar (same page; it follows the active tab).
    delete f.side_panel;
    f.permissions = (f.permissions || []).filter((p) => p !== 'sidePanel');
    f.sidebar_action = { default_panel: 'sidepanel.html', default_title: 'rerender-lens', default_icon: f.icons };
    return f;
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = listFiles(src);
for (const [name, transform] of Object.entries(targets)) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const rel of files) {
    const from = join(src, rel);
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    let data;
    if (rel === 'manifest.json') data = Buffer.from(JSON.stringify(transform(base), null, 2) + '\n');
    else data = readFileSync(from);
    writeFileSync(to, data);
    entries.push({ name: rel, data, mtime: statSync(from).mtime });
  }
  const archive = zip(entries);
  writeFileSync(join(out, `rerender-lens-${name}-${base.version}.zip`), archive);
  console.log(`${name}: ${entries.length} files, ${(archive.length / 1024).toFixed(1)} KB -> dist-extension/rerender-lens-${name}-${base.version}.zip`);
}

// Convenience copies without the version for CI artifacts.
for (const name of Object.keys(targets)) {
  cpSync(join(out, `rerender-lens-${name}-${base.version}.zip`), join(out, `${name}.zip`));
}
