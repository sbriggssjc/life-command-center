# Claude Code prompt — QA#2 + QA#3: Priority Queue correctness

Paste into Claude Code, run from the **life-command-center** repo. These two fixes
live in the Priority Queue code and don't touch the QA#1 files (sidebar-pipeline.js
/ v_next_best_action), so they can run in parallel on a separate branch.

---

## Context (verified live 2026-06-03 — don't re-investigate)

The Priority Queue front door has two correctness bugs:

**QA#3 — band counts truncate at 1000.** `handlePriorityQueueList` in
`api/admin.js` (route `priority-queue`) computes the chip counts by fetching
`v_priority_queue_enriched?select=priority_band&limit=5000` and tallying in JS.
PostgREST caps the response at **1000 rows**, so the chips read exactly
485+74+30+62+14+60+275 = **1000** and the **P8 band (~89) is missing entirely**;
P7 shows 275 vs ~303 in the DB. The items list itself is fine — only the counts
are wrong.

**QA#2 — the biggest band is non-actionable.** Band **P0.5 (485 rows)** is the
top of the queue (includes the "DO THIS FIRST" hero). Every P0.5 row reads
"Needs a BD opportunity opened" + an inert "owner-level" badge with **no button**.
Their `reason = 'open_bd_opportunity_needed'`. Each row already carries
`entity_id` (the view exposes it and `handlePriorityQueueList`'s `selectCols`
already includes `entity_id`). LCC Opps has a ready function:
`public.lcc_open_prospect_opportunity(p_entity_id uuid, p_owner_user_id uuid
DEFAULT null, p_vertical text DEFAULT null, p_source text DEFAULT 'manual',
p_notes text DEFAULT null) RETURNS uuid`.

## Task

### QA#3 — count server-side (LCC Opps)
1. Add an idempotent migration in `supabase/migrations/` creating a tiny view:
   ```sql
   CREATE OR REPLACE VIEW public.v_priority_queue_band_counts AS
   SELECT priority_band, count(*)::int AS n
   FROM public.v_priority_queue_enriched
   GROUP BY priority_band;
   ```
   (≤10 rows, so no 1000-row cap.)
2. In `handlePriorityQueueList` (`api/admin.js`), replace the
   `countsPath = 'v_priority_queue_enriched?select=priority_band&limit=5000'`
   tally with a read of `v_priority_queue_band_counts?select=priority_band,n`.
   Build `counts` from those rows (keep the existing `BAND_ORDER` sort) and
   `total = sum(n)`. Remove the JS row-tally loop.

### QA#2 — make owner-level rows actionable
3. **operations.js** — add a POST action `open_opportunity`:
   - dispatch: `case 'open_opportunity': return await bridgeOpenOpportunity(req, res, user, workspaceId);` (add to the action list string too).
   - `bridgeOpenOpportunity` reads `{ entity_id, vertical }` from the body,
     400s if no `entity_id`, then calls the RPC:
     `opsQuery('POST', 'rpc/lcc_open_prospect_opportunity', { p_entity_id: entity_id, p_owner_user_id: user.id, p_vertical: vertical || null, p_source: 'priority_queue' })`.
     Return `{ ok: true, bd_opportunity_id: <uuid from rpc> }`. Mirror the
     error-handling shape of `bridgeInitiateCadence`.
4. **ops.js `renderPriorityQueuePage`** — for owner-level rows (no
   `source_property_id`) that have an `entity_id`, render a primary
   **"Open opportunity →"** button instead of the inert `owner-level` badge:
   `onclick` calls a new `pqOpenOpportunity(entityId, vertical, btnEl)` that POSTs
   `/api/operations?action=open_opportunity`, toasts on success, and **advances
   the row in place** (reuse the existing `_opsAdvanceAfterComplete` pattern /
   add `data-q-id` on PQ rows if needed) so the queue self-propels. Keep the
   "owner-level" label only when there's genuinely no `entity_id`.
   - Make sure `handlePriorityQueueList` returns `entity_id` in the items (it's
     already in `selectCols`; confirm it survives into the row JSON) and that
     `renderPriorityQueuePage` emits it into the button.

## Verify + ship
- `node --check api/admin.js api/operations.js ops.js`.
- After deploy: Priority Queue chips should sum to the true total with **P8
  present**; clicking "Open opportunity →" on a P0.5 row opens a bd_opportunity
  (verify a row lands in `bd_opportunities`) and the row advances.
- Function count unchanged (operations.js uses `?action=`, admin.js uses
  `?_route=` — no new `api/*.js`).
- Branch `claude/qa2-qa3-priority-queue-<sessionId>`; end with merge + deploy
  commands. Apply the LCC Opps migration before/at deploy.
