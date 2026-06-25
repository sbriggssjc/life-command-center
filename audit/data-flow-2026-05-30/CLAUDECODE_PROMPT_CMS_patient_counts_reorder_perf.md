# Claude Code (DialysisProject) — CMS: run patient_counts FIRST + kill the medicare_ingestion N+1 (so movers refresh)

## Why (root-caused live 2026-06-25 from the completed run + dia DB)
The download-timeout fix worked — the run no longer hangs; it completed `medicare_ingestion` and
terminated. BUT the freshness-critical data still didn't refresh:
- `facility_patient_counts` latest row = **2026-05-14** (0 inserted this run) → Top Movers + the
  "last ingestion" freshness date are still stale.
- The run took **4.8 hours (17,283s)** and hit `CMS_RUN_TIMEOUT_SEC`; the abort fired **"before
  step 'aux_cms_tables'"**.
- Step order (`run_cms_ingestion.py:815`): `medicare_ingestion`(1) → `aux_cms_tables`(2) →
  **`patient_counts`(3)** → … So **`medicare_ingestion` alone consumed the whole 4.8h budget, and
  every later step — including `patient_counts` — never ran.** That's why patient counts have been
  frozen at May 14 (the dedicated step hasn't completed since).
- Why `medicare_ingestion` is so slow: an **N+1 per-row Supabase query explosion** — the run log
  shows hundreds of one-at-a-time `properties` selects (`select=recorded_owner_id&property_id=eq.<X>`)
  in the match/retry pass (6,559 retries). Clinic data itself is current (8,535, only 1 changed),
  so this 4.8h is almost entirely wasted per-row I/O.

Net: the pipeline spends 4.8h re-checking unchanged clinics row-by-row and never reaches the one
step (patient_counts) that actually drives the stale dashboards.

## Unit 1 — run `patient_counts` EARLY (the immediate win; unblocks movers)
Reorder so **`patient_counts` runs first (or right after a fast preflight), before
`medicare_ingestion`** and the slow retry/aux steps. Rationale: `ingest_patient_counts` only needs
the existing `medicare_clinics` rows (8,535 already present) to attach counts — it does NOT depend
on the facility-listing upsert. So running it first refreshes the movers time-series **within
budget every run**, regardless of how slow the later steps are.
- Keep correctness: if a small number of brand-new clinics need their first patient count, that's
  fine to pick up on the next run (or leave a lightweight second patient_counts pass at the end,
  guarded so it's cheap when nothing's new). The point is the **refresh of existing clinics must
  not be starved by a timeout** anymore.
- Verify the reorder doesn't break a real dependency (patient_counts → medicare_clinics exists: ✓;
  nothing earlier writes the clinics patient_counts needs).

## Unit 2 — kill the N+1 in `medicare_ingestion` + `retry_unmatched_clinics` (the durable fix)
The match/retry pass issues one `properties` select per clinic (`property_id=eq.<X>` … repeated
thousands of times). Batch them:
- Collect the candidate ids and fetch in **batched `.in_(...)` queries** (chunks of ~500-1000,
  PostgREST cap-aware) into an in-memory map, then resolve per-clinic from the map — instead of a
  round-trip per row. Same for any other per-row lookups in `_run_retry_unmatched` /
  `propagate_cms_to_properties` that show up in the log as `op=select … =eq.<id>` loops.
- Goal: `medicare_ingestion` drops from ~4.8h to minutes when the clinic data is unchanged
  (the common case — change-detection already says 0 inserts / 1 update). This lets the WHOLE
  pipeline (incl. aux + propagation + optional sources) finish within a sane budget.

## Unit 3 — interim run-cap for the catch-up
`CMS_RUN_TIMEOUT_SEC` is currently 5400s (90m) — too small for a first catch-up even after Unit 1,
and the run genuinely needs to complete the backlog once. Raise it (env, e.g. 4h) for the catch-up
local run; document bringing it back to ~90m once Unit 2 makes a steady-state run fast. (With
Unit 1, patient_counts refreshes regardless of the cap; Unit 3 just lets the full backlog clear.)

## Boundaries / verify
- DialysisProject (Python), feature branch per its CLAUDE.md; end with merge + test commands.
- `python -c "import src.run_cms_ingestion"`; `python -m pytest tests/ -x -q` (note pre-existing
  sandbox-cred failures, unchanged).
- Real proof — a local `--force-run` where: **`patient_counts` runs early and inserts a fresh
  snapshot** (`facility_patient_counts` max `created_at` = today), `medicare_ingestion` completes in
  minutes (not hours), and the run finishes without hitting the cap. Then Cowork confirms
  `facility_patient_counts` fresh + Top Movers / freshness unblock on the dia Overview, and the
  Railway cron (same code) now completes nightly.

## Bottom line
The timeout fix stopped the hang; this round makes the run actually deliver fresh data: run the
movers-critical `patient_counts` step FIRST so a slow tail can't starve it, and batch the N+1
property lookups so `medicare_ingestion` stops burning 4.8h re-checking unchanged clinics. Result:
patient counts refresh, Top Movers + freshness come back, and the nightly Railway cron completes.
