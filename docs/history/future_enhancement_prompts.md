# Future Enhancement Prompts — Copy/Paste into Claude Code

---

## 1. Backfill cap_rate_history from existing sales & listings

```
Backfill the cap_rate_history table by running dia_compute_cap_rate() retroactively against
all existing sales_transactions and available_listings in the Dialysis Supabase DB
(project: zqzrriwuavgrquhisnoa).

Context:
- dia_compute_cap_rate(property_id, price, as_of_date) already exists and returns
  (cap_rate, rent_used, rent_source, rent_confidence) using the hierarchical rent selection
  (confirmed anchor > active lease > any anchor).
- cap_rate_history table has columns: property_id, event_type (enum: lease/sale/refi/other/listing),
  event_date, rent_at_event, price_at_event, cap_rate, notes, source_file.
- Triggers (trg_auto_cap_rate_on_sale, trg_auto_cap_rate_on_listing) handle NEW inserts going forward,
  but the ~2,858 existing sales_transactions and ~2,931 available_listings have no history entries.

Steps:
1. Query sales_transactions with property_id and sold_price > 0, call dia_compute_cap_rate()
   for each, INSERT into cap_rate_history with event_type='sale'. Use ON CONFLICT DO NOTHING
   to avoid duplicates. Filter to cap_rate BETWEEN 0.01 AND 0.25.
2. Query available_listings with property_id and COALESCE(last_price, initial_price) > 0,
   call dia_compute_cap_rate() for each, INSERT with event_type='listing'.
3. Report: how many history entries were created, how many properties had computable cap rates,
   and any notable patterns (e.g., distribution of rent_confidence levels).

Do this as a single SQL script using INSERT...SELECT with CROSS JOIN LATERAL, NOT row-by-row.
```

---

## 2. Add decimal cap rate check constraints to Dialysis DB

```
Add CHECK constraints to enforce decimal cap rate format (0.005-0.30) on all cap rate columns
in the Dialysis Supabase DB (project: zqzrriwuavgrquhisnoa), matching the pattern already in
place on the Government DB's property_sale_events table.

Context:
- All cap rates were normalized to decimal format on 2026-04-17. We need constraints to
  prevent future data from being inserted in whole-percent format.
- The Government DB already has: CHECK ((cap_rate IS NULL) OR ((cap_rate >= 0.005) AND (cap_rate <= 0.30)))

Tables and columns to constrain:
- sales_transactions.cap_rate
- sales_transactions.calculated_cap_rate
- sales_transactions.initial_cap_rate
- sales_transactions.stated_cap_rate
- cap_rate_history.cap_rate
- cap_rate_history.initial_cap_rate
- available_listings.cap_rate
- available_listings.current_cap_rate
- available_listings.initial_cap_rate
- available_listings.last_cap_rate
- comparable_sales.comp_cap_rate

Write this as a Supabase migration file at supabase/migrations/YYYYMMDDHHMMSS_cap_rate_check_constraints.sql.
Use IF NOT EXISTS pattern or DROP/ADD to be idempotent. Verify no existing data violates the
constraint before adding it (SELECT count(*) WHERE col > 0.30 OR col < 0.005 for each).
Name constraints descriptively: chk_{table}_{column}_decimal_range.
```

---

## 3. Revenue model versioning in clinic_financial_estimates

```
Add revenue model versioning to the clinic_financial_estimates table in the Dialysis Supabase DB
(project: zqzrriwuavgrquhisnoa) so corrections can be audited over time.

Context:
- On 2026-04-17 we corrected 9,197 CMS patient count estimates that were inflated 4-5x.
  The correction was tracked via data_quality_flags ARRAY containing 'cms_revenue_corrected_v2'.
- The table already has: estimation_method (text), method_notes (text), computed_at (timestamptz),
  source_file (text), data_quality_flags (text[]).
- What's missing: a formal model_version column and a model_registry table.

Implementation:
1. Create a model_registry table:
   - model_id SERIAL PRIMARY KEY
   - model_name TEXT NOT NULL (e.g., 'cms_patient_naive_v1', 'cms_chair_corrected_v2')
   - model_description TEXT
   - formula TEXT (human-readable formula string)
   - parameters JSONB (e.g., {"utilization": 0.65, "blended_rate": 357.35, "shifts": 3})
   - validation_stats JSONB (e.g., {"median_vs_ttm": 1.00, "sample_size": 7115, "iqr": [1.00, 1.00]})
   - is_current BOOLEAN DEFAULT false
   - created_at TIMESTAMPTZ DEFAULT NOW()

2. Add model_version_id BIGINT column to clinic_financial_estimates, FK to model_registry.

3. Seed the registry with the known models:
   - cms_patient_naive_v1: original broken model (patients × 156 × $357.35)
   - cms_chair_corrected_v2: current chair model (chairs × 3 × 5.5 × 52 × 0.65 × rate)
   - cms_concurrent_corrected_v2: current concurrent ratio model (patients × 0.245 × 156 × rate)
   - ttm_reported_v1: TTM from CMS cost reports
   - hcris_10k_v1: 10-K filing propagation
   - google_hours_v1: Google hours capacity model

4. Backfill model_version_id on existing rows based on estimate_source and data_quality_flags.

Write as a Supabase migration. Update CLAUDE.md with the new table and column documentation.
```

