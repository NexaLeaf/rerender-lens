# Publishing the extension

## Versioning

`extension/manifest.json` takes its version from `package.json`. `npm version <x.y.z>` syncs it
(the `version` script) and `npm run build:ext` syncs it again, so the two never drift. Tag
`vX.Y.Z` and push: the Release workflow publishes the npm package, attaches
`rerender-lens-{chrome,edge,firefox}-X.Y.Z.zip` to the GitHub release, and uploads the Chrome
zip to the Web Store when the secrets below exist.

Bump `package.json` before tagging: npm refuses to publish a version that already exists, and a
tag that repeats the package version (v0.3.3 and v0.3.4 both carried 0.3.0) gets a GitHub
release with the zips but no npm publish, plus a warning in the workflow log.

## Chrome Web Store (first time)

1. Register at https://chrome.google.com/webstore/devconsole (one-time fee).
2. `npm run build && npm run build:ext`, upload `dist-extension/chrome.zip` as a new item.
3. Fill the listing from `LISTING.md`; privacy tab from `PRIVACY.md` (host it, e.g. the GitHub
   file URL, and paste the link). Choose *Unlisted* for the first release.
4. Screenshots: run `npx http-server extension` (or any static server) and open
   `panel.html?demo`, `panel.html?demo&theme=dark`. Resize the window to 1280x800.

## Automated uploads

Create an OAuth client in Google Cloud (Desktop app), enable the *Chrome Web Store API*, and get
a refresh token (the `chrome-webstore-upload-cli` README documents the flow). Add these GitHub
Actions secrets:

| Secret | |
| --- | --- |
| `CWS_EXTENSION_ID` | from the developer console URL |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | the OAuth client |
| `CWS_REFRESH_TOKEN` | from the OAuth flow |

Without them the upload step is skipped and the zips are still attached to the release.

## Edge Add-ons

Same zip as Chrome: https://partner.microsoft.com/dashboard/microsoftedge. Manual upload; there is
no CI step.

## Firefox Add-ons

`dist-extension/firefox.zip` (event-page background, `browser_specific_settings.gecko` id,
minimum Firefox 128 for `world: "MAIN"` content scripts). Submit at
https://addons.mozilla.org/developers/. Manual upload for now.
