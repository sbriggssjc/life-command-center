# Claude Code (life-command-center) — fix owner-contact-enrich-tick auth (endpoint always 401s → worker never runs)

## Why (root-caused live 2026-06-26, post-redeploy verification)

Verifying the outreach chain, I fired the EXACT call the daily cron makes —
`SELECT lcc_cron_post('/api/owner-contact-enrich-tick?limit=25','{}'::jsonb,
'vercel')` on LCC Opps — and got **HTTP 401 `{"error":"unauthorized"}`**. In the
same 3-hour window 310 other cron POSTs returned 200, so this is **endpoint-
specific**, not a global auth outage. The cron job shows "succeeded" only because
pg_net enqueued the POST, not because it got a 2xx — so the failure was invisible.

**Root cause (code):** `api/_handlers/owner-contact-enrich.js`
`handleOwnerContactEnrichTick` (lines 358-359):
```js
const auth = await authenticate(req);
if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error || 'unauthorized' });
```
But `authenticate(req, res)` (`api/_shared/auth.js:303`) returns a **user object
on success / `null` on failure (and sends its own 401 via `res`)** — it does NOT
return an `{ok,status,error}` shape. So on a VALID X-LCC-Key the function returns
the synthetic automation user object, whose `.ok` is `undefined`, so `!auth.ok` is
`true` and the handler 401s **every request, even correctly authenticated ones**.
It also passes no `res`, so the failure branches inside `authenticate` would throw
on `res.status(...)`. Net: **this endpoint has never successfully run** — not the
`lcc-owner-contact-enrich` cron, not the Phase 5b "Run lookup" single-owner CTA.

This is the TRUE reason the 88 free-attach owners never drained (all
`owner_contact_pivot` rows still frozen at the 2026-06-20 seed) — beneath the
silent-churn logic PR #1350 fixed, the worker couldn't even execute. PRs #1350
(drain logic), #1353 (seed-cadence wire), and #1352 (work-surface) are all correct
but inert until this endpoint authenticates.

**This exact bug was already fixed in a sibling handler** —
`api/_handlers/developer-chain-resolve.js:391` carries a comment noting "the prior
`auth.ok` check read a property the user object [doesn't have]" — owner-contact-
enrich was simply missed in that pass. Use it (and `folder-feed.js:186`) as the
reference pattern.

## The fix (2 lines, match the working handlers)

In `handleOwnerContactEnrichTick` (`api/_handlers/owner-contact-enrich.js:357-359`),
replace the broken contract with the canonical one used everywhere else:
```js
export async function handleOwnerContactEnrichTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return; // authenticate already sent 401
  ...
```
- Pass `res` so `authenticate` can send its own 401, and gate on the truthy user
  object (not `.ok`). Identical to `folder-feed.js` and the corrected
  `developer-chain-resolve.js`.
- Confirm there's no later reference to `auth.ok` / `auth.status` / `auth.error`
  in this handler; remove/rename if present.

## Scope / verify

- life-command-center; one handler file; no new api/*.js (stays 12); no migration.
- Grep the whole `api/` tree once more for any other `authenticate(req)` (one-arg)
  + `auth.ok` pattern and fix any stragglers the same way (grounded today: only
  owner-contact-enrich still had it; developer-chain-resolve already fixed).
- `node --check api/_handlers/owner-contact-enrich.js`; suite green.
- **Live proof (Cowork verifies after deploy):** `lcc_cron_post(
  '/api/owner-contact-enrich-tick?limit=25', …, 'vercel')` returns **200** with a
  processed/attached summary (not 401); the 88 free-attach `owner_contact_pivot`
  rows begin populating `active_contact_entity_id`; value-floor owners get a seeded
  cadence (PR #1353); they surface in the work-surface focus session (PR #1352).

## Bottom line

A two-line auth-contract bug made the entire owner-contact-enrich worker 401 on
every call — so the free-attach drain, the Phase 5b CTA, and (transitively) the
high-value-owner→cadence chain were all dead despite correct downstream code. Fix
the `authenticate(req, res)` contract to match every other handler; the outreach
supply chain then actually runs.
