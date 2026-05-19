# R2-W-1 + R2-W-2 — Provenance event log + canonicalizer source registry

**Branch:** `audit/r2-w-1-w-2-provenance-event-log` (off `origin/main`)
**Closes:** R2-W-1 (CRITICAL), R2-W-2 (CRITICAL) from `audit/ROUND_2_FINDINGS_2026-05-19.md`

## What this does

Three SQL migrations that close the provenance-integrity gap left by the
QA-22 / QA-24 / QA-30 canonicalizers without adding a cross-DB RPC inside a
row-level trigger.

1. **LCC Opps** registers the three canonicalizer sources in
   `field_source_priority` at priority 90 (record_only). The Phase 4 drift
   detector (`v_field_provenance_unranked`) stops yelling "unknown source"
   the moment the flush cron lands.
2. **Dia** gets a `provenance_event_log` table, an upgraded QA-22 trigger
   function that writes a row per canonicalization, and a historical-marker
   row for QA-22's 2,646-row 2026-05-18 UPDATE.
3. **Gov** gets a `provenance_event_log` table and two historical-marker
   rows for QA-24's 1,218 row impact and QA-30's 4 row impact. No trigger
   exists on gov to upgrade today.

## How to apply

```bash
# Dry-run (default — verifies all three migrations have their sentinels)
node audit/patches/R2-W-1-W-2-provenance-event-log/apply.mjs

# Apply (writes the closeout block to ROUND_2_FINDINGS_2026-05-19.md)
node audit/patches/R2-W-1-W-2-provenance-event-log/apply.mjs --apply
```

Then via Supabase MCP, apply each migration to its target project (in this
order):

1. LCC Opps (`xengecqvemvfknjvbvrq`) →
   `supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql`
2. Dia (`zqzrriwuavgrquhisnoa`) →
   `supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql`
3. Gov →
   `supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql`

The order matters only insofar as the dia trigger references the source
name (`qa22_davita_brand_canonicalize`) — if LCC Opps hasn't seen the name
yet, no flush cron exists to fail loudly. Apply LCC Opps first by
convention.

## Verification (post-apply)

See the verification SQL in the closeout block written to
`audit/ROUND_2_FINDINGS_2026-05-19.md`. Quick spot-check:

```sql
-- On LCC Opps
SELECT count(*) FROM public.field_source_priority
 WHERE source LIKE 'qa%_canonicaliz%';
-- Expected: 3

-- On dia
SELECT count(*) FROM public.provenance_event_log;
-- Expected: ≥1 (the historical marker)

-- On gov
SELECT count(*) FROM public.provenance_event_log;
-- Expected: 2 (one each for QA-24 and QA-30 markers)
```

## Rollback

```sql
-- LCC Opps
DELETE FROM public.field_source_priority
 WHERE source IN ('qa22_davita_brand_canonicalize',
                  'qa24_canonicalize_agency',
                  'qa30_canonicalize_agency');

-- Dia: revert the trigger function back to its QA-22 form
-- (re-apply 20260518200000_dia_qa22_davita_brand_casing.sql, function block only)

-- Drop the audit tables if you want a clean state
DROP TABLE IF EXISTS public.provenance_event_log;  -- on dia and gov
```

Note: the `provenance_event_log` table is per-DB so dropping on dia doesn't
affect gov and vice versa. Both can be dropped independently.

## Closes / blocks

- Closes: **R2-W-1** (CRITICAL), **R2-W-2** (CRITICAL)
- Defers (creates the data plane for): **R2-W-1b / R2-W-2b** —
  `lcc-provenance-event-flush` cron that drains `provenance_event_log` into
  LCC Opps `field_provenance`. Captured as the first follow-up item.
- Does NOT close: **A-16** (auto_supersede_expired_leases trigger) — same
  failure class but separate trigger. Apply the same provenance_event_log
  pattern when that one is addressed.

## Files

- `supabase/migrations/20260519110000_lcc_r2_w1_canonicalizer_source_registry.sql`
- `supabase/migrations/dialysis/20260519110000_dia_r2_w1_provenance_event_log_qa22_trigger.sql`
- `supabase/migrations/government/20260519110000_gov_r2_w2_provenance_event_log_qa24_qa30_backfill.sql`
- `audit/patches/R2-W-1-W-2-provenance-event-log/apply.mjs`
- `audit/patches/R2-W-1-W-2-provenance-event-log/README.md`
- `audit/patches/R2-W-1-W-2-provenance-event-log/COMMIT_MSG.txt`
- `audit/ROUND_2_FINDINGS_2026-05-19.md` (closeout block appended by apply.mjs)
