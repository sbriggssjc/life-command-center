# R2-X-2 — dia_merge_property complete FK coverage

**Branch:** `audit/r2-x2-dia-merge-property-fk-coverage` (off `origin/main`)
**Closes:** R2-X-2 (CRITICAL) from `audit/ROUND_2_FINDINGS_2026-05-19.md`

## What this does

Replaces the hand-coded UPDATE list inside `public.dia_merge_property` with a
runtime `pg_constraint` discovery loop that automatically picks up every
foreign key whose target is `public.properties.property_id`. Mirrors the
pattern `gov_merge_property` has used since Round 76be (April 2026).

Adds a CONCURRENTLY refresh of `mv_property_value_signal` (QA-06) at the end
of the merge so the dia value-signal rail picks up the merge immediately.

## Background

The prior dia merge function (`20260425240000`) repointed 9 child tables by
hand: `leases, available_listings, sales_transactions, contacts,
ownership_history, parcel_records, tax_records, listing_change_events,
property_public_records`.

Since April, the following tables added a `property_id` FK to
`public.properties` and were silently stranded by every merge:

- `loans` (Round 76ek)
- `property_financials` (Round 76ek.a — ON DELETE CASCADE → silent row LOSS)
- `llc_research_queue` (Round 76ek.j Phase 1 — ON DELETE SET NULL → value
  anchor nulled instead of repointed)
- `cap_rate_history`
- `property_sale_events`
- `property_intel`
- `property_cms_link` / `property_cms_link_history`
- `lease_extensions` / `lease_rent_schedule`
- `staged_intake_matches`
- `cm_features`

The runtime FK loop handles all of these and any future addition without
follow-up migrations.

## How to apply

```bash
# Dry-run (default — verifies the migration is well-formed, prints the
# closeout block that would be appended to ROUND_2_FINDINGS_2026-05-19.md)
node audit/patches/R2-X-2-dia-merge-property-fk-coverage/apply.mjs

# Apply (writes the closeout block)
node audit/patches/R2-X-2-dia-merge-property-fk-coverage/apply.mjs --apply
```

Then apply the SQL migration via Supabase MCP on dia (project
`zqzrriwuavgrquhisnoa`):

```sql
-- supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql
```

## Verification (post-apply)

```sql
-- 1. Sanity-check the FK discovery walks the expected universe.
-- Run on dia:
SELECT t.relname AS table_name, a.attname AS column_name
  FROM pg_constraint c
  JOIN pg_class      t ON t.oid = c.conrelid
  JOIN pg_namespace  n ON n.oid = t.relnamespace
  JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
 WHERE c.contype = 'f'
   AND c.confrelid = 'public.properties'::regclass
   AND n.nspname = 'public'
 ORDER BY 1, 2;
-- Expected: ≥14 rows (the prior 9 + at least the 5 new property-id FK tables)
```

Then on a staging copy: pick two properties known to share an address and
have child rows in each table. Call:

```sql
SELECT * FROM public.dia_merge_property(keep_id, drop_id);
```

Assert:
- The return JSONB lists every populated child under `rewired` with a positive
  count.
- `mv_property_value_signal_refreshed: true` is present.
- `properties_deleted: 1` is present.
- The drop_id no longer exists in `properties`.
- All previously-drop_id-owned child rows now point at `keep_id`.

## Rollback

```sql
-- Restore the prior dia_merge_property by re-running:
-- supabase/migrations/20260425240000_dia_property_merge_candidates_and_helper.sql
-- (only the CREATE OR REPLACE FUNCTION public.dia_merge_property block)
```

The view `v_property_merge_candidates` and `find_property_consolidation_candidates`
are untouched.

## Closes / blocks

- Closes: **R2-X-2** (CRITICAL)
- Does NOT close: **R2-X-2b** (gov-side MV refresh — gov has no MV deriving
  from properties as of 2026-05-19; revisit when one is added)
- Does NOT close: **R2-X-5** (field_provenance ghost rows on DELETE — separate
  cleanup cron)

## Files

- `supabase/migrations/dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql`
- `audit/patches/R2-X-2-dia-merge-property-fk-coverage/apply.mjs`
- `audit/patches/R2-X-2-dia-merge-property-fk-coverage/README.md`
- `audit/patches/R2-X-2-dia-merge-property-fk-coverage/COMMIT_MSG.txt`
- `audit/ROUND_2_FINDINGS_2026-05-19.md` (closeout block appended by apply.mjs)
