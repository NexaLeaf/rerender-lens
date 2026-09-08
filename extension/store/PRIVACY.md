# rerender-lens privacy policy

rerender-lens is a developer tool that inspects React re-renders in the pages you open DevTools on.

- **No data leaves your browser.** The extension makes no network requests. Reports are produced
  in the page, forwarded to the DevTools panel in the same browser, and discarded when the panel
  or the tab closes.
- **No analytics, no telemetry, no accounts.**
- **What is stored locally** (`chrome.storage.local`, on your machine only): the list of origins
  you enabled, whether injection is on for each, the library options you set in the panel, and
  panel preferences such as filters and collapsed nodes. Uninstalling the extension removes it.
- **Host permissions** are only used to run the relay and, if you turn it on, the library inside
  the pages of origins you explicitly enabled. Local development hosts are enabled by default.
- **Exports** (JSON) are written only where you choose to save them.

Questions: open an issue at https://github.com/NexaLeaf/rerender-lens/issues.
