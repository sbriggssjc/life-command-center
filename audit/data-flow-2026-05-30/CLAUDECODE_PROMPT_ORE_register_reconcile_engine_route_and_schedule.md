# Claude Code (LCC) — register the owner-reconcile-engine route + schedule the autonomous cron

## Why (grounded live 2026-07-16)

The weighted owner-reconciliation engine (`lcc_reconcile_owner` etc., migrations
`20260716140000`/`141000`) is built and **validated at the DB layer** — a live dry-run over
the top-400 value owners returned **4 `same_party` auto-merges (all real case-dups), 133
`review`, 10 `distinct` (every one correctly held on a high-authority conflict)**. Sample
auto-merges (all correct): "Penzance Management LLC" ↔ "Penzance"; "City Of Phoenix" ↔ "city
of phoenix"; "Morgantown GSA, LLC" ↔ "MORGANTOWN GSA USDA, LLC" (two Boyd Watterson SPEs on
the same GSA property). The engine is conservative and safe.

**But the worker route `/api/owner-reconcile-engine-tick` is NOT registered** — a POST to it
returns the bare bridge-action router's `"Invalid POST action …"` 400 (never a worker
response; it has never returned 200). Same class as PR #1408 (`sf-contact-resolve-tick`): the
handler exists but the operations.js sub-route dispatch was never wired, which is why the
engine's drain cron was left commented out in migration `20260716141000`. So the "robust,
independent, resilient" autonomous consolidation Scott wants can't run.

## The fix
1. **Register `owner-reconcile-engine-tick` as a sub-route** (mirror the sibling resolver
   routes — e.g. `owner-reconcile-tick`, `sf-contact-resolve-tick`, `sf-link-reconcile-tick`):
   operations.js `_route` dispatch → the engine handler, BEFORE the bare-action branch; plus
   the server.js Express mount and the vercel.json rewrite (production is Railway). Confirm
   the handler's export name and wire it identically to its siblings. Add the same guard
   comment PR #1408 added, so a stale-branch merge can't silently revert it again.
2. **Verify the handler is the gated drain** (GET dry-run / POST drain), bounded by `limit`
   + a wall-clock budget, and that a POST **without** the gate is a safe no-op/preview (per
   the "auto-merge is consequential — gated" posture in CLAUDE.md). Keep the gate; do NOT
   auto-enable a full drain.
3. Leave the drain cron **commented/unscheduled** in the migration as-is; scheduling happens
   AFTER Cowork runs the first capped gated drain through the now-live route and confirms the
   merges (the owner-deed-autofix / UW#2 posture).

## Verify (post-redeploy, Cowork)
- `GET /api/owner-reconcile-engine-tick?min_value=1000000` returns the worker dry-run
  distribution (not a 400).
- A capped `POST …?limit=10` (gated) executes the ~3 confident `same_party` merges through
  `lcc_merge_entity` (reversible tombstones), records evidence, and rebuilds the load-bearing
  caches (`lcc_refresh_priority_queue_resolved` / `_entity_connected_value` /
  `_buyer_spe_resolved`) clean; `distinct` rows are NOT merged.
- Then Cowork schedules `lcc-owner-reconcile-engine` (the commented template in
  `20260716141000`) so consolidation runs autonomously.

## Boundaries
LCC-Opps only; no dia/gov writes; ≤12 api/*.js (handler is a sub-route, no new file);
additive/reversible; no behavior change beyond registering the dispatch + keeping the gate.

## Bottom line
The engine is validated and safe; only its route was never wired. Register
`owner-reconcile-engine-tick` (operations.js dispatch + server.js mount + vercel.json
rewrite), keep the gated-drain posture, redeploy — then the capped drain + cron make owner
(and SF) duplicate consolidation autonomous.