---

## 4. Replicate cap rate framework to Government DB

```
Replicate the hierarchical cap rate calculation framework from the Dialysis DB to the
Government Supabase DB (project: scknotsqkcheojiaewwh).

Context — what exists in Dialysis DB (zqzrriwuavgrquhisnoa) and needs to be adapted:
- dia_project_rent_at_date(anchor_rent, anchor_date, target_date, bump_pct, bump_interval_mo)
  → projects rent using compound bump schedule
- dia_compute_cap_rate(property_id, price, as_of_date) → hierarchical rent selection
  (confirmed anchor > active lease > any anchor) then cap_rate = rent/price
- trg_auto_cap_rate_on_sale (BEFORE INSERT/UPDATE on sales_transactions)
- trg_auto_cap_rate_on_listing (BEFORE INSERT/UPDATE on available_listings)
- cap_rate_history table with event_type enum (lease/sale/refi/other/listing)

Government DB differences to account for:
- Properties table: check column names for rent/anchor fields — may differ from Dialysis
- Leases: GSA lease structure with different columns (gsa_lease_number, etc.)
- sales_transactions: has sold_cap_rate, initial_cap_rate, last_cap_rate columns
- available_listings: has asking_cap_rate, original_cap_rate columns
- property_sale_events table exists with its own cap_rate column + check constraint
- Government leases have different bump structures (GSA often uses CPI or fixed schedules)
- cap_rate_history or equivalent may not exist yet — check first

Steps:
1. Audit the Government DB schema for rent/lease/anchor columns on properties and leases tables.
2. Create gov_project_rent_at_date() adapted for GSA lease bump patterns.
3. Create gov_compute_cap_rate() with the same hierarchy pattern.
4. Create cap_rate_history table if it doesn't exist (or verify it does).
5. Create triggers on sales_transactions, available_listings, and property_sale_events.
6. Backfill history from existing transactions.
7. Update CLAUDE.md with the Government DB framework documentation.
```

---

## 5. Replace concurrent ratio with facility-specific treatment counts

```
Improve the CMS patient count revenue model by replacing the fixed 0.245 concurrent ratio
with facility-specific treatment count data from CMS Dialysis Facility Compare.

Context:
- Currently, 733 orphaned clinics (no medicare_clinics match) use:
  revenue = patients × 0.245 × 156 × $357.35/tx (concurrent ratio model, conf 0.65)
- The 0.245 ratio was empirically derived (median 1.00x vs TTM, but IQR 0.72-1.30 — wide variance)
- CMS publishes actual treatment counts per facility in the Dialysis Facility Compare dataset
  at https://data.cms.gov/provider-data/dataset/23ew-n7w9
- The dataset includes: CMS Certification Number (CCN), total hemodialysis treatments,
  total peritoneal dialysis treatments, and patient counts by modality

Steps:
1. Download the latest Dialysis Facility Compare CSV from CMS (or use the API).
2. Parse and load into a new table: cms_facility_treatments (or update v_facility_patient_counts_latest).
   Key fields: ccn/medicare_id, total_hd_treatments, total_pd_treatments, total_treatments,
   reporting_period_start, reporting_period_end.
3. For clinics with actual treatment data, recalculate revenue:
   revenue = actual_total_treatments × $357.35/tx (blended rate, or use the 4-payer model
   with facility-specific payer mix if available from CMS).
4. Update clinic_financial_estimates for affected rows:
   - estimate_source stays 'cms_patient_count' but estimation_method updates
   - confidence_score increases (actual treatments >> modeled concurrent ratio)
   - Tag with data_quality_flags 'cms_actual_treatments_v3'
5. Compare the new estimates against TTM for the ~7,000 overlap clinics to validate.
6. Report: how many clinics improved, what's the new accuracy distribution, which clinics
   still fall back to the ratio model.

IMPORTANT: The Dialysis DB project ID is zqzrriwuavgrquhisnoa. The edge function data-query
proxy allows reads via diaQuery() in the frontend. Any new tables need to be added to
DIA_READ_TABLES in supabase/functions/data-query/index.ts AND api/_shared/allowlist.js.
```
