# Claude Code — R32: version static assets so deploys invalidate the browser cache

## Why (root-caused live 2026-06-16)
The TEAM PULSE "SYNC ERRORS" widget "stayed broken" across THREE rounds (R25/R27/R29) even
though the code was correct and deployed each time. Root cause confirmed: the **deployed
`app.js` was correct** (fetched fresh via curl: `_lccLiveSyncErrors` used, `_qaSyncErr`
removed, `renderTeamPulse` reads the live source) — but the **browser kept executing a
cached `app.js`** because the page loads it as `<script src="app.js">` with **no version
query**. The HTML is fetched fresh on each load, but the unversioned `app.js`/`ops.js`/
`styles.css` assets are served from browser cache indefinitely. So every post-deploy
verification (mine and likely Scott's) ran stale JS and showed phantom "not fixed" results.

This is a systemic verification hazard, not a one-widget bug: ANY JS/CSS change can look
un-deployed until a manual hard-refresh. Fix it once.

## The fix — per-deploy version stamp on static asset URLs + correct cache headers
Ground first: how `index.html` / `ops.html` reference `app.js`, `ops.js`, `detail.js`,
`styles.css`, etc., and how `server.js` serves static files (Express `express.static`?).
Then:

1. **A per-deploy build id.** Derive a stable-per-deploy token — prefer the Railway deploy
   commit SHA (`RAILWAY_GIT_COMMIT_SHA` env) or `process.env.RAILWAY_DEPLOYMENT_ID`; fall
   back to a boot-time timestamp/uuid set once at server start. Expose it (e.g.
   `app.locals.assetVersion` / a small `/version` endpoint for diagnostics).
2. **Version the asset URLs.** Append `?v=<assetVersion>` to the `<script>`/`<link>` tags
   for the app's own JS/CSS. Two clean options — pick the lowest-risk for this codebase:
   - Serve the HTML through a tiny template/replace at request time that injects the
     current `assetVersion` into the asset tags (HTML is dynamic-served already, or wrap
     the static HTML send), OR
   - A build/boot step that rewrites the asset references in the served HTML.
   Don't hash-rename the files (heavier); the `?v=` query is enough to bust the cache.
3. **Cache headers (the belt-and-suspenders).** Via `express.static` setHeaders (or
   equivalent): serve **HTML with `Cache-Control: no-cache`** (always revalidate, so a new
   deploy's new `?v=` is seen immediately), and the **versioned JS/CSS with a long
   `max-age` + `immutable`** (safe because the URL changes each deploy). If versioning the
   URL is deferred, at minimum set the JS/CSS to `no-cache` so they always revalidate
   (correctness over efficiency).

## Guards / house rules
- Don't break the existing routes/SPA: the asset paths must still resolve (just with a
  `?v=`). Verify `index.html`, `ops.html`, and any other served HTML entrypoints all get
  the stamped references. ≤12 `api/*.js` (this is `server.js` + static serving, not a new
  api function). `node --check`; suite green.
- Scope to the app's OWN assets — don't append `?v=` to CDN/third-party script tags.

## Verify (after deploy)
- View source on the live Today page: `app.js?v=<sha>` (and ops.js/styles.css) carry the
  current deploy's version; the value changes after the next deploy.
- A normal (non-hard) browser reload after a deploy picks up the new JS — confirm by
  checking that a fresh load shows TEAM PULSE = 0 (the R29 fix) without Ctrl+Shift+R.
- `curl -sI .../app.js` shows the intended Cache-Control; HTML shows `no-cache`.

## Bottom line
The recurring "repo is right but the live app shows the old behavior" was browser asset
caching, not deploys. Versioning the static asset URLs per deploy makes every future JS/CSS
change show up on a normal reload — and stops us chasing phantom deploy bugs.
