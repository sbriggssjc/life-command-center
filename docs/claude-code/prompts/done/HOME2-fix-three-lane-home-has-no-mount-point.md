# HOME2-fix — the three-lane Home renders nothing: `index.html` has no `home3*` elements

**Filed:** 2026-09-17 (Cowork round 31, from Scott's look — two screenshots of Home on Railway, desktop app
and fresh Chrome, flag ON). **Owner:** LCC (`index.html`, `app.js`, `test/home2-three-lanes.test.mjs`).
**Read first:** `docs/audits/HOME1_HOME_PAGE_*` (the spec), backlog `HOME2`, commit `7d30f90e`.

## Measured
- Railway `/version` = `7d83c56e` (current `main`); workspace flag `home_three_lanes = true`; the served
  `app.js` contains `renderHomeThreeLanes`. Scott's Home shows the old TODAY / MY WORK / INBOX layout, no
  Research / BD / Inbox lanes.
- `renderHomeThreeLanes()` writes into `#home3LanesWidget`, `#home3ResearchContent`, `#home3BdContent`,
  `#home3InboxContent`. `git grep home3 origin/main` → `app.js`, the test, the parking lot. **`index.html`
  has none of them**; commit `7d30f90e`'s `index.html` diff is cache-bust version strings only. Every lane
  renderer returns at `if (!el) return`.
- With the flag ON the only live effect is negative: `_dbFillMyPrioritiesFromQueue()` is suppressed
  (`app.js` ~7281) because the BD lane "replaces" it.
- 214 lines of tests passed: they never assert the mount points exist in `index.html`.

## Build
Add the widget markup per HOME1's spec (where on Home, what it replaces — say which existing panels hide
under the flag; HOME1 decides, do not improvise), bump the cache-bust, and add the test that would have
caught this: every `getElementById('home3…')` id in `app.js` exists in `index.html`. Generalise it if cheap:
any id `app.js` looks up behind a feature flag must exist in the HTML. Verify in a real browser against
Railway after deploy (screenshot in the response) — flag stays ON for Scott's second look.

⛔ No redesign beyond HOME1. ⛔ STATUS entry labelled **(CC)**. **Parked:** one line each.
