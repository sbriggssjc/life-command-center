# Dialysis Data Quality & Ingestion Fix Prompt

Send this to a Claude Code session with access to the Life Command Center repository and the Supabase Dialysis project (`zqzrriwuavgrquhisnoa`).

---

## Context

You are working on the Life Command Center (LCC), a PWA for net lease real estate brokers focused on dialysis clinic properties. The Supabase project `zqzrriwuavgrquhisnoa` contains the dialysis database. Key tables: `medicare_clinics`, `facility_patient_counts`, `clinic_financial_estimates`, `facility_cost_reports`, `properties`, `operators`, `available_listings`, `leases`, `loans`.

There are **8 data quality issues** that need to be addressed at the ingestion/database level. These are ordered by priority.

---

## Issue 1: Multi-Clinic-Per-Property Bad Matching

**Problem**: Multiple Medicare clinic IDs (CCNs) are mapped to the same `property_id` in `medicare_clinics`. Some are legitimate (same facility with two certifications — e.g., an in-center program and a home program at the same address), but many are clearly wrong (different cities/states, vastly different chair counts all linked to one property).

**Evidence**:
```sql
-- Shows properties with multiple clinics mapped — up to 8 per property
SELECT property_id, COUNT(*) as clinic_count,
  array_agg(DISTINCT facility_name) as names,
  array_agg(DISTINCT city) as cities,
  array_agg(DISTINCT state) as states,
  array_agg(number_of_chairs) as chairs
FROM medicare_clinics
WHERE property_id IS NOT NULL AND is_active = true
GROUP BY property_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC LIMIT 15;
```

