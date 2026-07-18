# Claude Code (LCC) — `/api/sf-list-import` route REGRESSED AGAIN (POST 400 "Invalid POST action") + add a durable guard

## Symptom (grounded live 2026-07-17, PA "SF Get Campaign Members" run 08584172723704743577101062587CU19)

The PA flow is now fully correct (chunking + Contact resolve verified: `Get Contacts L2`
returns 200, `Select Members L2` maps, `POST L2` sends a clean 20-member body). But
`POST L2` gets **HTTP 400** from Railway:

```
POST https://tranquil-delight-production-633f.up.railway.app/api/sf-list-import
Headers: Content-Type: application/json, X-LCC-Key: <key>
Body: { campaign_id:"7018W000000O65XQAS", campaign_name:"NKB Prospects",
        parent_id:"...", members:[ {ContactId,FirstName,LastName,Email,Phone,City,State}, … 20 ] }

→ 400, Server: railway-hikari, X-Powered-By: Express, x-railway-request-id present
{ "error": "Invalid POST action. Bridge: log_activity, complete_research, log_call,
  save_ownership, dismiss_lead, update_entity, advance_cadence, snooze_cadence,
  set_contact_email. Workflows: promote_to_shared, … Prospecting: create_lead,
  initiate_cadence, open_opportunity, open_government_buyer" }
```

## Root cause (recurring)

This is the **exact same regression PR #1414 fixed earlier today** (and #1408/#1410 before it):
the **`sf-list-import` sub-route dispatch in `operations.js` is missing from the currently-
deployed Railway build**, so the POST falls through to the bare-action bridge router (which
emits that "Invalid POST action. Bridge: …" message). The route WAS live ~2.5h ago (it
ingested **690 real contacts across 57 lists** at ~21:57–22:03 UTC — verified in
`lcc_sf_list_membership`); a Railway redeploy since then reverted it. Production is the
**Railway Express server** (`server.js` → `operations.js`), NOT Vercel — `vercel.json` is
legacy.

## What to do

1. **Restore the route dispatch** so a POST to `/api/sf-list-import` reaches `handleSfListImport`
   BEFORE the bridge action router — same as PR #1414 (the `?_route=sf-list-import` /
   `_route==='sf-list-import'` case in `operations.js`, mounted via `server.js`). Confirm it's
   in the repo `main`; if present in repo but absent in the deployed build, it's a stale deploy →
   redeploy merged `main`. GET = dry-run, POST = ingest (unchanged).
2. **Add a durable guard so this stops regressing every deploy.** This is the 4th time a
   sub-route dispatch dropped off the deployed build (sf-contact-resolve-tick #1408, three
   routes #1410, sf-list-import #1414, now sf-list-import again). Do ONE of:
   - a repo test (`test/*`) that asserts each critical `_route` string
     (`sf-list-import`, `sf-contact-resolve-tick`, `owner-reconcile-tick`,
     `owner-reconcile-engine-tick`, `institution-contact-tick`) is present in `operations.js`'s
     dispatch and reached BEFORE the bridge router — so a stale-branch merge that drops one
     fails CI; and/or
   - a guard comment block + a single source-of-truth `SUBROUTE_DISPATCH` list so a merge
     can't silently delete one branch.
3. **Keep `≤12 api/*.js`** (sub-route of operations.js, no new file). **Redeploy Railway** (`main`).

## Verify (post-deploy)

`GET https://tranquil-delight-production-633f.up.railway.app/api/sf-list-import` returns the
route's dry-run JSON (NOT the bridge "Invalid POST action" error). Then Cowork re-runs the PA
flow; expected: `POST L2`/`POST L3` return 200 and `lcc_sf_list_membership` grows past 713 with
GSA Buyer reaching 156.

## Note — the PA flow itself is DONE

Do NOT touch the PA flow. Six rounds resolved it fully: (1) filter→whole-array,
(2) join(outputs) = all chunks, (3) filter typed as text not expression, (4) 50-ID chunk
exceeded SF's 100-node OData cap → chunk size 20, (5) SF 429 under 20-way concurrency →
For-each concurrency 1, (6) NOW the LCC route regression. Only the route needs restoring +
a regression guard.
