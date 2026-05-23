# Baseline: 2026-05-23, immediately after Week 0 foundations applied

First real measurement of the audit's headline numbers against the live Supabase projects (LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`, government `scknotsqkcheojiaewwh`).

All Track A/B/C progress will be measured against these numbers. The plan's target column comes from `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` §"Success Metrics".

## v_data_health_sales

| Metric | Dia | Gov | Plan target |
|---|---:|---:|---|
| `sales_total` | 3,880 | 9,914 | — |
| `sales_live` | 3,880 | 9,914 | — |
| `sales_live_missing_property` | 0 | **415** | < 50 (gov) |
| `sales_live_missing_price` | 320 | **5,978** | 0 |
| `sales_live_missing_date` | 0 | 0 | 0 |
| `sales_live_cap_rate_outside_default_band` | 101 | **718** | 0 |
| `duplicate_groups_live` | **489** | **448** | < 25 each |
| `duplicate_rows_pending_quarantine` | 504 | 573 | n/a |

Gov's 5,978 NULL-price rows are dominated by `transaction_type='ownership_change_stub'` (GSA lessor swaps). A3 will reclassify them out of the live lane.

## v_data_health_ownership

| Metric | Dia | Gov | Plan target |
|---|---:|---:|---|
| `prop_total` | 12,594 | 17,709 | — |
| `pct_property_to_recorded_owner` | **16.12 %** | **44.63 %** | ≥ 70 % |
| `pct_property_to_true_owner` | 74.82 % | 39.15 % | — |
| `oh_total` (ownership_history) | 7,749 | 14,502 | — |
| `deed_total` | 741 | 5,572 | — |
| `deed_orphans` (no property_id) | 596 | 5,572 | < 1,500 + 0 net new |
| `parcel_total` | n/a | 10,197 | — |
| `parcel_orphans` (gov, all rows) | n/a | 10,197 | < 1,500 + 0 net new |

Notable shift since the 2026-05-20 audit:
- Dia `pct_property_to_true_owner` is now 74.82 % (audit baseline was 20 %). True-owner backfill landed since the audit was written.
- Gov `deed_total` is 5,572, down from the audit's 9,402 figure. Investigate later — may be a reclassification or RLS scope change.

## v_data_health_entities

| Metric | Dia | Gov | Plan target |
|---|---:|---:|---|
| `total_recorded_owners` | 3,926 | 15,448 | — |
| `total_true_owners` | 3,906 | 14,106 | — |
| `redundant_owner_groups` | 247 | 1,077 | n/a |
| `redundant_owner_rows` | 253 | **1,146** | < 30 each |

Note: the canonical-key normalization the view uses (regex-strip legal suffixes) is approximate. Once A1 + C4 land, the canonical key will be authoritatively computed, and these counts should drop to near 0.

## LCC Opps helpers smoke test

All three helpers exercised end-to-end against live LCC Opps:

```
SELECT audit_run_begin('smoke_2026_05_23', ...)        → log_id=1
SELECT record_cleanup_provenance('smoke_2026_05_23', …) → prov_id=1027244
SELECT audit_run_finish(log_id, 'succeeded', 0, 0, NULL)
SELECT * FROM audit_run_log WHERE run_id = 'smoke_2026_05_23'
  → status='succeeded', dry_run=true, started_at=finished_at=2026-05-23 13:10:09 UTC
SELECT * FROM field_provenance WHERE source_run_id = 'smoke_2026_05_23'
  → 1 row, source='cleanup_run_smoke_2026_05_23'
```

## Applied migrations

| Project | Migration | Status |
|---|---|---|
| LCC Opps (xengecqvemvfknjvbvrq) | `audit_run_log_and_cleanup_helpers` | applied |
| Dialysis_DB (zqzrriwuavgrquhisnoa) | `dia_quarantine_states_and_dedup_key` | applied |
| Dialysis_DB | `dia_cap_rate_bands` | applied |
| Dialysis_DB | `dia_v_data_health` | applied |
| government (scknotsqkcheojiaewwh) | `gov_quarantine_states_and_dedup_key` | applied |
| government | `gov_cap_rate_bands` | applied |
| government | `gov_v_data_health` | applied |

## Schema mismatches found and fixed during apply

The migration files in the repo had two assumptions about column names that didn't hold against the real schemas. Both fixed pre-apply (commit follows this file):

1. **Dia `recorded_owners`** has columns `name` and `normalized_name` — not `recorded_owner_name` or `canonical_name`. The dia entities view was updated to `COALESCE(normalized_name, name, '')`.
2. **Gov `recorded_owners`** has columns `name` and `canonical_name` — not `normalized_name` or `recorded_owner_name`. The gov entities view was updated to `COALESCE(canonical_name, name, '')`.
3. **Gov `sales_transactions`** has `sold_cap_rate` but no plain `cap_rate` column. The gov sales view was updated to use `sold_cap_rate` only.
4. **Gov `deed_records` / `parcel_records`** have no `property_id` column at all (this is the C3 gap). The gov ownership view now reports `deed_orphans = deed_total` and `parcel_orphans = parcel_total` as the literal truth until C3 lands the column, at which point the view is rebuilt to compute real orphan counts.

These are the same kinds of edge cases the local-test step caught earlier (immutable-expression error) — would have failed the apply if not for the pre-check sweep.

## Next

C3 — modify the Python deed/parcel scrapers to persist `property_id` (plus `situs_address` and `apn` on deed_records so future relinking is possible without the scraper-side fix).
