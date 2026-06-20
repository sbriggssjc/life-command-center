# Claude Code prompt — UW#1: county data DIGEST + capture (free underwriting-data lift)

> From the underwriting data-quality audit (UNDERWRITING_DATA_QUALITY_AUDIT_2026-06-20.md). The
> county channel RUNS and the data is INGESTED — the gap is DIGEST (propagation into the property
> fields underwriting reads) plus a narrow scraper-capture gap. Receipts-first; gated; reversible;
> fill-blanks only; route every write through the provenance gate; never clobber curated data.

## Grounding (live, 2026-06-20 — verify before building)
- gov: `parcel_records` 10,819 rows, `total_assessed_value` populated on **85%**;
  `property_public_records` links record_type ∈ {deed, entity, parcel, tax}; **7,267 properties
  linked to a parcel**. gov.properties.assessed_value = **1%**, land_acres 13%, year_built 30%,
  base_year_taxes 0%, expenses 1%. **6,364 gov properties are immediately backfillable** with
  assessed value (linked parcel has it, property is NULL; +156 already have it).
- gov `parcel_records.land_area_acres / year_built / zoning / building_sf` are **0%** populated —
  the assessor scraper grabs assessed value but drops the physical attrs.
- dia: digests tax/assessed fine (properties.assessed_value 75%) but `parcel_records` is thin
  (1,555); dia parcel_number 8%, land_area 27%, year_built 28% — a genuine ingest thinness, plus
  any linked-but-undigested rows.

## Part A — DIGEST (free, immediate; the headline)
A propagation pass + a forward path so county data lands on the property record:
1. **gov assessed/tax backfill** — for each property linked to a parcel (via
   `property_public_records` record_type='parcel') whose property field is NULL, propagate
   `parcel_records.total_assessed_value → properties.assessed_value` (+ `assessment_year` → a
   tax/assessment year field if present), and `tax_records` (tax_amount / delinquent_amount /
   payment_status, linked via record_type='tax') → the property tax fields. Route through
   **`lcc_merge_field` with `source='county_records'`** at a priority that OUTRANKS the aggregators
   (costar/rca) — county is authoritative for assessed/tax — but NEVER above manual. Fill-blanks
   only; do not overwrite a non-null curated value. Expected: ~6,364 gov assessed-value fills
   (1% → ~52%).
2. **dia parallel** — same propagation where dia properties are linked to a parcel/tax record but
   the property field is NULL (smaller set; dia tax digest mostly works already — find the residue).
3. **Forward path** — ensure the county→property propagation runs on every new county-record
   ingest (a propagation function/cron, mirroring the existing deed-grantee propagation R51 /
   `deed_propagation_log` scaffold which shows 0 rows = never run). Reversible (provenance rows +
   a backfill log). Register any new `source='county_records'` field rules in
   `field_source_priority` so `v_field_provenance_unranked` stays 0.

## Part B — CAPTURE (scraper enhancement; the physical attrs)
The assessor scraper that fills `parcel_records.total_assessed_value` drops the physical attributes
the SAME assessor record carries. Extend the parcel/assessor capture to populate
`parcel_records.land_area_acres` (+ land_area_sf), `year_built`, `zoning`, `building_sf`,
`property_class` where the assessor page exposes them — then Part A's digest carries them onto
properties (land_acres, year_built, zoning, building_size). No new source; richer capture from the
source already hit. Gate Part B behind a small sample verify (the values parse correctly) before a
broad re-scrape.

## Boundaries / gate
- **Ground first**: confirm the exact link join (`property_public_records.record_id → parcel_records`
  / `tax_records` PK), the property field names, and whether a county-propagation function already
  exists before writing a new one. Report the dry-run backfill counts per domain to the gate BEFORE
  the real write.
- Fill-blanks only; provenance-gated; county_records priority above aggregators, below manual;
  reversible; ≤12 api/*.js; dia/gov pipelines otherwise untouched.
- My gate: dry-run counts match the grounding (~6,364 gov), real write lifts assessed_value 1% →
  ~50%+ without clobbering any curated value, provenance rows written, idempotent re-run = 0,
  load-bearing caches rebuild clean. Part B verified on a sample before broad re-scrape.
