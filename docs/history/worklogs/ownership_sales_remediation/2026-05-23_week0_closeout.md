# Week 0 Close-Out & Track A First-Run Findings — 2026-05-23

## What landed live

All Week 0 foundations applied to the three Supabase projects (LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`, government `scknotsqkcheojiaewwh`). All helpers and views exercised end-to-end against live data.

Migrations applied (9 total):

| Order | Project | Migration | Notes |
|-------|---------|-----------|-------|
| 1 | LCC Opps | `audit_run_log_and_cleanup_helpers` | F1 + F3 |
| 2 | dia | `dia_quarantine_states_and_dedup_key` | F2 |
| 3 | dia | `dia_cap_rate_bands` | Decision #3 |
| 4 | dia | `dia_v_data_health` | F4 |
| 5 | gov | `gov_quarantine_states_and_dedup_key` | F2 |
| 6 | gov | `gov_cap_rate_bands` | Decision #3 |
| 7 | gov | `gov_v_data_health` | F4 |
| 8 | dia | `dia_v_data_health_ownership_v2` | corrects orphan accounting |
| 9 | gov | `gov_v_data_health_ownership_v2` | corrects orphan accounting |

## Schema mismatches caught pre-apply

The repo migrations had four assumptions about column names that didn't hold against the real schemas. All caught during live pre-apply schema checks via the MCP execute_sql, fixed before the corresponding apply_migration call:

1. `dia.recorded_owners` has `name` + `normalized_name`, not `recorded_owner_name` or `canonical_name`.
2. `gov.recorded_owners` has `name` + `canonical_name`, not `normalized_name` or `recorded_owner_name`.
3. `gov.sales_transactions` has `sold_cap_rate`, no plain `cap_rate` column.
4. `gov.deed_records` / `parcel_records` use `property_public_records` join table for property linkage, not a direct `property_id` column. (Original migration assumed the latter.)

## First real measurements (baseline)

See `baselines/2026-05-23_post_week0_apply.md` for the full table. Headlines after the v2 view correction:

| Metric | Dia | Gov |
|---|---:|---:|
| Live sales | 3,880 | 9,914 |
| Duplicate-groups live | **489** | **448** |
| Duplicate rows pending quarantine | 504 | 573 |
| Live sales missing price | 320 | **5,978** |
| Live sales cap_rate outside default band | 101 | **718** |
| Property→recorded_owner % | 16.12 % | 44.63 % |
| Property→true_owner % | 74.82 % | 39.15 % |
| True deed orphans (no link any way) | 232 | 88 |
| Deed column backfill pending (link exists, column NULL) | 364 | n/a |
| Redundant owner groups | 247 | 1,077 |

## Material change to the audit's understanding of G3

The original audit reported 9,402 orphaned gov parcel records and ~500 orphaned dia deed records, based on direct-column checks. The live schemas use a `property_public_records` JOIN TABLE that the audit author wasn't aware of. Updated reality:

| Domain | True orphans | Column-only orphans (recoverable) |
|---|---:|---:|
| dia.deed_records | 232 | 364 (have join-table link, NULL column) |
| gov.deed_records | 88 | n/a (no column to backfill) |
| gov.parcel_records | 0 | n/a |

**G3 is therefore much narrower than the plan stated.** The bulk of the work is no longer needed. What remains:
- Investigate the 232 dia + 88 gov true orphans (why no link at all?).
- Optionally backfill the 364 dia `deed_records.property_id` column from the join table (mostly stub rows — see below).
- Optionally add a denormalized `property_id` column on gov tables for query convenience (not needed for correctness).

The plan's C3 scope (modify Python scrapers to persist `property_id`) does not apply because the actual writers in this repo are JavaScript and already write the join-table link. The pre-Round-76ae historical orphans are the only backlog.

## A4a dry-run finding (the stub deed mystery)

First Track A run executed end-to-end against live data:

```
run_id: A4a_dia_2026_05_23_001
step:   A4a_deed_property_id_sync (dry-run)
target: dia_db
result: succeeded
rows:   364 candidates, 272 distinct target properties, 0 conflicts
```

Surprise finding: **of the 364 backfill-pending deed rows, only 2 carry real deed metadata.** The other 362 are stub rows where `document_number`, `recording_date`, `grantor`, `grantee` are all NULL and `consideration = 0.0`. The 2 real-looking rows are duplicates of each other (property 35245, Ridgeline Cap Partners → Platform Ventures, $2.12M).

This raises a policy question before any apply: **what should happen to ~362 empty deed shells?** Options:

1. **Backfill `property_id` anyway** — sets the column, leaves the shells in place. Cheapest. The shells remain visible in deed_records but at least are addressable from the property. Matches Decision #2 (quarantine, don't delete).
2. **Tag them with a `data_source='legacy_stub'` and skip** — preserves them as a known-empty category. Doesn't backfill the column. Marks the issue for future cleanup.
3. **Delete the empty shells; backfill the 2 real rows** — most aggressive; reduces deed_records noise. Departs from the "never delete" principle.

My recommendation: **option 1**. The shells are harmless once tagged at the column level; deletion is irreversible; the only downside of leaving them is the noise in `deed_records`, which is bounded.

## Track A entry point established

`scripts/audit/backfill/A4a_deed_property_id_sync_dia.sql` exists as a reproducible SQL artifact. The canonical execution path is via the Supabase MCP through the LCC Opps `audit_run_begin / audit_run_finish` helpers, which gives:
- A `log_id` in `audit_run_log` for every run
- `metadata` JSONB recording candidate counts and sample notes
- `field_provenance` rows tagged `source='cleanup_run_<run_id>'` for every column change
- Full reversibility via `source_run_id`

The dry-run row landed correctly at `audit_run_log.log_id = 2` and is queryable.

## What's next

Awaiting user direction on the stub-deed policy. Then natural next steps in rough priority order:

1. **A4a apply** (per policy decision) — 364 rows × 1 column.
2. **A1 entity dedup** — Dia 253 + Gov 1,146 redundant owner rows. This is the foundational dedup that unlocks A2/A6/A7.
3. **A2 sales dedup** — Dia 489 + Gov 448 duplicate-groups. Directly addresses the user's original "duplicates for the same sale" complaint.
4. **A3 gov ownership-stub re-classification** — 5,978 NULL-price live rows; tag with `transaction_state='ownership_stub'`. Directly addresses the user's "missing many elements" complaint.
5. **A5 cap-rate retro-tagging** — 101 dia + 718 gov out-of-band rows.
6. **C-track** writer guards (C1 UNIQUE index, C4 entity-dedup BEFORE INSERT trigger) — make the cleanup permanent.
