# Claude Code Prompt — Fix the App-Side Census Writer That Inflates `properties` Treatments/Patients (Dialysis_DB)

## Why
The comps/census cleanup reconciled 2,080 physically-impossible `properties` census rows (e.g. 31,356 TTM
treatments on 12 chairs → 201 patients; Waterbury 124,800 → 800) down to the authoritative `medicare_clinics`
CCN values. That treated the symptom. This fixes the **root cause** so the inflation stops recurring.

## What's established (verified live — don't re-litigate, but confirm before changing code)
- **The standing DB propagation trigger is NOT the culprit and is safe to leave.** `trg_medicare_propagate_to_property`
  (AFTER INSERT/UPDATE on `medicare_clinics`) is strictly **fill-NULL/fill-zero**:
  `ttm_total_treatments = COALESCE(NULLIF(p.ttm_total_treatments,0), NULLIF(NEW.ttm_total_treatments,0), NULLIF(NEW.estimated_annual_treatments,0))`,
  and only touches rows where the target is NULL/0. It can't overwrite — which is exactly why it can't *heal*
  an already-inflated value, but it also isn't what wrote one.
- **No DB function both reads `facility_patient_counts` and writes `properties`** — so the inflating writer is
  **application code** (a CMS / patient-counts ingest job in `api/sync.js`, a Python pipeline, or similar), not
  a trigger. That writer CAN overwrite (that's how the bad values landed).
- **`facility_patient_counts` is corrupt at the source:** ~20 rows per CCN with only 4–6 distinct
  `total_treatments`, and some rows physically impossible (`max` up to 1,137,240; the ×N pattern e.g. 5,960
  vs 929,760). It has period/provenance structure to dedup on — `year, snapshot_date, window_start/end, source,
  ingest_source, metric_type, corrected_total_patients, data_quality_flag, needs_manual_review` — so a writer
  that SUMs or picks a bad row across these produces garbage.
- **Authoritative source = `medicare_clinics`** (live-CCN values), the same source the reconciliation used.

## Implement
1. **Find the app-side writer.** Grep the repo for writes to `properties.ttm_total_treatments` /
   `properties.latest_patient_count` and for `facility_patient_counts` → `properties` propagation (CMS /
   patient-count ingest, backfills, `dia_*` enrichment). Identify every path that sets those two columns.
2. **Fix the aggregation.** The writer must resolve **one authoritative value per property**, never a SUM/max
   across the duplicate snapshot rows:
   - Prefer `medicare_clinics` (live-CCN; for a genuine multi-CCN campus, sum across the *distinct live CCNs*,
     not across duplicate `facility_patient_counts` snapshots).
   - If falling back to `facility_patient_counts`, pick the single best row per (property, metric) — latest
     `snapshot_date`/`year` for the right `metric_type`/`source`, excluding `needs_manual_review` /
     bad `data_quality_flag` — and prefer `corrected_total_patients` when present. Deduplicate first.
3. **Plausibility guard before write (defense-in-depth).** Before writing census to `properties`, enforce the
   same cap the comp uses: implied census = `ttm_total_treatments / 156` must be ≤ ~10 × `total_chairs`
   (and treatments-per-chair within a physical max). A violation must NOT be written — route it to
   `dia_census_review_queue` (already exists) with the numbers. Add this as a shared helper the writer calls,
   and consider a lightweight `BEFORE UPDATE` guard on `properties` so no path can ever persist an implausible
   census again.
4. **Allow correction, not just fill-NULL.** The writer should be able to REPLACE an existing implausible value
   with the authoritative one (with provenance), so the system self-heals going forward — unlike the fill-NULL
   trigger. Never overwrite a verified human/master value.
5. **Dedup `facility_patient_counts`.** Collapse the ~20 rows/CCN to one row per (ccn, period/metric) keeping the
   best-provenance, non-inflated row; flag the ×N inflated duplicates via `data_quality_flag` (don't hard-delete).
   Idempotent, reversible, snapshot to a backup table.

## Verify / report
- The reconciled values hold (Terre Haute 23423 = 13 chairs / 62 patients; Coos Bay 12/41; Waterbury 60/136;
  Birmingham 20/36) and re-running the ingest does NOT re-inflate them.
- Feed a deliberately-inflated `facility_patient_counts` row through the writer in a dry run → it's capped/queued,
  not written.
- Report: the writer file(s)/function(s) changed, the dedup counts on `facility_patient_counts`, and the
  before/after count of implausible `properties` census rows.

## Guardrails
- Fill-NULL / correct-with-provenance / flag — never hard-delete; back up every mutated row. Idempotent,
  dry-run first, reversible. Don't change `trg_medicare_propagate_to_property` (it's correct) except, optionally,
  to let it correct an implausible value under the same guard. Coordinate with `dia_census_review_queue`.
