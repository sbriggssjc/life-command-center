# DIA-PROPAGATOR1 — the full-data propagation rewrites every property every pass and logs ~1M junk learning rows a day; make it change-driven, once-per-miss, and owner-aware

**Repo root: `DialysisProject` (`C:\Users\scott\DialysisProject`) — NOT life-command-center.** This prompt is the one exception to
"Dialysis_DB objects live in life-command-center": it changes Python that WRITES rows, not schema. Do not add migrations here; if a
schema change is needed, say so and stop — it goes to `life-command-center/supabase/migrations/dialysis/`.
**Filed:** 2026-09-18 (Cowork round 45; LCC backlog `DIA-PROPAGATOR1`, PL-60, PL-63; LCC checklist Q37). **Owner:** `src/app_utilities.py`
(`schedule_tasks`, `run_full_data_propagation`), `src/full_data_propagator.py`, `src/ai_scrubber.py` (~4500, `safe_log_learning(...
notes="invalid field")`), `src/core_utils.py` (~3373, same), `financial_propagator.py`, `tests/`.

## Measured (Cowork, Supabase edge logs + SQL on Dialysis_DB `zqzrriwuavgrquhisnoa`, 2026-09-18)
- Writer: `python-httpx/0.28.1` from Scott's PC. Today: **998,911 POST `learning_logs`** — 100% `source='ai_scrubber'`,
  `notes='invalid field'`, `"table"='facility_patient_counts'`, `field`/`field_name`/`property_id` NULL, values like `0.11`,
  `0.2`, `0.65`, `base_payer_mix_state=national`, `372060.00000000006` (payer-mix / revenue keys not in `schema_map`, so the
  scrubber drops each and logs it, once per key per row per pass). Every day since at least 09-02 is 100% `invalid field`.
  `learning_logs` = **12,269,613 rows / 2,247 MB** (DB 8,837 MB).
- Same client, today: **126k PATCH `properties`** (7,099 of 11,837 rows had `updated_at` move; ~4 PATCHes per property per
  hour at peak), ~200k PATCH `facility_patient_counts`, ~200k PATCH+POST `clinic_financial_estimates`.
- Shape: a fleet pass of ~8–11 h (00:00→11:04 UTC, 13:06→20:33 UTC), re-triggered by `schedule.every().day.at("02:45")`
  `run_full_data_propagation` and by scheduler restarts. It ends on its own; it does not converge to "nothing to write".
- Cumulative `pg_stat_statements` PATCH families on `properties` from this client: `public_record_count + tax_*` (972k calls),
  `estimated_annual_revenue` (934k), `building_size` (837k), **`true_owner_id` (≥ 700k across four statement variants)**.
- Cost to the other readers: `properties.updated_at` no longer means anything (life-command-center had to switch its sidebar-send
  evidence to `last_ingested_at`); any writer that trusts "row unchanged since X" is wrong.

## Guiding principle (Scott, 2026-09-18)
A functional, accurate source of truth for every field we track. A write belongs in that database only when (a) an input changed,
(b) the row says which input and when, (c) the column has exactly one writer of record.

## Build
1. **Compare before write.** In the propagators, read the target row's current values and PATCH only the columns whose new value
   differs (numeric tolerance stated in code, e.g. 0.5%); skip the PATCH entirely when nothing differs. `updated_at` must move only
   on a real change. Count skipped vs written per table per run and print it.
2. **Schema misses are run errors, not learnings.** Replace the per-row `safe_log_learning(... "invalid field")` in
   `ai_scrubber.py` and `core_utils.py` with one `ingestion_run_errors` row per (run, table, field) carrying the first offending
   value and a count. `learning_logs` is for learned corrections only — enforce that with a guard in `safe_log_learning`
   (refuse `notes='invalid field'`).
3. **Fix the misses themselves.** The keys being dropped (payer-mix fractions, `base_payer_mix_state`, the revenue figure) are the
   propagator's own outputs — either they belong on `facility_patient_counts` / `clinic_financial_estimates` (then name the column and
   STOP — schema goes to life-command-center) or they belong nowhere (then stop producing them). Say which, per key.
4. **Owner-of-record table.** List every column the propagation writes on `properties`, `facility_patient_counts`,
   `clinic_financial_estimates`, and for each name the single writer of record. `properties.true_owner_id` and `recorded_owner_id` are
   owned by the owner-resolution lane (life-command-center ORE / OWNERGAP guards) — **remove them from the propagator** unless the
   code proves it only fills NULLs from a source the lane does not have (then say so and keep it fill-blanks-only).
5. **Purge the junk, ledgered.** `DELETE FROM learning_logs WHERE notes = 'invalid field'` in batches (12.3M rows), recording the
   before/after counts and bytes in `ingestion_run_errors` or the run log; `VACUUM` after. Nothing else in `learning_logs` is touched.
6. **Cadence.** Full pass weekly (Sunday) or event-driven off `ingestion_log.max_ingested_at` per source table, not daily; the
   daily slot becomes "propagate rows whose inputs changed since the last run". Keep the propagation lock.
7. **Tests** for: compare-before-write skips an unchanged row; a schema miss produces one `ingestion_run_errors` row and zero
   `learning_logs` rows; the guard refuses `invalid field`; the owner columns are not in the propagator's write set.
8. **Report:** per table, rows examined / written / skipped on one real pass after the change; `learning_logs` row count and size
   before/after the purge; the owner-of-record table; the new cadence; which keys from step 3 became columns (→ life-command-center)
   and which were dropped.

⛔ No schema changes in this repo. ⛔ No deletes except step 5's `invalid field` rows. ⛔ Do not touch `is_active`, `expiration_state`,
`recorded_owner_id`, `true_owner_id` values. ⛔ STATUS entry in life-command-center is Cowork's job — put the report in this repo's PR
body and the response doc. Repo-hopping is the incident class this fixes; stay in DialysisProject.

**Parked:** one line each.
