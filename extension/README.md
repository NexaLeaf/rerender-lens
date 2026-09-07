# rerender-lens DevTools extension

A Chrome DevTools panel ("Re-renders") that shows avoidable React re-renders live, laid out like
React DevTools' Components tab: component tree on the left with avoidable counts, details on the
right (why it rendered, which ancestor triggered it, props with the changed ones highlighted,
state and hooks), plus a live stream at the bottom.

## Page setup

```ts
import { init, createDevtoolsNotifier } from 'rerender-lens';
init({ trackAllMemoized: true, silent: true, notifier: createDevtoolsNotifier() });
```

## Install (unpacked)

1. Open `chrome://extensions`, enable *Developer mode*, click *Load unpacked*, pick this `extension/` folder.
2. Open your dev server (localhost by default), open DevTools, pick the **Re-renders** tab.

The content script only runs on `localhost`, `127.0.0.1`, `*.localhost` and `*.local`. Add your dev
host to `matches` in `manifest.json` if it is different.

## Preview without installing

Open `panel.html?demo` (or `panel.html?demo&theme=dark`) from any static server to see the panel
with sample data.

## How it talks to the page

`content.js` forwards `window` messages carrying `__rerenderLens: true` to `background.js`, which
routes them to the panel(s) inspecting that tab. The panel asks the page to replay its buffer with
`chrome.devtools.inspectedWindow.eval('window.__RERENDER_LENS_DEVTOOLS__.replay()')` when it opens
and after navigation. Nothing is injected into the page.

## Tests

`npm test` at the repo root also runs `extension/test/panel.test.ts`, which loads `panel.js` in
jsdom with a fake transport.
