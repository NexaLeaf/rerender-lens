# Chrome Web Store listing

**Name:** rerender-lens

**Summary (132 chars max):**
See avoidable React re-renders as they happen, with the prop, state or context that caused each one, and the fix.

**Category:** Developer Tools

**Description:**

rerender-lens adds a "Re-renders" panel to DevTools that shows which React components re-rendered
without anything actually changing, and why.

For every avoidable re-render you get the prop, state, context or store value that was a new
reference with the same contents, the ancestor whose update started the cascade, the component
that created the element, and a code snippet with the fix (useMemo, useCallback, React.memo, a
memoized provider value, ...).

- Component tree with avoidable counts, like React DevTools' Components tab
- Offenders table: components ranked by avoidable renders and wasted time
- Commits view with root causes and the render cascade
- Fixes view: every fix ranked by how many re-renders it removes
- Hover a component to outline its DOM in the page; flash avoidable renders as they happen
- Open the source location of the element in the Sources panel
- Elements-panel sidebar for the selected DOM node
- Toolbar badge with the avoidable count of the current tab
- Works with any React app: enable injection for the origin and no app code is needed
- Export/import reports as JSON, copy a report as Markdown

Everything runs locally in your browser. No data is sent anywhere. No analytics.

Works with React 16.8 to 19 development builds (production builds are detected and flagged).

**Permission justification (for the review form):**

- `storage`: remembers which origins you enabled and your panel settings, per origin.
- `scripting`: registers the relay/injection content scripts on origins you enabled.
- `activeTab`: lets the toolbar popup read the current tab's origin so it can offer to enable it.
- Host permissions for `localhost`, `127.0.0.1`, `*.localhost`, `*.local`: development servers
  are enabled out of the box.
- Optional host permissions `http://*/*`, `https://*/*`: only requested when you enable a
  specific site from the popup or the panel; the extension never asks for all sites.

**Single purpose:** debugging React re-renders in the developer's own applications.

**Screenshots (1280x800):** take from `panel.html?demo` (tree + report), the Commits view, the Fixes
view, and the Elements sidebar. See PUBLISHING.md.
