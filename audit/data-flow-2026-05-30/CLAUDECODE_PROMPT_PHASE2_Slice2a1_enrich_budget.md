# Claude Code — Phase 2 Slice 2a.1: decouple the enrich budget from ingest

## Why (grounded live 2026-06-10)
Slice 2a's `walkPhase` (api/_handlers/folder-feed.js ~line 501) runs the ingest
phase first, then enrich. Both phases share ONE folder cap and ONE time budget:
```js
while (queue.length && report.folders_walked < limitFolders && phaseWalked < folderBudget) {
  if (Date.now() - startedAt > TIME_BUDGET_MS) break;
  ...
}
```
Because `report.folders_walked < limitFolders` is a SHARED counter and ingest goes
first, enrich gets only `limitFolders - (ingest folders walked)` of folder budget,
and only whatever of the 22s time budget ingest left. Live result on the cron
(`limit_folders=8`): ingest walks its ~6 On Market folders and, while the On Market
backlog is draining, consumes the full 22s STAGING — so **enrich walks ~0 folders
per tick until the backlog clears, then only 1–2**. PROPERTIES (thousands of
folders) barely moves. Enrich is functionally correct (verified: it attached an OM
to existing dia property 29841, no create) — this is purely a throughput-coupling
fix so the enrich crawl actually progresses in parallel.

## Unit 1 — independent per-phase FOLDER budgets
`report.folders_walked` should be a REPORTING counter only, not a gate. Drive each
phase by its OWN budget so enrich's `enrichLimitFolders` is independent of how many
folders ingest walked:
- In `walkPhase`, drop `report.folders_walked < limitFolders` from the `while`
  condition; keep `phaseWalked < folderBudget` (+ the time guard, see Unit 2).
  Still `report.folders_walked++` inside for reporting.
- Call sites unchanged: `walkPhase(ingestRoots,'ingest',limitFolders)` then
  `walkPhase(enrichRoots,'enrich',enrichLimitFolders)`. Now ingest can walk up to
  `limitFolders` AND enrich up to `enrichLimitFolders` (default 4) in the same tick,
  regardless of each other.

## Unit 2 — reserve a TIME slice for enrich
Ingest still goes first, but must not be able to consume the entire tick. Split the
time budget so enrich always gets a guaranteed slice:
- Add `const ENRICH_TIME_RESERVE_MS = parseInt(process.env.FOLDER_FEED_ENRICH_RESERVE_MS || '7000', 10);`
  (overridable; ~7s reserved for enrich by default).
- Pass a per-phase deadline into `walkPhase` (or compute inside): ingest runs until
  `startedAt + (TIME_BUDGET_MS - ENRICH_TIME_RESERVE_MS)`; enrich runs until
  `startedAt + TIME_BUDGET_MS`. Replace the bare `Date.now() - startedAt > TIME_BUDGET_MS`
  break with a per-phase `Date.now() > phaseDeadline` break (both in the folder loop
  AND the inner file loop — `processFolder` needs the phase deadline too; thread it
  through).
- Rationale: folder LISTING is cheap (~2s), so even a ~7s enrich reserve lets it
  list + classify 2–3 PROPERTIES folders/tick (the discovery work) and opportunistically
  stage an enrich OM when a tick is light. Ingest keeps the majority of the budget and
  always goes first, so it never starves.

Edge: do NOT start a NEW `stageOmIntake` when the phase deadline is already passed
(the loop's deadline check already guards the next file — keep that; a stage that
starts just under the deadline is fine, same as today's behaviour).

## Tests / house rules
- Unit test with a mocked clock / `FOLDER_FEED_TIME_BUDGET_MS` +
  `FOLDER_FEED_ENRICH_RESERVE_MS`: an ingest phase that exhausts its time slice still
  leaves the enrich phase walking ≥1 folder; enrich's folder budget is honored
  independent of ingest's walked count.
- Existing Slice-1/2a tests stay green (ingest-only, enrich-inert-when-unset).
- `node --check`; ≤12 `api/*.js` (handler only, no migration); ships on Railway redeploy.

## After deploy (Claude/Cowork)
I'll run a dry-run with the cron's `limit_folders=8` and confirm BOTH
`ingest_roots` folders AND ≥1 `enrich`/PROPERTIES folder are walked in the same tick,
then watch a couple of cron ticks land PROPERTIES enrich rows.

## Note — bulk acceleration (separate, later)
For a one-time fast sweep of the whole PROPERTIES tree, the local backfill script
would need an enrich-mode flag first (today it stages ingest-mode = create-capable,
unsafe for PROPERTIES). Defer unless Scott wants the bulk done fast — the cron crawl
covers steady state once this fix lands.
