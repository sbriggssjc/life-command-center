# Week 0 Foundations — Apply Runbook

**Status:** code complete, locally verified against PostgreSQL 16. **Not yet applied to remote Supabase projects.**

Companion to `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md`. Covers foundations F1–F4 (audit_run_log, quarantine columns, cap_rate_bands, data-health views). Everything else in the plan builds on these, so this is the gate.

## What lands

### LCC Opps (1 migration)
- `supabase/migrations/20260523120000_lcc_audit_run_log_and_cleanup_helpers.sql`
  - `public.audit_run_log` (cross-domain run ledger)
  - `audit_run_begin()`, `audit_run_finish()` — lifecycle helpers
  - `record_cleanup_provenance()` — wraps `field_provenance` with cleanup tagging

### dia (3 migrations)
- `supabase/migrations/dialysis/20260523120010_dia_quarantine_states_and_dedup_key.sql`
  - `sales_transactions.transaction_state` (default `'live'`)
  - `sales_transactions.dedup_group_id`
  - `sales_transactions.dedup_natural_key` (generated, immutable)
  - `ownership_history.ownership_state` (default `'active'`)
  - Partial indexes for fast quarantine sweeps
- `supabase/migrations/dialysis/20260523120020_dia_cap_rate_bands.sql`
  - `cap_rate_bands` table + 7 seed rows + `cap_rate_band_for()` RPC
- `supabase/migrations/dialysis/20260523120030_dia_v_data_health.sql`
  - `v_data_health_sales`, `v_data_health_ownership`, `v_data_health_entities`

### gov (3 migrations)
- Mirror trio: `government/20260523120010_*`, `20260523120020_*`, `20260523120030_*`

## Properties of these migrations

- **Zero behavior change** on existing rows. All new columns have defaults; all new tables are empty until used; all new views are read-only.
- **Idempotent.** Every `CREATE TABLE` uses `IF NOT EXISTS`; every `ADD COLUMN` uses `IF NOT EXISTS`; every check constraint is guarded by a `pg_constraint` lookup; the cap_rate_bands seed uses a `NOT EXISTS` guard.
- **Forward-only.** No `.down.sql`; rollback strategy below.

## Local verification (already done)

```
=== dia ===
--- 20260523120010_dia_quarantine_states_and_dedup_key.sql ---  OK
--- 20260523120020_dia_cap_rate_bands.sql ---                   OK (7 seed rows)
--- 20260523120030_dia_v_data_health.sql ---                    OK

=== gov ===
--- 20260523120010_gov_quarantine_states_and_dedup_key.sql ---  OK
--- 20260523120020_gov_cap_rate_bands.sql ---                   OK (7 seed rows)
--- 20260523120030_gov_v_data_health.sql ---                    OK
```

Bugs caught locally and fixed pre-push:
1. `to_char(date, 'YYYY-MM')` is STABLE, not IMMUTABLE — replaced with `EXTRACT` arithmetic.
2. `concat_ws()` is STABLE — replaced with `||`.

Both `dedup_natural_key` and the views verified to compute correctly on a seeded dataset (duplicates flagged, NULL inputs handled, cap rate band lookup falls back to 'default' for unknown classes).

## Pre-apply checklist

1. **Snapshot first.** Per F1, take a snapshot before any change:
   ```bash
   # LCC Opps
   pg_dump "$OPS_SUPABASE_DB_URL" -n public --clean --if-exists \
     > scripts/audit/snapshots/snapshot-ops-$(date +%Y%m%d).sql
   # dia
   pg_dump "$DIA_SUPABASE_DB_URL" -n public --clean --if-exists \
     > scripts/audit/snapshots/snapshot-dia-$(date +%Y%m%d).sql
   # gov
   pg_dump "$GOV_SUPABASE_DB_URL" -n public --clean --if-exists \
     > scripts/audit/snapshots/snapshot-gov-$(date +%Y%m%d).sql
   ```
   (`scripts/audit/snapshots/` is gitignored.)

2. **Confirm `field_provenance` exists on LCC Opps.** Required for the helpers:
   ```sql
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'field_provenance';
   ```
   Should return one row.

3. **Confirm required tables exist on dia/gov.** Required for the migrations:
   ```sql
   SELECT relname FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname IN ('sales_transactions','ownership_history','properties','recorded_owners','true_owners');
   -- Expect 5 rows on each domain.
   ```

## Apply order (must follow)

```
1) LCC Opps:  20260523120000_lcc_audit_run_log_and_cleanup_helpers.sql
2) dia:       20260523120010_dia_quarantine_states_and_dedup_key.sql
3) dia:       20260523120020_dia_cap_rate_bands.sql
4) dia:       20260523120030_dia_v_data_health.sql
5) gov:       20260523120010_gov_quarantine_states_and_dedup_key.sql
6) gov:       20260523120020_gov_cap_rate_bands.sql
7) gov:       20260523120030_gov_v_data_health.sql
```

