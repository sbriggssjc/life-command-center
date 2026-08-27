# Prompt 31 Data-Integrity P2 Worklog

## Objective
Implement conservative property-record consolidation plus multi-source same-event sale reconciliation for dia and gov. This is not a repeat-sale deletion pass: genuine repeat sales stay live and distinct.

## Constraints
- Dry-run report before any data mutation.
- Backup/ledger tables with `batch_tag`.
- High-confidence auto-merge only; ambiguous cases stay in review views.
- Never hard-delete sale rows; same-event losers are soft-tagged with `transaction_state='duplicate_superseded'` and `dedup_group_id`.
- Idempotent apply functions.
- Reuse existing `dia_merge_property` / `gov_merge_property` for property FK rewiring after backing up the property rows.

## Changes In Progress
- Added dia migration with:
  - property consolidation candidates/review views.
  - property consolidation backup/log table.
  - dry-run/apply RPC for high-confidence property merges.
  - same-event multi-source sale plan/review views.
  - same-event sale reconciliation log and dry-run/apply RPC.
- Added gov migration with the same pattern and schema-specific sale party columns.
- Added `p31_find_existing_property_by_address` in both domain migrations so ingest writers can use database-side normalization before creating a property.
- Added sidebar writer fallback to call the P31 normalized-address RPC and refuse ambiguous creates.
- Added `v_p31_sale_history_live` and `v_p31_repeat_sale_census` to verify repeat sales stay visible and distinct.

## Verification Plan
- Static SQL review for idempotency and no `DELETE` against sales tables in Prompt 31 functions.
- Run targeted tests/lint where available.
- If live Supabase access is available, run RPCs with `p_dry_run=true` first and report counts before any apply.

## Dry-Run Commands After Migration Deployment
```sql
select public.p31_property_consolidation_apply(true, 'p31_dia_review_20260804');
select public.p31_same_event_sales_apply(true, 'p31_dia_review_20260804');
select * from public.v_p31_property_consolidation_plan order by lane, norm_state, norm_address, drop_id;
select * from public.v_p31_same_event_sale_plan order by property_id, loser_sale_date;
select p31_classification, count(*) from public.v_p31_repeat_sale_census group by 1 order by 1;
```

Run the same commands in gov with `p31_gov_review_20260804`.
