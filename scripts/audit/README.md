# scripts/audit/ — Ownership & Sales Cleanup Runbook

Operational runbook for the Track A backfill steps in `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`.

## Layout

```
scripts/audit/
├── README.md                  ← you are here
├── snapshots/                 ← one-time pre-cleanup snapshots (F1)
│   └── snapshot-<domain>-<date>.sql.gz   (gitignored; produced by snapshot-take.mjs)
├── backfill/                  ← Track A cleanup steps, numbered to match the plan
│   ├── A1_entity_dedup.sql              (owners — must run before A2/A6/A7)
│   ├── A2_sales_dedup.sql               (sales duplicate-group quarantine)
│   ├── A3_ownership_stub_reclassify.sql (move NULL-price stubs out of live lane)
│   ├── A4_deed_orphan_recover.sql       (relink situs/APN where possible)
│   ├── A5_cap_rate_retro_tag.sql        (reads cap_rate_bands)
│   ├── A6_ownership_history_overlap.sql (clear overlaps then ALTER ADD EXCLUDE)
│   ├── A7_sf_link_backfill.mjs          (Salesforce-side; uses sf-entity-backfill)
│   ├── A8_costar_contacts_retro.mjs     (re-runs contacts extractor on cached payloads)
│   └── A9_unified_contacts_consolidation.sql (Decision #1: LCC Opps becomes authoritative)
└── verify/                    ← read-only verification queries (snapshot at start + end)
    ├── data_health_sales.sql
    ├── data_health_ownership.sql
    └── data_health_entities.sql
```

## Conventions

Every cleanup step is **dry-run-able**, **idempotent**, and **reversible via `audit_run_log` + `field_provenance`**.

1. **Open a run.** Each script starts by calling `audit_run_begin(run_id, step, target_database, dry_run)` on LCC Opps. The returned `log_id` is the row to close out at the end.
2. **Snapshot first.** A read of `v_data_health_*` is captured to `audit_run_log.metadata.before` before changes.
3. **Tag, don't delete.** All sales-side merges set `transaction_state='duplicate_superseded'` and `dedup_group_id`. All ownership merges set `ownership_state='superseded'`. Nothing is deleted in Track A (Decision #2).
4. **Provenance every write.** Each column change calls `record_cleanup_provenance(run_id, …)`. Reversibility: `SELECT * FROM field_provenance WHERE source_run_id = '<run_id>'` gives the exact diff.
5. **Close the run.** Each script ends by calling `audit_run_finish(log_id, status, rows_affected, rows_after)`.

## Run IDs

Format: `cleanup_<step>_<YYYYMMDD>_<seq>` — e.g. `cleanup_A1_20260601_001`. The seq lets you re-run the same step on a different day without colliding.

## Dry-run gate

Every script accepts `--dry-run` (default) and `--apply`. Dry-run computes counts and writes a `dry_run=TRUE` row to `audit_run_log` with the projected impact in `metadata.projected_changes`, but writes nothing else.

## Sequencing reminders

From the plan's §"Phasing & Dependencies":

- **A1 before A2, A6, A7.** Entity dedup is foundational.
- **C4 before A1.** The BEFORE-INSERT entity-dedup trigger must be live so the backfill doesn't race against ongoing writes.
- **C1 before A2.** The UNIQUE partial index gives A2 something to enforce against.
- **A6 before adding the `EXCLUDE` constraint.** The constraint can't be added with existing overlaps; A6 cleans them first.

## Reverting a run

```sql
-- LCC Opps:
SELECT * FROM audit_run_log WHERE run_id = '<run_id>';
SELECT target_database, target_table, record_pk_value, field_name, value
FROM field_provenance
WHERE source_run_id = '<run_id>'
ORDER BY recorded_at;

-- Then build the reverse UPDATEs from the provenance rows and apply.
-- For sales/ownership state changes, set transaction_state back to 'live' /
-- ownership_state back to 'active'.
```

A `scripts/audit/revert.mjs` will be added alongside A1 once the first cleanup script is written.