Steps 2-4 must run in order on dia. Steps 5-7 must run in order on gov. The two domain blocks are independent.

### Apply options

**Option A — Supabase Dashboard SQL editor** (lowest risk; one file at a time):
- Open the project's SQL editor.
- Paste each file's contents, run, confirm success.
- Move to the next file.

**Option B — Supabase CLI** (faster if you have `supabase db push` configured):
- The files are already in the canonical migration directories. From a checkout of this branch, `supabase db push` will pick them up.
- Recommend running against a Supabase branch first (one each for dia/gov/ops) before promoting to main.

**Option C — Supabase MCP `apply_migration`** (one-call-per-file):
- Each migration file is a single `apply_migration` call. The Supabase MCP server is available; the assistant can invoke it on your authorization for each step.

## Post-apply verification

Run the smoke test:

```bash
node scripts/audit/verify-foundations.mjs
```

Expected:
- 7 cap_rate_bands seed rows visible on each of dia and gov.
- `transaction_state`, `dedup_group_id`, `dedup_natural_key` exist on `sales_transactions` (dia + gov).
- `ownership_state` exists on `ownership_history` (dia + gov).
- All three `v_data_health_*` views return exactly 1 row each (dia + gov).
- `audit_run_begin` / `audit_run_finish` / `record_cleanup_provenance` callable on LCC Opps.
- Smoke test exits with code 0.

Then snapshot the baseline:

```bash
psql "$DIA_SUPABASE_DB_URL" -c "SELECT * FROM v_data_health_sales;"
psql "$DIA_SUPABASE_DB_URL" -c "SELECT * FROM v_data_health_ownership;"
psql "$DIA_SUPABASE_DB_URL" -c "SELECT * FROM v_data_health_entities;"
# same for gov
```

Save these to `docs/ownership_sales_remediation/baselines/<date>/` so we can measure Track A/B progress against them.

## Rollback

If something goes wrong mid-apply, no rollback migration is needed for partial state — all new objects are `IF NOT EXISTS`-guarded and additive. You can either re-run the failing file after fixing, or simply leave the additive changes in place (they have no consumers yet).

If full rollback is needed before any consumer is wired up:

```sql
-- dia / gov (run on each)
DROP VIEW IF EXISTS public.v_data_health_entities;
DROP VIEW IF EXISTS public.v_data_health_ownership;
DROP VIEW IF EXISTS public.v_data_health_sales;
DROP FUNCTION IF EXISTS public.cap_rate_band_for(text, date);
DROP TABLE IF EXISTS public.cap_rate_bands;
DROP INDEX IF EXISTS public.idx_ownership_history_state;
ALTER TABLE public.ownership_history DROP CONSTRAINT IF EXISTS chk_ownership_state;
ALTER TABLE public.ownership_history DROP COLUMN IF EXISTS ownership_state;
DROP INDEX IF EXISTS public.idx_sales_transactions_dedup_key;
DROP INDEX IF EXISTS public.idx_sales_transactions_state;
ALTER TABLE public.sales_transactions DROP COLUMN IF EXISTS dedup_natural_key;
ALTER TABLE public.sales_transactions DROP COLUMN IF EXISTS dedup_group_id;
ALTER TABLE public.sales_transactions DROP CONSTRAINT IF EXISTS chk_sales_transaction_state;
ALTER TABLE public.sales_transactions DROP COLUMN IF EXISTS transaction_state;

-- LCC Opps
DROP FUNCTION IF EXISTS public.audit_run_finish(bigint, text, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.audit_run_begin(text, text, text, boolean, bigint, text, jsonb);
DROP FUNCTION IF EXISTS public.record_cleanup_provenance(text, text, text, text, text, jsonb, text, numeric);
DROP TABLE IF EXISTS public.audit_run_log;
```

## What's next after this lands

Once verify-foundations.mjs passes against the real projects:

1. Capture baseline `v_data_health_*` readings into `docs/ownership_sales_remediation/baselines/`.
2. Start on **Track C, Week 1**:
   - C1 schema parity additions on gov (`recorded_date`, `sale_notes_raw`, `sale_notes_extracted`, broker-contact columns).
   - C3 scraper changes (Python — persist `property_id`, `situs_address`, `apn`, `recording_date`).
   - C6 silent-failure fix on `ownership_research_queue` writers.
   - C8 RCM/LoopNet auth fix.
3. In parallel, build **Track B1 (sales-dedup-tick)** and **B5 (cap-rate-quality-tick)** — both can run safely on the foundations alone.
