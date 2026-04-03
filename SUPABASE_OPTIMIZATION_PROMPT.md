# Supabase Backend Optimization — Dialysis DB View Timeouts

## Context

This is the **Life Command Center (LCC)** PWA for net lease real estate brokers. The Dialysis database is hosted on Supabase project `zqzrriwuavgrquhisnoa`. The frontend (`dialysis.js`) queries views via a Vercel API proxy (`/api/dia-query.js`) that passes through to PostgREST.

Multiple Supabase views are hitting **statement timeout errors** (PostgreSQL error code `57014`) during normal page loads. The frontend now handles these gracefully (parallel queries with `.catch()`), but the underlying views need optimization so the data actually loads.

## Views That Are Timing Out

These views consistently return HTTP 500 with `"canceling statement due to statement timeout"`:

1. **`v_counts_freshness`** — Returns summary counts (total clinics, etc.). Queried with `SELECT *`, no filters.
2. **`v_clinic_inventory_latest_diff`** — Returns latest inventory changes. Queried with `SELECT *, LIMIT 500`.
3. **`v_clinic_property_link_review_queue`** — Returns property review queue. Queried with `SELECT *, LIMIT 200`.

## Views That Work But Are Slow

These complete but take multiple seconds:

4. **`v_clinic_inventory_diff_summary`** — Inventory change summary.
5. **`v_facility_patient_counts_mom`** — Month-over-month patient count movers. Queried with filters like `delta_patients=gt.0` and `ORDER BY delta_patients.desc, LIMIT 10`.
6. **`v_npi_inventory_signals`** — NPI signals. `LIMIT 300`.
7. **`v_clinic_research_priority`** — Clinic leads with priority scoring. Paginated with `LIMIT 1000, OFFSET`.
8. **`v_clinic_lease_backfill_candidates`** — Lease backfill queue. `LIMIT 200`.

## Key Tables (Likely Referenced by the Views)

Based on the frontend's direct table queries, the underlying tables likely include:

- `medicare_clinics` — Core clinic records, keyed by `medicare_id`
- `properties` — Property records, keyed by `property_id`
- `clinic_property_links` — Junction table linking clinics to properties
- `ownership_history` — Ownership records per property
- `sales_transactions` — Sale records (columns: `sale_id, property_id, sold_price, sale_date, cap_rate, buyer_name, seller_name, buyer_type, seller_type`)
- `available_listings` — Active market listings
- `research_queue_outcomes` — Tracks dismissed/resolved leads
- `clinic_financial_estimates` — Revenue/profit estimates per clinic
- `npi_providers` / NPI-related tables — NPI registry data
- `gsa_leases` / lease-related tables — Lease data

## What Needs to Happen

### 1. Audit the view definitions
Run `\d+ v_counts_freshness`, `\d+ v_clinic_inventory_latest_diff`, and `\d+ v_clinic_property_link_review_queue` (or query `pg_views` / `information_schema.views` for the view SQL). Understand what joins, aggregations, and subqueries they perform.

### 2. Check for missing indexes
Common causes of view timeouts:
- Full table scans on large tables (e.g., `medicare_clinics` has 8,500+ rows, `properties` has 16,000+)
- Missing indexes on join columns (`property_id`, `medicare_id`, `clinic_id`)
- Missing indexes on filter/sort columns (`delta_patients`, `listing_status`, `sale_date`)
- Unindexed foreign keys in junction tables (`clinic_property_links`)

### 3. Consider materialized views
For views that aggregate over the entire dataset and don't need real-time data:
- `v_counts_freshness` — perfect candidate for a materialized view refreshed on a schedule (hourly or on data ingestion)
- `v_clinic_inventory_diff_summary` — same
- `v_clinic_research_priority` — if it involves heavy scoring/ranking logic

### 4. Optimize view SQL
- Replace correlated subqueries with JOINs or CTEs
- Add `WHERE` clauses to limit scope (e.g., only active clinics, only recent changes)
- Use `LIMIT` pushdown — ensure the view can benefit from PostgREST's `?limit=` parameter
- Avoid `SELECT *` in the view definition if many columns are unused

### 5. Check Supabase statement timeout setting
The default Supabase statement timeout may be too low for complex views. Check:
```sql
SHOW statement_timeout;
```
Consider increasing it for the API role, or better yet, optimize the views so they complete within the default timeout.

## How to Access

- **Supabase Dashboard**: Project ID `zqzrriwuavgrquhisnoa`
- **Connection**: Use the Supabase SQL Editor or connect via `psql` using the connection string from Project Settings → Database
- **To get view definitions**:
```sql
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
AND viewname IN (
  'v_counts_freshness',
  'v_clinic_inventory_latest_diff',
  'v_clinic_property_link_review_queue',
  'v_clinic_inventory_diff_summary',
  'v_facility_patient_counts_mom',
  'v_npi_inventory_signals',
  'v_clinic_research_priority',
  'v_clinic_lease_backfill_candidates'
);
```

- **To check existing indexes**:
```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

- **To check table sizes**:
```sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

## Success Criteria

After optimization, these queries should complete within **3 seconds** each:
- `SELECT * FROM v_counts_freshness`
- `SELECT * FROM v_clinic_inventory_latest_diff LIMIT 500`
- `SELECT * FROM v_clinic_property_link_review_queue LIMIT 200`
- `SELECT * FROM v_clinic_research_priority LIMIT 1000`

The full Dialysis data load (all 11 queries in parallel) should complete in **under 10 seconds** total.
