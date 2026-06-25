# Claude Code (DialysisProject) — DIAGNOSE why patient-count movers won't refresh (snapshot_date no-op upsert) + batch the slow derive

## STOP — this is a DIAGNOSTIC-first round, not a blind fix

The last two CMS rounds fixed the real infrastructure:
- The hang is gone (no-timeout `pd.read_csv(url)` → `_safe_get`).
- `medicare_ingestion` dropped 4.8h → **35 min** (N+1 property-lookup batched).
- `patient_counts` now runs FIRST (reorder), so it executes inside the budget.

But the freshness-critical outcome STILL did not happen, and grounding the dia DB
(Dialysis_DB `zqzrriwuavgrquhisnoa`) live on 2026-06-25 shows **it is NOT a write
bug to keep chasing** — it's a snapshot-key no-op. Confirm the root cause below,
then make the minimal correct change. Do not thrash.

## What the live data proves (so you don't re-investigate the wrong layer)

`facility_patient_counts`:
- **144,964 rows — UNCHANGED by the catch-up run** (exact pre-run count); `0` rows
  with `created_at::date = today`; `max(created_at) = 2026-05-14`.
- Snapshots are a **backfilled historical series keyed by CMS reporting period**,
  NOT a live monthly feed. `snapshot_date` values (desc): `2026-12-31`,
  `2025-12-31`, `2025-03-01`, `2025-02-01`, `2025-01-01`, `2024-12-31`,
  `2024-12-01` … `2024-07-01`. **Every one of them was `created_at` in the
  April–May 2026 backfill** (2026-04-02 → 2026-04-05, one straggler 2026-05-14).
  The newest *monthly* period present is **`2025-03-01`**; everything after is
  just year-end markers (`2025-12-31`, `2026-12-31`).
- The upsert key is `(medicare_id, snapshot_date)`
  (`patient_count_ingestor.py:714` `_rest_upsert_facility_counts(conflict=
  ("medicare_id","snapshot_date"))`).

The run's own summary corroborates: `derived_ok=7534`, **`attempted_writes=0`,
`writes_confirmed=0`**, "⚠️ Processed records without any confirmed writes." The
log line `[DATA] New facility_patient_counts inserted: 7534` is a **derivation
counter, not a DB insert count** — it is contradicted by `writes_confirmed=0` and
by the untouched row count.

**Conclusion to confirm:** the step derives ~7,534 counts for a `snapshot_date`
that **already exists**, so the upsert is a no-op (ON CONFLICT DO NOTHING / skip),
`created_at` never advances, and month-over-month "Top Movers" cannot change.
Re-running ingestion will NEVER refresh movers while the derived `snapshot_date`
resolves to an already-loaded period.

## Unit 1 — DIAGNOSE the `snapshot_date` derivation (read-only first; report findings)

Use the Explore agent / read the code. Answer these precisely, with file:line and
the actual values, BEFORE changing anything:

1. **How is `snapshot_date` computed** for a patient-count row in
   `ingest_patient_counts` / `patient_count_ingestor.py`? Is it:
   (a) derived from the CMS source file's reporting period/column, or
   (b) a fixed/synthetic date (e.g. current year-end `2026-12-31`, `date.today()`,
       or a hardcoded period)?
   Show the exact derivation.
2. **What snapshot_date did THIS run derive** for the 7,534 records? (Add a debug
   log or trace it.) Is it `2026-12-31` (already present, 7,521 rows) — explaining
   the no-op — or something else?
3. **Does the current CMS data source actually expose a reporting period newer
   than `2025-03-01`?** Inspect the bulk CSV's date/period columns (the file the
   run fetched — `CMS records fetched: 7557`). Is there genuinely newer patient
   data available that we're failing to capture, or is `2025-03` / the year
   markers the freshest CMS publishes for this dataset?
4. **What is the upsert conflict behavior** on key collision — DO NOTHING, or is
   the write skipped earlier (which is why `attempted_writes=0`, not
   "attempted-but-skipped")? Identify the exact guard.

**Report these four answers.** They decide everything downstream:

