# Manual QA checklist

Run before every store submission. The automated suites cover the library (vitest), the panel in
jsdom, and Chromium with the extension against the example app (Playwright: relay, badge,
injection, deferred injection, the panel page, the side-panel page). What no test reaches:

## In real DevTools (Chrome)

- [ ] `npm run dev:example`, open `http://localhost:5199/`, open DevTools → **Re-renders** tab
      shows the tree after clicking *Re-render App*; status reads `connected · lib <version> · React <version>`.
- [ ] Click a component: Report, History and Fix tabs; *Highlight* outlines it in the page;
      hovering rows outlines them; `Esc` clears.
- [ ] *Open source* link (`/src/ProductList.tsx:NN`) opens the Sources panel at the line.
- [ ] Settings drawer: toggle *Track every component*, reload nothing, click in the app: more
      components appear. Toggle back.
- [ ] Dark theme (DevTools settings → Appearance → Dark) restyles the panel without reload.
- [ ] Elements panel: select `<button>` inside a product row → the **Re-renders** sidebar shows
      `<ProductList>` with its recent reports and a working *Highlight* button.
- [ ] Toolbar badge shows the avoidable count for the tab; *Clear* resets it.
- [ ] `http://localhost:5199/plain.html` (no library): status reads `no library in page`; popup →
      *Inject the library* → reload → reports appear; the banner is absent. Then on `/` (page runs
      its own copy) the "stepped aside" banner shows; turn injection off again.

## Outside DevTools

- [ ] Popup → **Open side panel**: Chrome docks the panel on the right, pinned to the tab; the tab
      chip shows the title and host; compact layout (stacked tree/details, icon-only toolbar).
- [ ] Popup → **Open in window**: a popup window with the panel, pinned to the tab.
- [ ] A non-local `https://` dev host: popup → *Enable on this site* prompts for the host
      permission once; after accepting, the relay connects (status turns green). Decline once to
      see "Permission was not granted."
- [ ] React DevTools installed alongside: with injection on, the Components tab still works; if
      not, *Let React DevTools create the hook* fixes it after a reload.

## Sessions

- [ ] Record → interact → Stop; apply a fix (e.g. wrap `Toolbar` in `memo`), record again; the
      Sessions view compares them with negative deltas and "No longer needed".

## Other browsers

- [ ] Edge: `edge://extensions` → load `dist-extension/edge` → same checks as Chrome DevTools.
- [ ] Firefox 128+: `web-ext run --source-dir dist-extension/firefox` → DevTools tab, sidebar
      (View → Sidebar → rerender-lens), popup enable flow. `npx web-ext lint` must be clean (CI runs it).
