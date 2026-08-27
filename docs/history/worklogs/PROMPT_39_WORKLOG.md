# Prompt 39 Worklog - Government Case for Renewal Source Rebuild

Date: 2026-08-11

## Objective

Decide whether Government `Data_Case_Renewal` should import legacy 1991 annual history or move off
`gsa_lease_events.new_award` to a monthly TTM source from `gsa_leases.latest_action='New'`; audit and suppress
bulk `new_award` event clusters.

## Decision

Use the monthly TTM `gsa_leases.latest_action='New'` source. Do not import or extend legacy 1991 annual history
for this chart.

Rationale:

- Live `gsa_lease_events.new_award` still has bulk first-of-month clusters after the original Round 6e fixes:
  `2019-03-01` (8,044), `2026-03-01` (3,115), `2026-06-01` (2,798), and `2026-05-01` (1,191).
- Filtering individual sentinel dates is not durable because new bulk clusters keep appearing.
- `gsa_leases.latest_action='New'` is already the accepted action basis for first-generation commencements in
  `cm_gov_lease_renewal_rate_m`.
- The monthly TTM view produces deck-scale counts and removes event-churn spikes. Rent/SF is trimmed to the
  same plausible `$5-$100/SF` discipline used by nearby GSA rent views.

## Changes

- Added migration `supabase/migrations/government/20260811142253_cm_gov_case_for_renewal_monthly_ttm_new_leases.sql`.
- Replaced `public.cm_gov_case_for_renewal_y` with a monthly TTM lease-level view:
  `period_end`, `year`, `commencement_count`, `avg_rent_per_sf`, `total_lsf`, `rent_sample_count`.
- Added `public.v_cm_gov_gsa_new_award_bulk_clusters` so suppressed `gsa_lease_events.new_award` clusters remain auditable.
- Updated `api/_shared/cm-excel-export.js` so `Data_Case_Renewal` writes `period_end`/monthly TTM columns.
- Updated native/PNG chart builders to prefer `period_end` while retaining `year` fallback.
- Added a native chart unit test for the monthly `period_end` contract.

## Verification Notes

- Live audit confirmed `gsa_lease_events.new_award` clusters above 1,000 rows on four dates.
- Live sample of the replacement source shows 2024-06-30 TTM new commencements = 82 and trimmed avg rent/SF =
  ~$35.59, avoiding the untrimmed outlier spike.
- Applied live to Government Supabase project `scknotsqkcheojiaewwh` via the Supabase connector. The repo's linked
  Supabase CLI target is not the Government DB and correctly failed with `public.gsa_leases` missing, so it was
  not used for the live apply.
- Live view shape preserves the original first four columns (`year`, `commencement_count`, `avg_rent_per_sf`,
  `total_lsf`) and appends `period_end`, `rent_sample_count` because Postgres cannot reorder columns in
  `CREATE OR REPLACE VIEW`.
- Live `EXPLAIN ANALYZE select * from cm_gov_case_for_renewal_y order by period_end desc limit 12` completed in
  ~143 ms.
- `node --test test/cm-native-chart-injector.test.mjs` passed: 212 passing, 1 skipped.
- Supabase advisors were run after DDL. They returned pre-existing project-wide RLS/index/security-definer lints;
  no new Case for Renewal-specific issue was identified in the visible results.
