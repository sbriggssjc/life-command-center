# Claude Code (LCC) — retire Vercel, make missing API routes fail loudly, add a deploy gate

## Why (grounded live 2026-07-20)

Four separate incidents were diagnosed as "the `_route` dispatch regressed off the build"
(sf-contact-resolve-tick #1408, three routes #1410, sf-list-import #1414, sf-list-import
again #1415). **That diagnosis was wrong.** The routes were always in the repo. The
*deploys weren't landing*.

Proof — `/version` (the R32 diagnostics endpoint) on live Railway right now:

```json
{"version":"c7775934820a","source":"railway_git_commit_sha","git_pinned":true}
```

`c7775934` is PR #1424, a **docs-only** commit. `main` is at `b90ffa1d`. Railway is four
merges behind (#1425, #1426, #1427, #1428 all unshipped), which is why
`/api/sf-account-import` and `/api/lead-ingest` are not reachable despite being correctly
mounted in `server.js`, rewritten in `vercel.json`, dispatched in `operations.js`, and
covered by the PR #1415 guard test.

Two structural problems made a stale deploy invisible:

1. **`server.js:492` — `app.get('*', (req, res) => sendIndex(res))`.** Any GET to an
   unmounted `/api/*` path returns **HTTP 200 with the SPA's HTML**, not a 404. Every
   "is the route live?" check that reads a status code was being lied to. (POST behaves
   differently — it isn't caught by `app.get`, so it falls to the bridge action router and
   returns `400 Invalid POST action`. That is why these only ever surfaced when a Power
   Automate flow POSTed.)
2. **The PR #1415 guard tests the REPO, not the DEPLOY.** `test/operations-subroutes.test.mjs`
   asserts each critical `_route` string is present in `operations.js` and reached before the
   bridge router. That is worth keeping, but it passes green forever while production serves
   week-old code. It structurally cannot catch this failure class.

Separately, **Vercel has failed 40+ consecutive deployments** (checked back to 2026-07-19;
every one `ERROR`, production targets included):

```
errorCode:    exceeded_serverless_functions_per_deployment
errorMessage: "No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."
errorStep:    patchBuild
```

The build succeeds in 13s; Vercel rejects the *deploy* on function count (14 `api/*.js` vs the
Hobby cap of 12). **Decision (Scott, 2026-07-20): retire Vercel.** The fallback is illusory —
there is no recent successful Vercel build to fail over to — and `vercel.json` has already
drifted from `server.js` (3 rewrites point at routes `server.js` doesn't mount; 17 handlers
have no rewrite at all).

## What to build

### Unit 1 — missing `/api/*` routes must 404 honestly (the masking fix)

In `server.js`, **immediately before** the `app.get('*', …)` SPA catch-all at ~line 492, mount
an API-scoped 404:

```js
// Any /api/* path that reached here matched no route. Return an honest JSON 404 —
// NEVER fall through to the SPA catch-all below, which would return 200 + index.html
// and make a stale deploy or a dropped route look healthy (2026-07-20 incident).
app.all('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Unknown API route',
    path: req.path,
    version: ASSET_VERSION,   // reuse the existing deploy token so a 404 names the build
  });
});
```

- Must sit **after** every real `/api` mount and **before** `app.get('*')`.
- Use the module's existing deploy-version constant (whatever `/version` reads) so a 404
  response itself identifies which build answered.
- Do not change any existing route's behavior; this only catches genuine misses.

### Unit 2 — a one-command deploy gate

`/version` already returns the deployed commit. Make comparing it trivial and scripted.

- Add `scripts/verify-deploy.mjs`:
  - fetch `<BASE>/version` (default the Railway production URL, `--url` to override)
  - compare `version` against the local `git rev-parse HEAD` (`--sha` to override, so CI can
    pass the merge SHA)
  - **also probe a small list of critical routes** (reuse `CRITICAL_SUBROUTES` from
    `test/operations-subroutes.test.mjs` — single source of truth, don't duplicate the list)
    with a GET and assert the response is **JSON, not HTML** (Unit 1 makes a miss a real 404;
    an HTML body means the fix isn't deployed or the route is missing)
  - exit non-zero with a clear message on SHA mismatch or any route returning HTML
- Add an npm script: `"verify:deploy": "node scripts/verify-deploy.mjs"`.
- Document it in CLAUDE.md as **the** post-redeploy check — replacing "verify with a GET
  dry-run," which is exactly the check that was being fooled.

### Unit 3 — retire Vercel from the repo

- **Delete `vercel.json`.** `server.js` is the sole routing source of truth; the file is now
  actively misleading (phantom `bov-extract`, `cre-doc-text-tick`, `lease-extract` rewrites
  that 404 on Railway).
- Remove the `vercel` dev-dependency from `package.json` (the build log warns it's ignored
  anyway).
- **CLAUDE.md — remove the Vercel Hobby constraint entirely.** Delete the "HARD LIMIT: 12
  serverless functions" section and the `ls api/*.js | wc -l` rule from the Rules list. Replace
  with a short note:
  > **Routing:** production is the Railway Express server. `server.js` is the single source of
  > truth for `/api/*` mounts — add a route there (sub-routes via `?_route=`). There is no
  > serverless-function cap. Vercel was retired 2026-07-20 after 40+ consecutive failed
  > deploys (Hobby 12-function cap); `vercel.json` is deleted.
- Keep every other rule (new endpoints still go in as `?_route=` sub-routes of an existing
  handler — that's good structure independent of any platform cap).
- Update any doc/comment that references `vercel.json` rewrites as a required step when adding
  a route (there are several in `server.js` comments and the audit docs) so the next round
  doesn't re-add a file that no longer exists.
- **Keep `test/operations-subroutes.test.mjs`** — but update its header comment to state
  honestly that it guards the *repo* dispatch only, and that deploy verification is
  `scripts/verify-deploy.mjs`.

## Boundaries

No behavior change to any existing live route · no DB writes · no dia/gov changes · additive
except the deliberate `vercel.json` deletion · **no `api/*.js` count constraint any more** (the
whole point) · keep the existing `?_route=` sub-route pattern.

## Verify

1. `npm test` green (the subroutes guard still passes).
2. Locally: `GET /api/definitely-not-a-route` → **404 JSON**, not the SPA HTML; a real route
   still responds normally; `GET /` still serves the app.
3. `node scripts/verify-deploy.mjs --url https://tranquil-delight-production-633f.up.railway.app`
   — against the CURRENT stale deploy it must **FAIL** (SHA mismatch: live `c7775934` vs main),
   which is the proof the gate works. After Scott's Railway redeploy it must pass.
4. Confirm `vercel.json` is gone and nothing in the repo reads it.

## Scott's steps (NOT code — do not attempt these)

- Disconnect the Vercel Git integration for `life-command-center` in the Vercel dashboard, so
  merges stop generating failed deployments. (Deleting `vercel.json` alone does not stop
  Vercel from building.)
- Investigate why Railway stopped auto-deploying at `c7775934` (failed build vs disconnected
  GitHub trigger vs paused service), and redeploy `main`.
- Re-run the SF Get Accounts flow afterwards — the earlier test run POSTed into a 404.
