# Claude Code (LCC) — restore the `/api/sf-list-import` route on Railway (POST 400 "Invalid POST action")

## Symptom (grounded live 2026-07-17, in the PA "SF Get Campaign Members" run)

The durable Campaign-Members flow now works through the Salesforce side end-to-end:
`Get L2 members` ✓ → `Select ContactIds L2` ✓ (emits `Id eq '<id>'` strings) →
`Compose ContactFilter L2` ✓ (`join(..., ' or ')`) → **`Get Contacts L2` ✓ 200** (the
`eq…or` filter resolved the connector's rejection of the `IN` operator) →
`Select Members L2` ✓ → **`POST L2` ❌ 400**.

The POST is to:
```
POST https://tranquil-delight-production-633f.up.railway.app/api/sf-list-import
Headers: Content-Type: application/json, X-LCC-Key: <key>
Body: { campaign_id, campaign_name, parent_id, members:[…resolved contacts…] }
```
and the LCC returns (Railway Express — `X-Powered-By: Express`, `x-railway-request-id`):
```
statusCode: 400
body: { "error": "Invalid POST action. Bridge: log_activity, complete_research, lo…" }
```

## Root cause

`"Invalid POST action. Bridge: log_activity, complete_research, …"` is the
**`operations.js` bridge POST-action router** rejecting the request — i.e. the POST
reached `operations.js` but the **`sf-list-import` sub-route dispatch did not match**, so
it fell through to the bare-action bridge router (which lists `log_activity`,
`complete_research`, …). This is the recurring **stale-branch-merge regression** that
dropped a sub-route dispatch on the deployed Railway build (same class as PR #1408 which
restored `sf-contact-resolve-tick`, and PR #1410 which revived three routes).

⚠️ **Production is the Railway Express server (`server.js`), NOT Vercel** — the
`vercel.json` rewrite for `/api/sf-list-import` is legacy and does nothing on Railway. On
Railway the route only works if **`server.js` mounts `/api/sf-list-import`** (directly, or
by routing it into `operations.js`) AND **`operations.js` handles the `sf-list-import`
`_route`** before the bridge action router. One of those two is missing/regressed on the
currently-deployed build.

Note: the route WAS working — earlier runs (2026-07-16) ingested 627 Contact members
through it. A redeploy of merged `main` since then dropped it.

## What to do

1. **Verify the deployed vs. repo state.** Confirm `api/operations.js` still contains the
   `sf-list-import` dispatch (the `?_route=sf-list-import` / `_route==='sf-list-import'`
   case that calls the `handleSfListImport` handler, PR #1412/#1413), and that `server.js`
   mounts it (e.g. `app.all('/api/sf-list-import', …)` or the operations passthrough that
   carries `_route`). If either is missing in the repo, restore it; if present in the repo
   but absent in the deployed build, it's a stale deploy — redeploy merged `main`.
2. **Restore the route so a POST to `/api/sf-list-import` reaches `handleSfListImport`**,
   BEFORE the bridge action router (so it can't fall through to "Invalid POST action").
   GET = dry-run (parse + classify, no writes), POST = ingest — unchanged from PR #1412/13.
3. **Keep `≤12 api/*.js`** — this is a sub-route of `operations.js`, no new file.
4. **Redeploy Railway** (`main`). Verify post-deploy with a GET dry-run:
   `GET https://tranquil-delight-production-633f.up.railway.app/api/sf-list-import`
   should return the route's dry-run JSON (NOT the bridge "Invalid POST action" error).

## Verify (post-deploy, Cowork re-runs the PA flow)

Re-run "SF Get Campaign Members". Expected: `POST L2`/`POST L3` return 200, and the
run completes. Then confirm on LCC Opps: **GSA Buyer = 156** members ingested (an L3
sublist under "Buyer Lists"), the KDL/SAB/NKB seller lists match their Vision GM totals,
`external_identities` gains the resolved Contact identities with real names (no
"founder and ceo" junk), and email-tier reconcile means no duplicate persons.

## Bottom line

The PA-flow half is fixed (the SF connector `IN`-operator rejection is solved via the
chunk-free `eq…or` filter; the two-step Contact resolve runs 200 end-to-end). The only
remaining blocker is the LCC `/api/sf-list-import` route dispatch, which regressed off the
deployed Railway build. Restore the route + redeploy, then the lists ingest with full
member coverage.

## Follow-up still pending (do NOT lose track)
The `eq…or` filter has NO chunking yet. It succeeded on NKB Prospects (small), but the
4–5k-member lists will exceed the connector's URL/filter length. After the route is
restored and a full run verifies, add `chunk(body('Select_ContactIds_L2'), 50)` +
an inner Apply-to-each in BOTH L2 and L3 resolve branches (Compose join per chunk →
Get Contacts → Select Members → POST), so the biggest lists don't blow the filter length.
