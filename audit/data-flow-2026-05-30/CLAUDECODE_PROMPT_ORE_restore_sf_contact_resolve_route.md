# Claude Code (LCC) — restore the `/api/sf-contact-resolve-tick` route (regressed in the last redeploy)

## Symptom (grounded live, LCC Opps pg_net, 2026-07-16)

The SF WhoId-resolver worker route **worked** and then **regressed in a redeploy**.
Timeline from `net._http_response` (every response is the `lcc-sf-contact-resolve`
cron's `lcc_cron_post('/api/sf-contact-resolve-tick?limit=25', ...)`):

- **≤ 00:00:02 UTC 2026-07-16 — HEALTHY.** Worker-shape 200s, e.g. id 98205 @ 22:00:
  `{"mode":"apply","byid_configured":true,"queue_depth":3,"scanned":3,"resolved":3,"minted":3,...}`
  — the by-id field-map fix works: 3 WhoIds minted cleanly. 22:30/23:00/23:30/00:00 all
  returned `byid_configured:true` 200s (`queue_depth:0`).
- **≥ 00:30:10 UTC 2026-07-16 — BROKEN.** Every `sf-contact-resolve-tick` POST (cron AND
  manual) now returns **HTTP 400**:
  ```json
  {"error":"Invalid POST action. Bridge: log_activity, complete_research, log_call,
   save_ownership, dismiss_lead, update_entity, advance_cadence, snooze_cadence,
   set_contact_email. Workflows: ... Prospecting: create_lead, initiate_cadence,
   open_opportunity, open_government_buyer"}
  ```
  That error is operations.js's **bare bridge-action router** — i.e. the POST reached
  operations.js but `sf-contact-resolve-tick` was **not recognized as a sub-route**, so it
  fell through to the action dispatcher and 400'd.

**A deploy landed between 00:00 and 00:30 UTC (2026-07-16) that dropped the
`sf-contact-resolve-tick` sub-route registration.** The handler + the field-map fix (PR
#1407) are correct — only the ROUTE DISPATCH broke, so the fix has never run against
Capra/Dowling.

## Almost certainly a stale-branch merge revert

PR #1406 added the route in **three** places (server.js mount + operations.js `_route`
dispatch + vercel.json rewrite). PR #1407 ("JS-only: sf-contact-resolve.js +
salesforce.js") most likely branched from a pre-#1406 `main`; merging it reverted
operations.js (and/or server.js / vercel.json) to the state WITHOUT the route, while
keeping the new handler file. Classic symptom: handler present, dispatch gone → "Invalid
POST action".

## The fix
1. **Restore the `sf-contact-resolve-tick` sub-route registration** so a POST to
   `/api/sf-contact-resolve-tick` reaches `handleSfContactResolveTick` (or its actual
   name) instead of the bridge-action router. Verify ALL of:
   - **operations.js** — the `?_route=`/path dispatch recognizes `sf-contact-resolve-tick`
     BEFORE the bare-action branch (this is the one that produces the 400).
   - **server.js** — the Railway Express mount (`app.all('/api/sf-contact-resolve-tick',
     …)` → operations handler) is present (production is Railway, per CLAUDE.md).
   - **vercel.json** — the legacy rewrite exists too (belt-and-suspenders; Railway is live).
   Compare against the SIBLING resolver routes added the same era (e.g.
   `sf-activity`, `owner-reconcile-tick`, `institution-contact-tick`) — restore the
   identical wiring pattern for `sf-contact-resolve-tick`.
2. **Guard against re-revert:** confirm the route lines are present on `main` post-merge
   and add a one-line comment near the registration noting the by-id resolver depends on it,
   so a future stale-branch merge is easier to catch in review.
3. **No behavior change to the handler** — the resolver + field-map (PR #1407) are verified
   working (it minted 3 contacts at 22:00 before the regression). This is purely restoring
   the dispatch.

## Verify (post-redeploy)
- `GET /api/sf-contact-resolve-tick` returns the worker dry-run (queue depth), NOT a 400.
- Then Cowork re-drains: the two WhoIds already reset to `status='seen'` in
  `sf_contact_resolve_queue` (`0038W00002PRo0iQAD` Capra, `0038W00002PRqkNQAT` Dowling)
  should mint/reconcile on the next tick → **Capra mints onto Boyd** with a
  `salesforce/Contact` identity, the **SF Eric Dowling merges by email into the existing
  CoStar/RCA Dowling** (one entity, no dup), and the **`sf_contact_account_mismatch` lane
  surfaces Dowling-on-"Arbor Realty Trust"**.
- Sanity-scan `net._http_response` after the redeploy: `sf-contact-resolve-tick` cron ticks
  return `byid_configured:true` 200s again, no more "Invalid POST action".

## Boundaries
LCC-Opps only; SF read-only; no fabrication; ≤12 api/*.js (the handler is a sub-route, not
a new file — restoring the route must NOT add an api/*.js). Additive/reversible.

## Bottom line
The by-id resolver is correct and proved itself (3 mints at 22:00). A redeploy at ~00:15 UTC
2026-07-16 reverted the `/api/sf-contact-resolve-tick` route registration, so every tick now
400s at the bridge-action router. Restore the sub-route wiring (operations.js dispatch +
server.js mount + vercel.json rewrite), redeploy, and the queued Capra/Dowling drain.
