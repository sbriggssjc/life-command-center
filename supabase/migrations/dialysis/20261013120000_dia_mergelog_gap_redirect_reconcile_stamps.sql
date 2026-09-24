-- MERGELOG-GAP (2026-09-24) — let the LCC merge-log reconcile read
-- dia_property_redirects, and record when an unmerge has been followed through.
--
-- dia_merge_property writes dia_property_redirects on EVERY merge (1,267 rows:
-- the property_merge_log / merge_backup / p31 / dq7 / consolidation-log
-- backfills plus the live geospatial_cron and merge_reversible sources). The
-- LCC reconcile only ever read property_merge_log and dia_property_merge_backup,
-- so the 12 geospatial_cron merges (2026-09-12..24, cron jobid 16, still
-- running) left their LCC asset entities pointing at deleted rows — 6 of the 47
-- dangling dia ids measured 2026-09-24.
--
-- 1. dia_property_redirects gains reconciled_lcc_at / reconciled_lcc_count, the
--    same stamp the other two ledgers carry, so a cron tick never re-scans a row.
-- 2. v_dia_property_redirect_resolved gains redirect_id + reconciled_lcc_at +
--    reconciled_lcc_count, APPENDED (CREATE OR REPLACE VIEW is append-only for
--    columns). The reconcile reads final_survivor_id, which follows chains
--    through dia_resolve_property_id, and stamps the base row by redirect_id.
-- 3. dia_property_merge_backup gains unmerge_reconciled_lcc_at /
--    unmerge_reconciled_lcc_count: set when the reconcile has moved entities
--    back to a property that dia_unmerge_property restored.
--
-- Additive only. Revert: drop the five columns and re-create the view without
-- the three trailing columns.

ALTER TABLE public.dia_property_redirects
  ADD COLUMN IF NOT EXISTS reconciled_lcc_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_lcc_count integer;

CREATE OR REPLACE VIEW public.v_dia_property_redirect_resolved AS
 SELECT r.dropped_property_id,
    r.kept_property_id AS recorded_survivor_id,
    dia_resolve_property_id(r.dropped_property_id) AS final_survivor_id,
    (r.kept_property_id IS DISTINCT FROM dia_resolve_property_id(r.dropped_property_id)) AS is_chained,
    r.source,
    r.batch_tag,
    r.merged_at,
    r.reversed_at,
    r.note,
    r.redirect_id,
    r.reconciled_lcc_at,
    r.reconciled_lcc_count
   FROM dia_property_redirects r;

ALTER TABLE public.dia_property_merge_backup
  ADD COLUMN IF NOT EXISTS unmerge_reconciled_lcc_at    timestamptz,
  ADD COLUMN IF NOT EXISTS unmerge_reconciled_lcc_count integer;

CREATE INDEX IF NOT EXISTS idx_dia_property_redirects_unreconciled
  ON public.dia_property_redirects (merged_at) WHERE reconciled_lcc_at IS NULL AND reversed_at IS NULL;

NOTIFY pgrst, 'reload schema';

-- 4. v_property_id_census returned ZERO rows to anon (P157 shape). It was
--    security_invoker=on, so anon hit properties' RLS and PostgREST answered
--    200 [] for every page. Measured 2026-09-24: service_role 11,844 rows,
--    `set role anon` 0. The LCC R22 mirror-orphan reconcile and the new
--    MERGELOG-GAP guard both page this view as anon; R22's completeness guard
--    passed (every page 200, last page empty) and only its live-id floor kept it
--    from pruning. The view exposes property_id and a NULL status, nothing else.
--    ⚠️ Flipping to security_invoker=off makes the view run as its owner, and
--    anon/authenticated held INSERT/UPDATE/DELETE on it (a simple view over one
--    table is auto-updatable), so a write through it would have run as the
--    owner too. Writes are revoked in the same statement group: SELECT only.
REVOKE ALL ON public.v_property_id_census FROM public, anon, authenticated;
GRANT SELECT ON public.v_property_id_census TO anon, authenticated, service_role;
ALTER VIEW public.v_property_id_census SET (security_invoker = off);

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.v_property_id_census', 'INSERT')
     OR has_table_privilege('anon', 'public.v_property_id_census', 'UPDATE')
     OR has_table_privilege('anon', 'public.v_property_id_census', 'DELETE')
     OR NOT has_table_privilege('anon', 'public.v_property_id_census', 'SELECT') THEN
    RAISE EXCEPTION 'MERGELOG-GAP: v_property_id_census anon privileges are not SELECT-only';
  END IF;
END $$;
