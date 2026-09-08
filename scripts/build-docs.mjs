// Builds the docs site (docs-site/index.html) from README.md + extension/README.md with `marked`:
// a hero with the recording, a sticky table of contents from the h2 headings, the README, the
// screenshots, and the extension README as "The extension in depth". Deployed to GitHub Pages by
// .github/workflows/pages.yml; run locally with `npm run build:docs`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs-site');
mkdirSync(join(out, 'media'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/^# .*\n\n/, '');
const extReadme = readFileSync(join(root, 'extension', 'README.md'), 'utf8').replace(/^# .*\n/, '## The extension in depth\n');

const media = existsSync(join(root, 'docs', 'media')) ? readdirSync(join(root, 'docs', 'media')).filter((f) => /\.(png|gif|webm|mp4)$/.test(f)) : [];
for (const f of media) copyFileSync(join(root, 'docs', 'media', f), join(out, 'media', f));
const video = media.find((f) => /\.(webm|mp4)$/.test(f));
const shots = media.filter((f) => /\.(png|gif)$/.test(f));

const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const toc = [];
const renderer = new marked.Renderer();
renderer.heading = (text, level) => {
  const id = slug(text);
  if (level === 2) toc.push({ id, text: text.replace(/<[^>]+>/g, '') });
  return `<h${level} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${level}>\n`;
};
marked.use({ renderer });

const caption = (f) => f.replace(/^panel-/, '').replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
const gallery = shots.length
  ? `<section class="gallery" id="screenshots">${shots.map((f) => `<figure><img src="media/${f}" alt="${caption(f)}" loading="lazy"><figcaption>${caption(f)}</figcaption></figure>`).join('')}</section>`
  : '';

const readmeHtml = marked.parse(readme);
const extHtml = marked.parse(extReadme);
const nav = toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rerender-lens · avoidable React re-renders and the fix</title>
<meta name="description" content="${pkg.description.replace(/"/g, '&quot;')}">
<style>
  :root { color-scheme: light dark; --bg: #fff; --text: #1a1d21; --dim: #66707d; --accent: #2457d6; --accent-ink: #fff; --code: #f4f6f8; --border: #e4e7ec; --hero: linear-gradient(135deg, #0b1220, #1c2a4a); }
  @media (prefers-color-scheme: dark) { :root { --bg: #131417; --text: #e8eaee; --dim: #9aa3b0; --accent: #85a8ff; --accent-ink: #0b1220; --code: #1d1f24; --border: #2b2e35; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .hero { background: var(--hero); color: #fff; padding: 56px 20px 40px; }
  .hero .inner { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 40px; align-items: center; }
  .hero h1 { font-size: 2.6rem; margin: 0 0 .3em; letter-spacing: -.02em; line-height: 1.05; }
  .hero p { font-size: 1.15rem; margin: 0 0 1.2em; opacity: .92; max-width: 34em; }
  .hero .cta a { display: inline-block; margin: 0 10px 10px 0; padding: 10px 16px; border-radius: 8px; font-weight: 600; background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.2); }
  .hero .cta a.primary { background: #fff; color: #0b1220; border-color: #fff; }
  .hero .cta a:hover { text-decoration: none; filter: brightness(1.08); }
  .hero video, .hero img { width: 100%; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  .hero .version { font-size: 13px; opacity: .7; margin-top: 6px; }
  .layout { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 48px; padding: 32px 20px 96px; }
  .toc { position: sticky; top: 24px; align-self: start; font-size: 14px; display: flex; flex-direction: column; gap: 2px; }
  .toc a { color: var(--dim); padding: 4px 10px; border-left: 2px solid transparent; border-radius: 0 6px 6px 0; }
  .toc a:hover, .toc a.active { color: var(--text); border-left-color: var(--accent); background: var(--code); text-decoration: none; }
  .toc .links { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border); }
  main { min-width: 0; }
  main > pre:first-child { margin-top: 0; }
  h2 { font-size: 1.55rem; margin: 2.4em 0 .6em; letter-spacing: -.01em; scroll-margin-top: 24px; } h2:first-of-type { margin-top: 0; }
  h3 { font-size: 1.1rem; margin: 1.8em 0 .5em; scroll-margin-top: 24px; }
  h2 .anchor, h3 .anchor { color: inherit; } h2 .anchor:hover, h3 .anchor:hover { text-decoration: none; }
  h2 .anchor:hover::after, h3 .anchor:hover::after { content: " #"; color: var(--dim); font-weight: 400; }
  p, li { max-width: 72ch; }
  pre { background: var(--code); border: 1px solid var(--border); padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.55; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
  :not(pre) > code { background: var(--code); padding: 1px 5px; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 1em 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; } th { background: var(--code); }
  td:first-child code { white-space: nowrap; }
  strong { font-weight: 650; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin: 2.4em 0; }
  .gallery figure { margin: 0; } .gallery img { width: 100%; border: 1px solid var(--border); border-radius: 8px; }
  figcaption { color: var(--dim); font-size: 13px; text-align: center; margin-top: 4px; }
  footer { max-width: 1080px; margin: 0 auto; padding: 0 20px 48px; color: var(--dim); font-size: 13px; }
  @media (max-width: 860px) {
    .hero .inner { grid-template-columns: 1fr; gap: 24px; } .hero h1 { font-size: 2rem; }
    .layout { grid-template-columns: 1fr; gap: 16px; } .toc { position: static; flex-direction: row; flex-wrap: wrap; } .toc .links { border: 0; margin: 0; padding: 0; }
  }
</style>
</head>
<body>
<header class="hero">
  <div class="inner">
    <div>
      <h1>rerender-lens</h1>
      <p>See which React components re-rendered for nothing, which prop, state or context caused it, and the fix. A DevTools panel, a Vite plugin, a relay panel for any app, and test integrations.</p>
      <div class="cta">
        <a class="primary" href="https://github.com/NexaLeaf/rerender-lens/releases">Get the extension</a>
        <a href="https://www.npmjs.com/package/rerender-lens">npm i -D rerender-lens</a>
        <a href="https://github.com/NexaLeaf/rerender-lens">GitHub</a>
      </div>
      <div class="version">v${pkg.version} · MIT · Chrome, Edge, Firefox · React 18 and 19</div>
    </div>
    ${video ? `<video src="media/${video}" autoplay loop muted playsinline></video>` : shots[0] ? `<img src="media/${shots[0]}" alt="">` : ''}
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="Contents">${nav}<a href="#screenshots">Screenshots</a><div class="links"><a href="https://github.com/NexaLeaf/rerender-lens/blob/main/CHANGELOG.md">Changelog</a><a href="https://github.com/NexaLeaf/rerender-lens/issues">Issues</a></div></nav>
  <main>
${readmeHtml}
${gallery}
${extHtml}
  </main>
</div>
<footer>rerender-lens ${pkg.version}. Everything runs locally; nothing is sent anywhere.</footer>
<script>
  const links = [...document.querySelectorAll('.toc a[href^="#"]')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
    const first = [...byId.keys()].find((id) => seen.has(id));
    links.forEach((a) => a.classList.toggle('active', first !== undefined && a === byId.get(first)));
  }, { rootMargin: '-10% 0px -70% 0px' });
  for (const id of byId.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
</script>
</body>
</html>
`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '.nojekyll'), '');
console.log(`docs-site/index.html (${(html.length / 1024).toFixed(0)} KB, ${media.length} media files, ${toc.length} sections)`);
