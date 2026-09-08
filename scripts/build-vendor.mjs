// Builds the injectable library as three classic scripts in extension/vendor/ (loaded in this
// order by the extension's MAIN-world content script registration, see background.js):
//
//   rerender-lens.core.js    types, version, diff, report, state, overlay   (no dependencies)
//   rerender-lens.engine.js  fiber, tracker, hookNames                       (the commit walker)
//   rerender-lens.js         devtools bridge, notifiers, fixes/budget/sessions -> window.RerenderLens
//
// Each part publishes its modules on `globalThis.__RERENDER_LENS_PARTS__`; a later part imports an
// earlier module through that object instead of bundling a second copy. Splitting keeps every
// file readable and reviewable (a store reviewer opens 300-line files, not one 70 KB blob).
// `scripts/copy-panel.mjs` concatenates the three into dist/rerender-lens.iife.js for
// `rerender-lens/playwright`.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension', 'vendor');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const PARTS_GLOBAL = '__RERENDER_LENS_PARTS__';

export const PARTS = [
  { file: 'rerender-lens.core.js', modules: ['types', 'version', 'diff', 'report', 'state', 'overlay'] },
  { file: 'rerender-lens.engine.js', modules: ['fiber', 'tracker', 'hookNames'] },
  { file: 'rerender-lens.js', entry: 'src/inject.ts', globalName: 'RerenderLens' },
];

/** Imports of modules that an earlier part already published resolve to that global. */
function sharedModules(partIndex) {
  const plugin = {
    name: 'rerender-lens-parts',
    setup(api) {
      const earlier = new Set(PARTS.slice(0, partIndex).flatMap((p) => p.modules ?? []));
      api.onResolve({ filter: /^\.\/[A-Za-z]+$/ }, (args) => {
        const name = basename(args.path);
        if (!earlier.has(name) || !args.importer.startsWith(join(root, 'src'))) return null;
        return { path: name, namespace: 'rerender-lens-part' };
      });
      api.onLoad({ filter: /.*/, namespace: 'rerender-lens-part' }, (args) => ({
        loader: 'js',
        contents: `var p = globalThis.${PARTS_GLOBAL}; if (!p || !p[${JSON.stringify(args.path)}]) throw new Error('rerender-lens: load vendor/rerender-lens.core.js and vendor/rerender-lens.engine.js before vendor/rerender-lens.js'); module.exports = p[${JSON.stringify(args.path)}];`,
      }));
    },
  };
  return plugin;
}

function partEntry(part) {
  const imports = part.modules.map((m, i) => `import * as m${i} from './src/${m}';`).join('\n');
  const publish = part.modules.map((m, i) => `parts[${JSON.stringify(m)}] = m${i};`).join('\n');
  return `${imports}\nconst parts = (globalThis.${PARTS_GLOBAL} = globalThis.${PARTS_GLOBAL} || {});\n${publish}\n`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [index, part] of PARTS.entries()) {
  const common = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    treeShaking: true,
    define: { __RERENDER_LENS_VERSION__: JSON.stringify(version) },
    plugins: [sharedModules(index)],
    banner: { js: `/* rerender-lens ${version} — ${part.file}: ${part.modules ? part.modules.join(', ') : 'devtools bridge + notifiers (window.RerenderLens)'}. Built by scripts/build-vendor.mjs; do not edit. */` },
    write: false,
    logLevel: 'silent',
  };
  const result = part.entry
    ? await build({ ...common, entryPoints: [join(root, part.entry)], globalName: part.globalName, footer: { js: `globalThis.${part.globalName} = ${part.globalName};` } })
    : await build({ ...common, stdin: { contents: partEntry(part), resolveDir: root, loader: 'ts', sourcefile: `vendor-${part.file}` } });
  const code = result.outputFiles[0].text;
  writeFileSync(join(out, part.file), code);
  console.log(`extension/vendor/${part.file}: ${(code.length / 1024).toFixed(1)} KB`);
}
