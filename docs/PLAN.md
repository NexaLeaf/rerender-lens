# Plan

Everything below 0.5.0 shipped. This file tracks what is done and what is next; the changelog has
the detail. Each milestone ends green (`npm run check`, `npm run e2e`, `npm run e2e:next`,
`npm run test:jest`, `npm run test:react18`, `npm run test:react17`) and merges as one fast-forward.

## Done since 0.5.0 (unreleased)

- **O (code half)** — *Report a problem* in the panel's Settings drawer: a prefilled GitHub issue
  with versions, options, overhead and buffer counts, nothing from the page. QA checklist extended
  with the scale, relay and help checks.
- **P** — verdicts on modern React. A fixture matrix (`test/modern.test.ts`, `/modern.html` in the
  example) for React Compiler output, `use()`, transitions, Suspense, store selectors, render props,
  refs on memo components, classes and deferred values. Four wrong verdicts fixed; the README gained
  "What counts as avoidable".
- **Q** — `rerender-lens/jest` next to the Vitest integration, sharing `src/runner-report.ts`, with a
  real Jest run in CI. React 17 joined React 18 in the compat job, and what React 17 cannot do is
  documented and warned about once at runtime.
- **R** — several apps on one relay (ids, labels, a picker in the panel, targeted commands), the
  commit timeline strip with brushing, and a test proving the side panel and the DevTools panel
  share per-origin settings both ways.
- **S** — the docs site as a product page: a landing page whose setup snippets come out of the
  README, the guide, the extension guide, a generated API reference, and a hosted panel demo.

## O (the rest) — ship the listings

Yours, not code: push the `v0.5.0` tag (npm still serves 0.4.0), then the Chrome Web Store item
from `dist-extension/chrome.zip` with `extension/store/LISTING.md` and `extension/store/media/`,
Edge Add-ons from the same zip, Firefox AMO from the firefox zip. Walk `extension/store/QA.md` on a
real app once and fix what it turns up.

## T — hardening (1 day)

- Relay: require `--token` when `--host` is not loopback; the token travels as a query parameter on
  the SSE stream and a header on POST, and the panel URL carries it. Today a relay bound to
  `0.0.0.0` is open to the network.
- Extension: fail CI on `web-ext lint` warnings that are ours; re-check that no path uses `eval`
  outside the DevTools API; document the CSP.
- Perf: a nightly job runs the scale e2e at 3k and 10k rows with tighter budgets and posts
  `maxCommitMs` per size as a CI annotation, so a regression shows up before a user reports it.

## U — after the listing lands (sized once there is feedback)

- Whatever the store reviews and the first issues ask for. Hold this slot.
- Candidates already on the list: a "why is this component not tracked?" explainer in the panel,
  `include`/`exclude` presets per framework, and an `onlyAvoidable` streaming mode for very large
  apps (the library posts nothing until a commit has an avoidable report).

## Not planned

React Native (no DOM, no DevTools panel path), legacy browsers, readable names in production
builds, a hosted relay.
