# Claude Code prompt — R6 HOTFIX: priority-queue API 500s (queue page hard-down)

Paste into Claude Code (PR #1060 follow-up). The R6 migrations are APPLIED and
the DB layer is fully verified healthy — this is a JS bug in the deployed
handler. The Priority page currently renders "Could not load the priority
queue. Internal server error."

## Verified state (2026-06-05, post-apply — trust this, don't re-derive)

DB (LCC Opps) — all healthy:
- All 5 R6 migrations applied (gov view + 4 LCC files; I fixed two nested-`$$`
  dollar-quoting hazards in the DO/cron blocks of files 3 and 4 when applying —
  use `$cron$` tags if you re-emit those files in the repo).
- Band counts correct: P0 2 · **P0.4 348** · **P0.5 16** · P-BUYER 21 · P1 72 ·
  P2 32 · P3 62 · P4 14 · P5 60 · P6 4 · P7 313 · P8 91.
- Owner-facts mirror synced: **17,875 gov rows** (sync + finalize ran manually;
  crons registered). Tier-0 verified: 8/12 FGF entities → Boyd Watterson Global
  via `domain_true_owner`; ARLINGTON VA I FGF correctly stays P0.4 with
  `resolve_reason='true_owner_known_connect'`, true_owner "The Shooshan
  Company". R5 NGP refusal regression-tested ✓. First 100 chain research tasks
  generated ✓.
- **Perf gotcha found+fixed:** the fresh mirror had no planner stats —
  `v_priority_queue_band_counts` took 4.7s and the enriched view ~4.9s until I
  ran `ANALYZE lcc_property_owner_facts` → now **0–50ms**. ADD `ANALYZE
  public.lcc_property_owner_facts;` to the end of
  `lcc_finalize_property_owner_facts()` so every future sync refreshes stats
  (17.8k-row bulk upserts will mislead the planner again otherwise).
- The handler's EXACT select-column list runs clean in SQL against the live
  enriched view (all R6 columns present), instantly.

The bug — `GET /api/admin?_route=priority-queue` (any params, even
`band=P0&limit=5`) returns `{"error":"Internal server error"}` (the
withErrorHandler generic catch). Decisive evidence: **Supabase API logs show
the handler's two PostgREST calls (v_priority_queue_enriched +
v_priority_queue_band_counts) NEVER ARRIVE** during these 500s — the throw is
in `handlePriorityQueueList` BEFORE `Promise.all`, or in something only this
route touches. Meanwhile `?_route=priority-band` (same file, same authenticate,
same opsQuery import) returns 200. Frontend + server are confirmed the R6
build (`?v=377aae222912`, ops.js contains the R6 markers).

## Task
1. Read the Railway runtime logs for the stack trace (the withErrorHandler
   catch almost certainly console.errors it) and fix the throw. Suspects to
   check first given "before the queries": something in the R6 diff between
   `authenticate(...)` and the `Promise.all` — e.g. a helper referenced but
   not imported/hoisted in the deployed bundle path, a syntax-level issue in
   the selectCols/itemsPath construction that only this route executes, or
   `attachPqOppState` being hoisted/реordered. `node --check` passed, so it's
   a runtime reference, not syntax.
2. Add the `ANALYZE` to `lcc_finalize_property_owner_facts()` (migration
   update + apply note), per above.
3. While in there: the handler runs items + band-counts in parallel and dies
   wholesale if either fails — make band-counts soft-fail (chips empty, items
   still render) so the queue page can never hard-down on a counts hiccup.

## Verify
- `GET /api/admin?_route=priority-queue&limit=30` → 200 with counts incl.
  P0.4=348/P0.5=16/P-BUYER=21 and items carrying `resolve_reason`/
  `resolve_true_owner_name`/`resolve_is_connected`.
- Priority page renders: P0 heroes ("Log touch →"), P0.4 rows with
  "Resolve owner →" + context line, P-BUYER rollups intact.
- No regression on priority-band / detail banner.
