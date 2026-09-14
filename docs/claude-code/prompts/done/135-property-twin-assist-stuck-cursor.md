# Prompt 135 — PROPERTY_TWIN_ASSIST is ON but silently stalled after 200 (never paginates)

## Finding (Cowork dry-run, 2026-08-26)
`GET /api/property-twin-assist-tick?limit=200` on the live app:
```
enabled:true, flag_state:on, pending:1095, annotated_existing:200, fresh:0,
deterministic_decisive:0, llm_residue:0, bulk_confirmable_merges:0
```
And `lcc_clean_assist_proposals` (source `property_twin_assist`): **total 200, last_run 2026-08-19
05:45, last_7d 0.** So the assist ran ONCE, annotated the first 200 pending twin-review rows, and has
produced **nothing in the 7 days since** while **1,095 rows are pending** — the nightly cron fires,
writes 0, and looks healthy (the silent-failure class this repo keeps hitting).

## Root cause
`handlePropertyTwinAssistTick` (`api/admin.js`) builds its working set as
`fetchPendingTwinRows(Math.max(limit, 200))` → **the first ~200 pending rows** → then drops
`annotated.has('twin:dia:'+r.id)`. The 200 already-annotated ARE those first 200, so `fresh` is
permanently 0 and the tick no-ops. It never reaches rows 201–1095. `fetchTwinAssistAnnotated()` is also
likely capped (~200), so `annotated_existing` under-reports too.

## Ask
Make the working-set selection **advance past the annotated window** so the assist drains the whole
pending backlog over successive runs, bounded per run.

- **Exclude annotated at the QUERY, not in JS after a fixed 200-row pull.** Either (a) push the
  "not already annotated" predicate into `fetchPendingTwinRows` (anti-join / `NOT IN` against the
  annotated set or a `left join ... is null`), or (b) keyset-paginate by the review-row ordering key
  (closest-first `id`/distance) with a stored cursor, so each run starts after the last annotated row.
  Option (a) is simplest and matches the "fresh = pending − annotated" intent.
- **Keep it bounded + honest:** cap per run (existing `PT_ASSIST_BATCH`/budget), and report
  `pending`, `annotated_total` (uncapped count), `fresh_this_run`, `remaining` so a run that legitimately
  finds nothing-new is distinguishable from one that can't see past a window. `annotated_existing` must be
  the TRUE total, not a 200-capped read.
- **Ordering:** preserve closest-first (highest-likelihood twins annotated first) — this is a
  prioritization assist, so the ORDER matters; just don't let the window cap it.

## Guard
Add/extend a test asserting that when annotated ⊇ the first page, the tick still selects unannotated rows
from deeper pages (i.e. `fresh > 0` while `pending > annotated_total`). This is the exact silent-stall the
dry-run caught.

## Verify
- After deploy: `GET …?limit=200` shows `fresh > 0` (≈ up to the batch cap) while pending > annotated.
- Over a few nightly runs, `property_twin_assist` proposal count climbs past 200 toward 1,095; `last_7d`
  is non-zero. Assert on the proposal-count DELTA, not the flag state.
- Still annotation-only — never calls `dia_merge_property_reversible`; merge stays a human verdict.

## Deploy
JS-only (Railway redeploy). No migration unless a cursor table is added. Commit with the repo trailer.

## Note (doc reconciliation, no code)
The sweep that found this also found **9 of 10 assist flags are already `on`** — the LOCAL-MODEL-LEVERAGE-MAP
"BUILT BUT DORMANT / flip for fast leverage" section is stale. The remaining `*_ASSIST` lanes
(`MATCH_DISAMBIG_ASSIST`, `W9_3_SF_ASSIST`, `W8_U2_DUP_PAIRS`, `W9_2_REACHABILITY_HARVEST`,
`W8_U5_NAMING_HYGIENE`, `W8_U1_JUNK_PRESCREEN`) are ON and write to their own lane tables — each needs the
same production-health check (recent write delta, not `state=on`). Worth a follow-up sweep.
