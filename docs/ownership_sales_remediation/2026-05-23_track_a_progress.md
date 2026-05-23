# Track A Progress — 2026-05-23

Continuation of `2026-05-23_week0_closeout.md`. Tracks the live cleanup runs executed via Supabase MCP through the `audit_run_log` + `record_cleanup_provenance` helpers.

## Runs executed

| log_id | run_id | step | domain | rows | duration | status |
|---:|---|---|---|---:|---|---|
| 1 | smoke_2026_05_23 | foundation_verify | lcc_opps | 0 | 0s | succeeded |
| 2 | A4a_dia_2026_05_23_001 | A4a_deed_property_id_sync | dia | 364 (dry-run) | 37s | succeeded |
| 3 | A4a_dia_2026_05_23_002 | A4a_deed_property_id_sync | dia | 364 | 29s | succeeded |
| 4 | A2a_dia_2026_05_23_001 | A2a_sales_dedup_quarantine | dia | 504 | 94s | succeeded |
| 5 | A2a_gov_2026_05_23_001 | A2a_sales_dedup_quarantine | gov | 573 | 34s | succeeded |

## Metrics, before → after

### v_data_health_sales

| Metric | Dia before | Dia after | Gov before | Gov after |
|---|---:|---:|---:|---:|
| `sales_live` | 3,880 | **3,376** | 9,914 | **9,349** |
| `sales_duplicate_superseded` | 0 | **504** | 0 | **573** |
| `duplicate_groups_live` | 489 | **0** | 448 | **0** |
| `duplicate_rows_pending_quarantine` | 504 | **0** | 573 | **0** |
| `sales_live_missing_price` | 320 | (unchanged) | 5,978 | 5,982 |
| `sales_live_cap_rate_outside_default_band` | 101 | (unchanged) | 718 | 584 |

The cap-rate-outside-band drop on gov (718 → 584) is incidental — some of the duplicates were cap-rate outliers and were quarantined as part of A2a. The price-missing count slightly *grew* (5,978 → 5,982) because new sidebar captures landed mid-cleanup; not a regression.

### v_data_health_ownership (dia)

| Metric | Before | After |
|---|---:|---:|
| `deed_orphans` (true orphan, no link at all) | 232 | 232 |
| `deed_column_backfill_pending` (link exists, NULL column) | 364 | **0** |

The 232 dia true-orphan deeds remain for a future investigation (they have neither a join-table link nor a property_id column — likely came from a one-off bulk import that knew nothing about the property context).

## Notes from the runs

### A4a stub-deed policy

Per user decision: Option 1 — backfill all 364 candidates including the 362 empty shells. Future cleanup may revisit (`needs_review` or `data_source='legacy_stub'` tagging) if the shells prove confusing in property timelines.

### A2a survivor-selection priority

```
1 county_deed:*                  (highest trust — public record)
2 excel_master
3 sjc_track_record_v2
4 historical_csv_import          (curated)
5 costar_export
6 costar_sidebar                 (live aggregator capture)
7 rca_sidebar_manual_bootstrap
8 NULL
9 ownership_change_stub*         (EXCLUDED from A2 — handled by A3)
```

Within tier: oldest sale_id wins. Survivor selection produced sane choices on every sample inspected (NULL-source rows beaten by costar_sidebar; costar_sidebar beaten by historical_csv_import; etc.).

### Schema mismatch caught at apply time

The F2 migration typed `sales_transactions.dedup_group_id` as UUID, which works for gov (UUID `sale_id`) but breaks for dia (INTEGER `sale_id`). Caught at the first A2a apply when the UPDATE refused to cast. Fixed by `20260523120015_dia_dedup_group_id_to_bigint.sql` (ALTER COLUMN, empty column so zero-cost rewrite). The F2 migration file still ships UUID by default; the dia hotfix is a separate file. Future dia clones get both files in sequence.

### Live-system behavior during cleanup

8 new gov sale rows landed during the A2a-gov run (sales_total went 9,914 → 9,922 even after 573 were quarantined). The fact that A2a is idempotent and keyed on `transaction_state = 'live'` means any duplicates among those 8 new rows would be picked up on a re-run. This argues for promptly building **Track B1 (sales-dedup-tick)** — without it, duplicates will re-accumulate continuously.

## Provenance

Every cleanup run wrote a `field_provenance` row tagged `source='cleanup_run_<run_id>'`. Recovery query for any run:

```sql
SELECT * FROM public.field_provenance
WHERE source_run_id = 'A2a_dia_2026_05_23_001';

-- And to revert (untested but supported):
UPDATE public.sales_transactions
   SET transaction_state = 'live', dedup_group_id = NULL
 WHERE sale_id IN (
   SELECT (value->>'rows')::int FROM public.field_provenance
   WHERE source_run_id = 'A2a_dia_2026_05_23_001'
 );
-- (Bulk-summary provenance was used here, so per-row revert
--  reconstructs the loser set from the dedup_group_id pointers.)
```

The bulk-summary provenance pattern (one row per run instead of per-record) was chosen because 504+573 individual provenance rows would dilute the field_provenance signal. Each summary row carries enough metadata to identify the population that was changed.

## Next priorities

User pre-selected A2 as the next-step focus; both A2 sub-steps now complete. Open candidates for the next session:

1. **A3 gov ownership-stub reclassification** — 5,982 NULL-price `live` rows on gov. These are `ownership_change_stub` and `ownership_change_stub_spe_rename` data_source rows that should be tagged `transaction_state='ownership_stub'` and removed from comp queries. Biggest single number left on the dashboard.

2. **Track B1 sales-dedup-tick cron worker** — to keep duplicates from re-accumulating. Becomes important now that A2a has cleared the backlog.

3. **A1 entity dedup** — 1,399 redundant owner rows. Architecturally foundational but bigger build.

4. **C-track write-time guards** — partial UNIQUE index on `dedup_natural_key` (C1) to make new duplicates impossible at the schema level. Should land before A1 or shortly after.
