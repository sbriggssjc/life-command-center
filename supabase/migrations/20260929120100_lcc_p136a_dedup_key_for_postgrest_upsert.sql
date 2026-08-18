-- ============================================================================
-- P136a — make the staging table's dedup key USABLE BY PostgREST.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- MY BUG, caught by the live load: 500 of 3,281 rows failed with 23505.
--
--   P136 put the uniqueness on an EXPRESSION index:
--     (batch_tag, medicare_ccn, coalesce(recorded_owner,''), coalesce(true_owner,''))
--   coalesce() is required because Postgres treats NULLs as DISTINCT, so a plain
--   column index would never dedupe the many rows with a NULL owner.
--
--   But PostgREST's `on_conflict=` takes COLUMN NAMES ONLY -- it cannot express
--   a coalesce() arbiter. Without an inferable arbiter, `Prefer:
--   resolution=ignore-duplicates` falls back to the PRIMARY KEY, which here is a
--   bigserial that can never collide. So ON CONFLICT DO NOTHING never armed, and
--   a single duplicate poisoned its entire 500-row chunk.
--
--   The workbook has exactly 10 genuine in-file duplicate keys (e.g. CCN 172574
--   "Susan B Allen Memorial Hospital" twice). Ten rows cost five hundred.
--
-- GENERALISABLE RULE (worth carrying to any new PostgREST-loaded staging table):
--   an expression / partial unique index is fine for a SQL writer and useless to
--   PostgREST. If rows arrive over REST, the dedup key must be a single plain
--   column -- generate it if the real key needs coalesce() or normalisation.
--   Adjacent CLAUDE.md footguns: "ON CONFLICT on a CREATE UNIQUE INDEX must use
--   the index-inference form" and "GENERATED ALWAYS columns must be omitted from
--   INSERTs" (the loader never sends dedup_key).
--
-- Mirrors dia.sales_transactions.dedup_natural_key.
--
-- REVERSAL:
--   drop index public.uq_lcc_dia_ownership_master_dedup;
--   alter table public.lcc_dia_ownership_master drop column dedup_key;
--   create unique index uq_lcc_dia_ownership_master_row
--     on public.lcc_dia_ownership_master
--        (batch_tag, medicare_ccn, coalesce(recorded_owner,''), coalesce(true_owner,''));
-- ============================================================================

ALTER TABLE public.lcc_dia_ownership_master
  ADD COLUMN IF NOT EXISTS dedup_key text
  GENERATED ALWAYS AS (
    batch_tag || '|' || medicare_ccn || '|' ||
    coalesce(recorded_owner, '') || '|' || coalesce(true_owner, '')
  ) STORED;

DROP INDEX IF EXISTS public.uq_lcc_dia_ownership_master_row;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_dia_ownership_master_dedup
  ON public.lcc_dia_ownership_master (dedup_key);

COMMENT ON COLUMN public.lcc_dia_ownership_master.dedup_key IS
  'P136a. GENERATED. Exists so PostgREST can arbitrate an upsert '
  '(?on_conflict=dedup_key) -- its on_conflict= cannot express the coalesce() '
  'the real key needs, and without an inferable arbiter ignore-duplicates '
  'silently falls back to the never-colliding serial PK. Omit from INSERTs.';