- **If (case A) CMS DOES publish a newer period and we're deriving the wrong/stale
  `snapshot_date`** → the fix is to derive `snapshot_date` from the source period
  so a genuinely-new snapshot INSERTs. Implement that minimal fix; a re-run should
  then add a new period and movers come alive. Keep the upsert idempotent
  (re-running the same period stays a no-op — that's correct).
- **If (case B) CMS does NOT publish anything newer than what's loaded** → there is
  no new data to ingest; the ingestion is behaving correctly. Do NOT invent a
  synthetic newer snapshot (that would fabricate movement). Instead, report this
  clearly so the dashboard side can be reframed (Cowork will relabel the dia
  "Top Movers"/freshness tiles to the real cadence — out of scope for this repo).

Pick the branch the evidence supports; don't implement both.

## Unit 2 — batch the slow `patient_counts` derive (perf; independent of Unit 1)

The catch-up run still hit `CMS_RUN_TIMEOUT_SEC` (21,519s, ~6h) **before
`aux_cms_tables`**, even though `medicare_ingestion` is now 35 min and
`patient_counts` ran first. So `patient_counts` itself is now the slow step —
~5h to derive ~7,534 records, i.e. per-row I/O (the same N+1 shape we just killed
in `medicare_ingestion`).

- Profile the per-record path in `ingest_patient_counts` / `patient_count_ingestor.py`:
  look for per-clinic Supabase round-trips (e.g. a `select … =eq.<medicare_id>`
  per record for existing-row checks, regional-average lookups, property links,
  or the existence probe that drives the no-op skip).
- **Batch them** into `.in_(...)` chunks (~500–1000, PostgREST cap-aware) loaded
  into in-memory maps, then resolve per-record from the maps — the exact pattern
  used for the `medicare_ingestion` fix. Goal: `patient_counts` finishes in
  minutes, so the full pipeline (incl. `aux_cms_tables` + optional sources) clears
  within budget.
- This is worth doing **regardless of Unit 1's outcome** — even a correct no-op
  shouldn't take 5h, and it currently starves the rest of the pipeline.

## Unit 3 — once Unit 2 lands, restore the run cap

`CMS_RUN_TIMEOUT_SEC` was raised to 14400s (4h) for the catch-up. After Unit 2
makes `patient_counts` fast, document bringing it back toward ~90 min for
steady-state (env-driven; don't hardcode). Confirm a steady-state `--force-run`
completes ALL steps (reaches `aux_cms_tables` and the optional sources) without
hitting the cap.

## Boundaries / verify

- DialysisProject (Python), feature branch per its CLAUDE.md; end with merge +
  test commands.
- `python -c "import src.run_cms_ingestion; print('OK')"`;
  `python -m pytest tests/ -x -q` (note pre-existing sandbox-cred failures,
  unchanged).
- **Real proof depends on the branch:**
  - Case A: a local `--force-run` where `patient_counts` inserts a snapshot for a
    NEW `snapshot_date` (`facility_patient_counts` row count increases; a new
    period appears), and the full run completes without the cap. Then Cowork
    confirms movers refresh on the dia Overview.
  - Case B: report the evidence that no newer CMS period exists; prove the run now
    COMPLETES all steps within budget (Unit 2/3) even though row count correctly
    stays flat. Cowork then reframes the dashboard tiles.
- Don't fabricate a newer snapshot to force movement (Case B); don't regress the
  hang-guard or the medicare_ingestion batching.

## Documentation

Update DialysisProject CLAUDE.md (CMS section): record that `facility_patient_counts`
is a CMS-reporting-period series keyed `(medicare_id, snapshot_date)`; re-running
only adds rows when the source exposes a NEW period; the "inserted: N" log is a
derivation counter, not a DB insert count (use `writes_confirmed` / the row-count
delta as truth); and `patient_counts` per-record lookups must be batched (no N+1).

## Bottom line

The infra is fixed; movers don't refresh because the derived `snapshot_date`
already exists (no-op upsert) and the newest CMS period in the data is `2025-03`.
Diagnose whether a newer CMS period actually exists (→ fix the date derivation so
it inserts) or not (→ report it; reframe the dashboard, don't fabricate). Either
way, batch the now-slow `patient_counts` derive so the full pipeline finishes in
budget.