**Required Fix**:
1. **Identify illegitimate matches**: Flag `medicare_clinics` rows where `property_id` links to a property in a different city/state than the clinic's address, or where the clinic name is clearly a different facility.
2. **Unlink bad matches**: Set `property_id = NULL` for incorrectly matched clinics.
3. **Consolidate legitimate multi-CCN facilities**: For same-address, same-operator clinics with different CCNs (e.g., in-center + home certifications), create a consolidation strategy:
   - Aggregate `number_of_chairs` (sum across CCNs)
   - Aggregate patient counts (sum across CCNs, but don't double-count)
   - Pick the primary CCN (highest chairs / in-center certification) as the "display" record
   - Store a `primary_medicare_id` or `is_primary_ccn` flag on `medicare_clinics`
4. **Create a matching quality score**: Add a `property_match_confidence` column (high/medium/low) based on address similarity, name similarity, and geographic distance.

---

## Issue 2: Payer Mix Data — Ingest CMS Cost Reports (HCRIS)

**Problem**: The `facility_cost_reports` table exists with columns for `medicare_revenue`, `medicaid_revenue`, `other_revenue`, and `total_patient_revenue` — but has **zero rows**. The `properties` table has `payer_mix_medicare_pct`, `payer_mix_medicaid_pct`, `payer_mix_private_pct` columns — also all NULL. We have no payer mix data for any clinic.

**Why this matters**: Payer mix is critical for revenue quality assessment. A clinic with 80% commercial patients generates ~2-3x the revenue per treatment vs. one with 80% Medicare. Current revenue estimates use a flat $66,300/patient rate regardless of payer, which dramatically understates high-commercial clinics and overstates Medicare-heavy ones.

**Data Source**: CMS publishes dialysis facility cost reports through the Healthcare Cost Report Information System (HCRIS). These are available at:
- https://data.cms.gov/ — search for "Renal Dialysis Facility Cost Report" or HCRIS
- The dataset contains: provider CCN, fiscal year, total revenue, Medicare revenue, Medicaid revenue, other (commercial/private) revenue, total costs, Medicare costs, treatments, patients, stations, FTEs

**Required Fix**:
1. **Download and parse HCRIS data**: Get the most recent available cost report data (typically 1-2 years behind; look for FY2022 or FY2023 data).
2. **Ingest into `facility_cost_reports`**: Match on `medicare_id` (= provider CCN). Populate: `total_patient_revenue`, `medicare_revenue`, `medicaid_revenue`, `other_revenue` (= commercial/private), `total_costs`, `medicare_costs`, `total_treatments`, `total_patients`, `dialysis_stations`, `fte_employees`, `operating_margin`, `cost_per_treatment`, `revenue_per_treatment`.
3. **Derive payer mix percentages**: Calculate and store on `properties` or a new `clinic_payer_mix` table:
   - `medicare_pct = medicare_revenue / total_patient_revenue`
   - `medicaid_pct = medicaid_revenue / total_patient_revenue`
   - `private_pct = other_revenue / total_patient_revenue`
4. **Update revenue estimates**: Adjust the flat-rate revenue model in `clinic_financial_estimates` to use payer-weighted rates:
   - Medicare: ~$260/treatment (CMS bundled rate)
   - Medicaid: ~$200/treatment (varies by state)
   - Commercial: ~$1,100/treatment (industry average from DaVita/Fresenius 10-Ks)
   - Formula: `estimated_revenue = (medicare_tx * $260) + (medicaid_tx * $200) + (commercial_tx * $1,100)`
5. **Populate the `v_property_rankings` payer mix fields**: The view already joins to `properties` for `payer_mix_medicare_pct`, `payer_mix_medicaid_pct`, `payer_mix_private_pct` — once the data is there, the Operations tab in the LCC dashboard will display it automatically.

---

## Issue 3: Patient Count Snapshot Data Quality

**Problem**: `facility_patient_counts` has data from two CMS snapshots — Oct 2023 and April 2024 — but the April 2024 `total_patients` values appear to be a different metric (possibly cumulative treatments or annual patients, not point-in-time census). 95% of shared clinics show normal 0.8-1.2x ratios between snapshots, but 16 show suspicious >2x jumps.

**Evidence**:
```sql
SELECT a.medicare_id,
  a.total_patients AS oct_patients,
  b.total_patients AS apr_patients,
  ROUND(b.total_patients::numeric / NULLIF(a.total_patients, 0), 2) AS ratio
FROM facility_patient_counts a
JOIN facility_patient_counts b ON a.medicare_id = b.medicare_id
WHERE a.snapshot_date = '2023-10-01' AND b.snapshot_date = '2024-04-01'
  AND b.total_patients::numeric / NULLIF(a.total_patients, 0) > 2
ORDER BY ratio DESC;
```

**Required Fix**:
1. Investigate the April 2024 source file to determine what `total_patients` actually represents in that snapshot.
2. If it's a different metric, rename the column or add a `metric_type` column to distinguish census vs. cumulative.
3. For the `medicare_clinics.latest_estimated_patients` field, ensure it pulls only from the reliable Oct 2023 snapshot (or whichever snapshot contains actual census data).
4. Currently only 914 of 8,469 active clinics have `latest_estimated_patients` populated — investigate why coverage is so low and backfill from `facility_patient_counts`.

---

## Issue 4: Missing Modality Flags on `medicare_clinics`

**Problem**: The columns `offers_in_center`, `offers_home_hemo`, `offers_peritoneal` on `medicare_clinics` are NULL for ~89% of clinics. The `v_cms_data` view works around this with name-pattern inference, but the underlying data should be fixed.

**Evidence**:
```sql
SELECT COUNT(*) as total,
  COUNT(offers_in_center) as has_ic,
  COUNT(offers_home_hemo) as has_hh,
  COUNT(offers_peritoneal) as has_pd
FROM medicare_clinics WHERE is_active = true;
```

**Required Fix**:
1. Re-ingest the CMS Dialysis Facility Compare dataset which has modality flags for all certified facilities.
2. Source: https://data.cms.gov/provider-data/dataset/23ew-n7w9 (Dialysis Facility Compare)
3. Map the CMS modality columns to `offers_in_center`, `offers_home_hemo`, `offers_peritoneal`.

---

## Issue 5: Historical Patient Data for Trends

**Problem**: `medicare_clinics` has columns `patients_last_year` and `patients_two_years_ago` — both are NULL for all 8,469 active clinics. This means the Operations tab shows no Patient Trends section and no YoY change indicators.

**Required Fix**:
1. If `facility_patient_counts` has multiple snapshot dates per clinic, use those to populate historical columns:
   - `latest_estimated_patients` = most recent reliable snapshot
   - `patients_last_year` = snapshot from ~12 months prior
   - `patients_two_years_ago` = snapshot from ~24 months prior
2. If only one snapshot exists, source additional historical data from CMS Dialysis Facility Compare archives (CMS publishes quarterly updates).
3. Create an update script that refreshes these columns whenever new snapshot data is ingested.

---

## Issue 6: Duplicate Financial Estimates

**Problem**: `clinic_financial_estimates` has multiple `is_latest = true` rows per clinic (one per estimation method — TTM, patient-based, chair-based). This was causing fan-out in the `v_cms_data` view (fixed with LATERAL join), but the underlying data should also be cleaned up.

**Required Fix**:
1. For each `medicare_id`, designate exactly ONE financial estimate as `is_primary = true` using this priority: TTM > patient-based > chair-based.
2. Ensure subsequent ingestion runs maintain the single-primary constraint.
3. Add a unique partial index: `CREATE UNIQUE INDEX ON clinic_financial_estimates (medicare_id) WHERE is_primary = true;`

---

## Issue 7: CMS Data Ingestion — CCN-as-Owner Bug

**Problem**: The CMS data ingestion script occasionally stores the Medicare CCN (clinic ID) as the `owner_name` in `medicare_clinics` instead of the actual facility owner. Three records were found with this bug: `052847` (FMC West Covina), `072555` (DaVita New Britain), `082502` (FKC Central Delaware). These were manually corrected and the `v_clinic_inventory_latest_diff` view was updated with a fallback to infer operator from facility name when `owner_name` is numeric.

**What was fixed already**:
- The 3 records were corrected: `owner_name` and `chain_organization` set to proper operator names.
- `v_clinic_inventory_latest_diff` view now has a CASE expression: if `owner_name` matches `^\d+$`, it falls back to `chain_organization`, then to facility name-based inference (FMC/FKC → Fresenius, DAVITA → DaVita, DCI → Dialysis Clinic Inc, USRC → US Renal Care).

**What still needs fixing**:
1. **Find and fix the ingestion script** that parses CMS data into `medicare_clinics`. Identify why `owner_name` gets populated with the CCN for some records and fix the field mapping.
2. **Audit all `owner_name` values**: Run `SELECT * FROM medicare_clinics WHERE owner_name ~ '^\d+$'` after each future ingestion to catch new occurrences.
3. **Add a constraint or trigger** to prevent numeric-only values from being stored as `owner_name`.

---

## Issue 8: Available Listings Missing Property Data

**Problem**: The `available_listings` table stores listing-level data (price, broker, status, dates) with a `property_id` foreign key, but has no denormalized property fields (address, city, state, tenant, building size, etc.). The frontend Sales "Available" tab was rendering 1,073 rows as all empty dashes because it expected these fields directly on the listing rows.

**What was fixed already**:
- Created a `v_available_listings` view that JOINs `available_listings` → `properties` → `leases` to provide all fields the frontend needs: `tenant_operator`, `address`, `city`, `state`, `land_area`, `year_built`, `rba` (building_size), `rent`, `rent_per_sf`, `lease_expiration`, `term_remaining_yrs`, `expenses`, `bumps`, `ask_price`, `price_per_sf`, `ask_cap`, `seller`, `listing_broker`, `dom`.
- Updated the frontend (`dialysis.js`) to query `v_available_listings` instead of `available_listings`.
- Similarly created `v_loans` view joining `loans` → `properties` for facility names, and updated the Loans tab to show facility name, city, lender, and maturity instead of raw property_id.

**What still needs fixing**:
1. **Ensure the view stays in sync**: If the ingestion pipeline ever drops/recreates `available_listings`, the view will break. Document this dependency.
2. **Consider denormalizing**: If PostgREST query performance is a concern with 1,000+ rows through a lateral-join view, consider adding a materialized view with a refresh schedule, or denormalizing key fields (`address`, `city`, `state`, `tenant_name`) directly into `available_listings` during ingestion.
3. **Lease data coverage**: The view LEFT JOINs to `leases` for rent/expiration data. Check how many of the 1,073 active listings actually have matching active leases — if coverage is low, the rent/term columns will still show dashes for many rows.

---

## Execution Priority

1. **Issue 1** (multi-clinic matching) — blocks accurate property-level display
2. **Issue 2** (payer mix / HCRIS) — enables revenue quality differentiation, the single most valuable metric for brokers
3. **Issue 3** (patient snapshots) — enables accurate patient counts
4. **Issue 4** (modality flags) — enables accurate home vs in-center classification
5. **Issue 5** (historical patients) — enables trend analysis
6. **Issue 6** (duplicate financials) — data hygiene
7. **Issue 7** (CCN-as-owner bug) — ingestion script fix to prevent recurrence
8. **Issue 8** (available listings schema) — ingestion awareness of view dependencies

## Supabase Connection

- Project ID: `zqzrriwuavgrquhisnoa`
- Use the Supabase MCP tools (`execute_sql`, `apply_migration`) for all database changes
- Test changes against the `v_property_rankings`, `v_cms_data`, `v_available_listings`, and `v_loans` views to verify they render correctly
- The LCC frontend reads from these views via PostgREST through `/api/dia-query.js`

## Views Created This Session (dependencies to be aware of)

- **`v_available_listings`**: JOINs `available_listings` + `properties` + `leases` (lateral). Used by Dialysis Sales "Available" tab. Replaces direct query to `available_listings`.
- **`v_loans`**: JOINs `loans` + `properties`. Used by Dialysis Loans tab. Replaces direct query to `loans`.
- **`v_clinic_inventory_latest_diff`**: Updated to use smart operator_name fallback when `owner_name` is numeric. Used by Dialysis Players tab and Overview.
