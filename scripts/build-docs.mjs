// Builds the docs site (docs-site/index.html) from README.md + extension/README.md with `marked`.
// Deployed to GitHub Pages by .github/workflows/pages.yml; run locally with `npm run build:docs`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs-site');
mkdirSync(join(out, 'media'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const extReadme = readFileSync(join(root, 'extension', 'README.md'), 'utf8').replace(/^# .*\n/, '## The DevTools extension in depth\n');

const media = existsSync(join(root, 'docs', 'media')) ? readdirSync(join(root, 'docs', 'media')).filter((f) => /\.(png|gif|webm|mp4)$/.test(f)) : [];
for (const f of media) copyFileSync(join(root, 'docs', 'media', f), join(out, 'media', f));

const caption = (f) => f.replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
const figure = (f) =>
  /\.(webm|mp4)$/.test(f)
    ? `<figure class="wide"><video src="media/${f}" autoplay loop muted playsinline></video><figcaption>${caption(f)}</figcaption></figure>`
    : `<figure><img src="media/${f}" alt="${caption(f)}" loading="lazy"><figcaption>${caption(f)}</figcaption></figure>`;
const gallery = media.length ? `<section class="gallery">${media.map(figure).join('')}</section>` : '';

const body = marked.parse(readme) + gallery + marked.parse(extReadme);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rerender-lens ${pkg.version}: find avoidable React re-renders and the fix</title>
<meta name="description" content="${pkg.description.replace(/"/g, '&quot;')}">
<style>
  :root { color-scheme: light dark; --bg: #fff; --text: #1f2328; --dim: #6b7280; --accent: #2563eb; --code: #f6f7f9; --border: #e2e5ea; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1e1f22; --text: #e6e7ea; --dim: #9da3ad; --accent: #7aa7f7; --code: #26272b; --border: #33353b; } }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 2.2rem; margin: 0 0 .3em; } h2 { margin-top: 2.2em; border-bottom: 1px solid var(--border); padding-bottom: .2em; } h3 { margin-top: 1.6em; }
  pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.5; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
  :not(pre) > code { background: var(--code); padding: 1px 5px; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; } th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; } th { background: var(--code); }
  a { color: var(--accent); }
  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 2em 0; }
  .gallery figure { margin: 0; } .gallery figure.wide { grid-column: 1 / -1; } .gallery img, .gallery video { width: 100%; border: 1px solid var(--border); border-radius: 8px; } figcaption { color: var(--dim); font-size: 13px; text-align: center; margin-top: 4px; }
  nav { font-size: 14px; color: var(--dim); margin-bottom: 24px; } nav a { margin-right: 14px; }
</style>
</head>
<body>
<main>
<nav><a href="https://github.com/NexaLeaf/rerender-lens">GitHub</a><a href="https://www.npmjs.com/package/rerender-lens">npm</a><a href="https://github.com/NexaLeaf/rerender-lens/releases">Releases (extension zips)</a><span>v${pkg.version}</span></nav>
${body}
</main>
</body>
</html>
`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '.nojekyll'), '');
console.log(`docs-site/index.html (${(html.length / 1024).toFixed(0)} KB, ${media.length} media files)`);
