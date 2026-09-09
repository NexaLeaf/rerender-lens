// Builds the docs site into docs-site/: a landing page that answers "how do I start with my
// bundler", the README as the guide, the extension README, an API reference read from the sources
// (scripts/docs-api.mjs), and a hosted copy of the panel's demo mode. Deployed to GitHub Pages by
// .github/workflows/pages.yml; run locally with `npm run build:docs`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';
import { buildApi } from './docs-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs-site');
mkdirSync(join(out, 'media'), { recursive: true });
mkdirSync(join(out, 'demo'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const extReadme = readFileSync(join(root, 'extension', 'README.md'), 'utf8');
const REPO = 'https://github.com/NexaLeaf/rerender-lens';

// ---------- media and the hosted demo ----------
const media = existsSync(join(root, 'docs', 'media')) ? readdirSync(join(root, 'docs', 'media')).filter((f) => /\.(png|gif|webm|mp4)$/.test(f)) : [];
for (const f of media) copyFileSync(join(root, 'docs', 'media', f), join(out, 'media', f));
const video = media.find((f) => /\.(webm|mp4)$/.test(f));
const shots = media.filter((f) => /\.(png|gif)$/.test(f));
for (const f of ['panel.html', 'panel.js', 'panel.css']) copyFileSync(join(root, 'extension', f), join(out, 'demo', f));

// ---------- helpers ----------
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Markdown -> HTML, collecting the `##` headings for the page's table of contents. */
function render(markdown) {
  const toc = [];
  const renderer = new marked.Renderer();
  renderer.heading = (text, level) => {
    const id = slug(text);
    if (level === 2) toc.push({ id, text: text.replace(/<[^>]+>/g, '') });
    return `<h${level} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${level}>\n`;
  };
  return { html: marked.parse(markdown, { renderer }), toc };
}

/** The first fenced block under a `## heading` in the README, so the landing page cannot drift from it. */
function snippet(headingText) {
  const start = readme.indexOf(`\n## ${headingText}\n`);
  if (start < 0) throw new Error(`build-docs: no "## ${headingText}" in README.md`);
  const fence = readme.indexOf('```', start);
  const end = readme.indexOf('```', fence + 3);
  if (fence < 0 || end < 0) throw new Error(`build-docs: no code block under "## ${headingText}"`);
  const body = readme.slice(readme.indexOf('\n', fence) + 1, end).trimEnd();
  return escape(body);
}

const NAV = [
  ['index.html', 'Home'],
  ['guide.html', 'Guide'],
  ['extension.html', 'Extension'],
  ['api.html', 'API'],
  ['demo/panel.html?demo', 'Demo'],
];

function page({ file, title, description, body, toc = [], hero = '' }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href.split('?')[0] === file ? ' class="here"' : ''}>${label}</a>`).join('');
  const aside = toc.length ? `<nav class="toc" aria-label="On this page">${toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('')}</nav>` : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description.replace(/"/g, '&quot;')}">
<link rel="stylesheet" href="site.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.html">rerender&#8209;lens</a>
  <nav class="links">${nav}</nav>
  <a class="ghlink" href="${REPO}">GitHub</a>
</header>
${hero}
<div class="layout${aside ? '' : ' wide'}">
${aside}
<main>
${body}
</main>
</div>
<footer>rerender-lens ${pkg.version} · MIT · everything runs locally, nothing is sent anywhere · <a href="${REPO}">GitHub</a> · <a href="https://www.npmjs.com/package/rerender-lens">npm</a> · <a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a></footer>
${toc.length ? '<script src="toc.js"></script>' : ''}
</body>
</html>
`;
  writeFileSync(join(out, file), html);
}

// ---------- landing ----------
const STARTS = [
  { id: 'vite', label: 'Vite', code: snippet('Vite'), note: 'Dev only. Add <code>panel: true</code> and the panel is served at <code>/__rerender-lens/</code>, no extension needed.' },
  { id: 'next', label: 'Next.js', code: `// instrumentation-client.ts\nimport 'rerender-lens/setup';`, note: 'Runs before your client code. Point it at a panel with <code>NEXT_PUBLIC_RERENDER_LENS_RELAY</code>.' },
  { id: 'webpack', label: 'Webpack', code: `// webpack.config.js\nentry: ['rerender-lens/setup', './src/index.tsx'],`, note: 'Anything that takes an entry array: Webpack, Rspack, Parcel with a first import.' },
  { id: 'any', label: 'Any app', code: `npx rerender-lens panel      # prints a URL: open it in any browser\nRERENDER_LENS_RELAY=http://127.0.0.1:4141 npm run dev`, note: 'A relay serves the panel and forwards messages, so no extension and no bundler plugin. Several apps can share one.' },
  { id: 'extension', label: 'No code at all', code: `# chrome://extensions -> Developer mode -> Load unpacked\n# pick the unzipped rerender-lens-chrome-<version>.zip\n# then: DevTools -> Re-renders -> Inject the library`, note: 'The extension loads the library before React on the origins you enable.' },
  { id: 'tests', label: 'Tests', code: snippet('Tests and CI'), note: 'Vitest, Jest and Playwright integrations, plus a CLI that fails CI on a budget.' },
];

const hero = `<section class="hero">
  <div class="inner">
    <div>
      <h1>Find the re-renders that did nothing</h1>
      <p class="sub">rerender-lens tells you which React components re-rendered for no reason, which prop, state or context caused it, which ancestor started the cascade, and the fix.</p>
      <div class="cta">
        <a class="primary" href="#start">Start in 60 seconds</a>
        <a href="demo/panel.html?demo">Try the panel</a>
        <a href="${REPO}/releases">Get the extension</a>
      </div>
      <p class="meta">v${pkg.version} · MIT · Chrome, Edge, Firefox · React 17, 18 and 19 · no telemetry</p>
    </div>
    ${video ? `<video src="media/${video}" autoplay loop muted playsinline aria-label="The panel: picking a component, reading why it re-rendered, copying the fix"></video>` : shots[0] ? `<img src="media/${shots[0]}" alt="">` : ''}
  </div>
</section>`;

const landing = `
<section class="console">
<pre><code>${escape(`▸ [rerender-lens] <ProductRow> avoidable re-render: 1 equal by value, 1 new function
    - caused by <ProductPage> re-rendering (its state changed).
    - prop "style" is a new reference but deep-equal to the previous value: memoize it with useMemo, or hoist it.
    - prop "onSelect" is a new function instance on every render: wrap it in useCallback.
    at App > ProductPage > ProductRow`)}</code></pre>
</section>

<h2 id="start">Start in 60 seconds</h2>
<p>Pick how your app is built. Every path gives you the same reports; the panel is optional.</p>
<div class="tabs" data-tabs>
  <div class="tablist" role="tablist" aria-label="Setup per bundler">
    ${STARTS.map((s, i) => `<button role="tab" id="tab-${s.id}" aria-controls="panel-${s.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${s.label}</button>`).join('')}
  </div>
  ${STARTS.map((s, i) => `<div class="tabpanel" role="tabpanel" id="panel-${s.id}" aria-labelledby="tab-${s.id}"${i === 0 ? '' : ' hidden'}><pre><code>${s.code}</code></pre><p class="note">${s.note}</p></div>`).join('')}
</div>
<p>Then open the console, or the <strong>Re-renders</strong> panel. Full instructions in the <a href="guide.html">guide</a>.</p>

<h2 id="what-you-get">What you get</h2>
<div class="cards">
  <div class="card"><h3>Why it rendered</h3><p>The prop, state, context or store value that was a new reference with the same contents, the ancestor that started the cascade, and a snippet with the fix.</p></div>
  <div class="card"><h3>Ranked fixes</h3><p>Every suggested fix ordered by how many re-renders it removes, so you fix the one that pays. The same ranking in the CLI and your test runner.</p></div>
  <div class="card"><h3>Commits and root causes</h3><p>A timeline of React commits: brush a range to see what happened while you typed, and read which component started each cascade.</p></div>
  <div class="card"><h3>CI that holds the line</h3><p>A budget file per component. Vitest, Jest and Playwright fail the run when a new avoidable re-render appears.</p></div>
</div>

${shots.length ? `<h2 id="screenshots">The panel</h2><section class="gallery">${shots.map((f) => `<figure><a href="media/${f}"><img src="media/${f}" alt="${f.replace(/^panel-|\.\w+$/g, '').replace(/-/g, ' ')}" loading="lazy"></a><figcaption>${f.replace(/^panel-|\.\w+$/g, '').replace(/-/g, ' ')}</figcaption></figure>`).join('')}</section>` : ''}

<h2 id="how">How it works</h2>
<p>It reads the fiber tree after each commit through the same global hook React DevTools uses. Nothing in React is patched, so Fast Refresh, <code>React.memo</code>, <code>forwardRef</code>, class components and every bundler keep working. Work per commit is bounded, so a large app stays responsive. It is a development tool: keep it out of production builds.</p>
<p><a href="guide.html#what-counts-as-avoidable">What counts as avoidable</a> spells out the verdict for React Compiler output, <code>use()</code>, transitions, Suspense, store selectors and render props.</p>
`;

page({
  file: 'index.html',
  title: 'rerender-lens · find avoidable React re-renders and the fix',
  description: pkg.description,
  body: landing,
  hero,
});

// ---------- guide, extension, api ----------
const guide = render(readme.replace(/^# .*\n\n/, ''));
page({ file: 'guide.html', title: 'Guide · rerender-lens', description: 'Setup for every bundler, what a report contains, options, the API and the CLI.', body: guide.html, toc: guide.toc });

const ext = render(extReadme.replace(/^# .*\n/, '## The DevTools extension\n'));
page({ file: 'extension.html', title: 'The extension · rerender-lens', description: 'The Re-renders panel: views, keyboard, the side panel, how it talks to the page, packaging.', body: ext.html, toc: ext.toc });

const api = buildApi();
const apiBody =
  `<h1>API reference</h1><p class="lede">Generated from the sources of ${pkg.name} ${pkg.version}. Every public entry point and what it exports.</p>` +
  api
    .map((entry) => {
      const id = slug(entry.specifier);
      const body = entry.sideEffect
        ? `<p class="note">Importing it is the whole API: <code>import '${entry.specifier}';</code></p>`
        : `<table class="api"><thead><tr><th>Export</th><th>Signature</th></tr></thead><tbody>${entry.items
            .map(
              (i) =>
                `<tr id="${id}-${slug(i.name)}"><td><code class="name">${i.name}</code><span class="kind">${i.kind}</span></td><td><pre><code>${escape(i.signature)}</code></pre>${i.doc ? `<p class="doc">${escape(i.doc)}</p>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table>`;
      return `<h2 id="${id}"><a class="anchor" href="#${id}"><code>${entry.specifier}</code></a></h2><p>${entry.blurb}</p>${body}`;
    })
    .join('');
page({
  file: 'api.html',
  title: 'API · rerender-lens',
  description: 'Every export of rerender-lens and its entry points, generated from the sources.',
  body: apiBody,
  toc: api.map((e) => ({ id: slug(e.specifier), text: e.specifier })),
});

// ---------- assets ----------
writeFileSync(
  join(out, 'site.css'),
  `:root { color-scheme: light dark; --bg:#fff; --panel:#fff; --text:#1a1d21; --dim:#66707d; --accent:#2457d6; --code:#f4f6f8; --border:#e4e7ec; --hero:linear-gradient(135deg,#0b1220,#1c2a4a); }
@media (prefers-color-scheme: dark) { :root { --bg:#131417; --panel:#191b1f; --text:#e8eaee; --dim:#9aa3b0; --accent:#85a8ff; --code:#1d1f24; --border:#2b2e35; } }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--text); background:var(--bg); }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.92em; }
:not(pre) > code { background:var(--code); padding:1px 5px; border-radius:4px; }
pre { background:var(--code); border:1px solid var(--border); padding:12px 14px; border-radius:8px; overflow:auto; font-size:13px; line-height:1.55; }
h1 { font-size:2rem; letter-spacing:-.02em; margin:0 0 .4em; }
h2 { font-size:1.5rem; letter-spacing:-.01em; margin:2.4em 0 .6em; scroll-margin-top:70px; }
h3 { font-size:1.05rem; margin:1.8em 0 .5em; scroll-margin-top:70px; }
h2 .anchor, h3 .anchor { color:inherit; } h2 .anchor:hover::after, h3 .anchor:hover::after { content:" #"; color:var(--dim); font-weight:400; }
p, li { max-width:72ch; }
table { border-collapse:collapse; width:100%; font-size:14px; margin:1em 0; display:block; overflow-x:auto; }
th, td { border:1px solid var(--border); padding:7px 10px; text-align:left; vertical-align:top; } th { background:var(--code); }
.topbar { position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:18px; padding:10px 20px; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--border); }
.topbar .brand { font-weight:700; letter-spacing:-.01em; color:var(--text); }
.topbar .links { display:flex; gap:14px; font-size:14px; flex-wrap:wrap; }
.topbar .links a { color:var(--dim); } .topbar .links a.here, .topbar .links a:hover { color:var(--text); }
.topbar .ghlink { margin-left:auto; font-size:14px; }
.hero { background:var(--hero); color:#fff; padding:56px 20px 44px; }
.hero .inner { max-width:1080px; margin:0 auto; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); gap:40px; align-items:center; }
.hero h1 { font-size:2.6rem; line-height:1.06; }
.hero .sub { font-size:1.12rem; opacity:.92; max-width:34em; }
.hero .cta { margin:1.2em 0 .6em; }
.hero .cta a { display:inline-block; margin:0 10px 10px 0; padding:10px 16px; border-radius:8px; font-weight:600; background:rgba(255,255,255,.12); color:#fff; border:1px solid rgba(255,255,255,.2); }
.hero .cta a.primary { background:#fff; color:#0b1220; border-color:#fff; }
.hero .cta a:hover { text-decoration:none; filter:brightness(1.08); }
.hero .meta { font-size:13px; opacity:.7; }
.hero video, .hero img { width:100%; border-radius:10px; box-shadow:0 20px 60px rgba(0,0,0,.45); }
.layout { max-width:1080px; margin:0 auto; display:grid; grid-template-columns:210px minmax(0,1fr); gap:48px; padding:32px 20px 90px; }
.layout.wide { grid-template-columns:minmax(0,1fr); max-width:900px; }
.toc { position:sticky; top:64px; align-self:start; font-size:14px; display:flex; flex-direction:column; gap:2px; }
.toc a { color:var(--dim); padding:4px 10px; border-left:2px solid transparent; border-radius:0 6px 6px 0; }
.toc a:hover, .toc a.active { color:var(--text); border-left-color:var(--accent); background:var(--code); text-decoration:none; }
main { min-width:0; }
.console pre { margin:0 0 2em; }
.tabs .tablist { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:10px; }
.tabs .tablist button { font:inherit; font-size:14px; padding:6px 12px; border-radius:999px; border:1px solid var(--border); background:var(--panel); color:var(--dim); cursor:pointer; }
.tabs .tablist button[aria-selected="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
.tabpanel .note { color:var(--dim); font-size:14px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; }
.card { border:1px solid var(--border); border-radius:10px; padding:14px 16px; background:var(--panel); }
.card h3 { margin:0 0 .3em; font-size:1rem; }
.card p { margin:0; color:var(--dim); font-size:14px; max-width:none; }
.gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
.gallery figure { margin:0; } .gallery img { width:100%; border:1px solid var(--border); border-radius:8px; }
figcaption { color:var(--dim); font-size:13px; text-align:center; margin-top:4px; }
.lede { color:var(--dim); }
table.api { display:table; table-layout:fixed; }
table.api td:first-child { white-space:nowrap; width:14em; }
table.api pre { margin:0; background:transparent; border:0; padding:0; white-space:pre-wrap; overflow-wrap:anywhere; }
table.api .name { font-weight:600; } table.api .kind { display:block; color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
table.api .doc { margin:6px 0 0; color:var(--dim); font-size:13px; max-width:none; }
footer { max-width:1080px; margin:0 auto; padding:0 20px 48px; color:var(--dim); font-size:13px; }
@media (max-width:860px) {
  .hero .inner { grid-template-columns:1fr; gap:24px; } .hero h1 { font-size:2rem; }
  .layout { grid-template-columns:1fr; gap:16px; } .toc { position:static; flex-direction:row; flex-wrap:wrap; }
}
`,
);

writeFileSync(
  join(out, 'toc.js'),
  `// Highlights the section you are reading in the sidebar.
const links = [...document.querySelectorAll('.toc a[href^="#"]')];
const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
const seen = new Set();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
  const first = [...byId.keys()].find((id) => seen.has(id));
  links.forEach((a) => a.classList.toggle('active', first !== undefined && a === byId.get(first)));
}, { rootMargin: '-10% 0px -70% 0px' });
for (const id of byId.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
`,
);

// The landing page's setup tabs (inline: one small behaviour, no build step).
const indexPath = join(out, 'index.html');
writeFileSync(
  indexPath,
  readFileSync(indexPath, 'utf8').replace(
    '</body>',
    `<script>
for (const tabs of document.querySelectorAll('[data-tabs]')) {
  const buttons = [...tabs.querySelectorAll('[role=tab]')];
  const show = (btn) => {
    for (const b of buttons) {
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.getAttribute('aria-controls')).hidden = !on;
    }
    btn.focus();
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) show(b); });
  tabs.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight') show(buttons[(i + 1) % buttons.length]);
    if (e.key === 'ArrowLeft') show(buttons[(i - 1 + buttons.length) % buttons.length]);
  });
}
</script>
</body>`,
  ),
);

writeFileSync(join(out, '.nojekyll'), '');
const pages = ['index.html', 'guide.html', 'extension.html', 'api.html'];
const total = pages.reduce((n, f) => n + readFileSync(join(out, f), 'utf8').length, 0);
console.log(`docs-site: ${pages.join(', ')} (${(total / 1024).toFixed(0)} KB), demo/, ${media.length} media files, ${api.reduce((n, e) => n + e.items.length, 0)} API entries`);
