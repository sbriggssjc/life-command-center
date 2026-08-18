-- ============================================================================
-- P136b — give the staged workbook a link to the dia property.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- MEASURED BLOCKER: the CCN is a perfect key into dia, and a nearly empty one
-- into LCC. Of 3,236 workbook CCNs only 115 resolve through
-- external_identities(source_system='cms', source_type='medicare_ccn') --
-- because LCC holds just 345 CMS identities in total, against ~11.8k dia
-- clinics. The canonical identity scheme in CLAUDE.md reserves that slot; it was
-- simply never populated at scale. (Worth fixing on its own merits later; this
-- migration does not attempt it.)
--
-- So the bridge is built dia-side: CCN -> dia.medicare_clinics.property_id ->
-- lcc_entity_portfolio_facts(source_domain='dia', source_property_id). That is a
-- cross-PROJECT join, so it is resolved over REST by
-- scripts/resolve-dia-ownership-property-ids.mjs rather than in SQL.
--
-- Nothing here interprets ownership. This only says "the workbook row for CCN X
-- is about dia property Y".
--
-- REVERSAL:
--   drop function public.lcc_apply_dia_ownership_property_link(jsonb);
--   alter table public.lcc_dia_ownership_master
--     drop column source_property_id, drop column property_link_status;
-- ============================================================================

ALTER TABLE public.lcc_dia_ownership_master
  ADD COLUMN IF NOT EXISTS source_property_id text,
  ADD COLUMN IF NOT EXISTS property_link_status text;

CREATE INDEX IF NOT EXISTS idx_lcc_dia_ownership_master_prop
  ON public.lcc_dia_ownership_master (source_property_id)
  WHERE source_property_id IS NOT NULL;

COMMENT ON COLUMN public.lcc_dia_ownership_master.source_property_id IS
  'P136b. dia properties.property_id, resolved from medicare_ccn via '
  'dia.medicare_clinics. Joins to lcc_entity_portfolio_facts / '
  'lcc_property_attributes on (source_domain=''dia'', source_property_id).';
COMMENT ON COLUMN public.lcc_dia_ownership_master.property_link_status IS
  'P136b. linked | no_clinic (CCN unknown to dia) | no_property (clinic exists '
  'but carries no property_id). Recorded so an unresolved row is visibly '
  'unresolved rather than silently absent.';

-- ---------------------------------------------------------------------------
-- The write-back seam.
--
-- WHY AN RPC AND NOT A PostgREST UPSERT: the obvious `POST ...?on_conflict=id`
-- with `resolution=merge-duplicates` does NOT work here. Postgres evaluates
-- NOT NULL before ON CONFLICT, so a payload of
-- {id, source_property_id, property_link_status} fails 23502 on medicare_ccn /
-- batch_tag before the conflict can be detected. A per-row PATCH would be
-- ~3,271 round trips. So: one function, one array, chunked by the caller.
--
-- (Same family as the P136a lesson -- PostgREST's upsert surface is narrower
-- than SQL's, and the failure mode is a misleading status code rather than a
-- clear error.)
--
-- FILL-BLANKS: only touches rows whose source_property_id IS NULL, so a link
-- corrected by hand is never overwritten by a later re-run.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lcc_apply_dia_ownership_property_link(
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
declare
  v_n integer;
begin
  with incoming as (
    select (e->>'id')::bigint                     as id,
           nullif(e->>'source_property_id','')    as source_property_id,
           nullif(e->>'property_link_status','')  as property_link_status
    from jsonb_array_elements(p_rows) e
  )
  update public.lcc_dia_ownership_master m
     set source_property_id   = i.source_property_id,
         property_link_status = i.property_link_status
    from incoming i
   where m.id = i.id
     and m.source_property_id is null;   -- fill-blanks only
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

COMMENT ON FUNCTION public.lcc_apply_dia_ownership_property_link(jsonb) IS
  'P136b. Applies the CCN->dia property_id resolution produced by '
  'scripts/resolve-dia-ownership-property-ids.mjs. Fill-blanks only. An RPC '
  'rather than a PostgREST upsert because NOT NULL is evaluated before ON '
  'CONFLICT, so a partial-column upsert 23502s instead of merging.';

GRANT EXECUTE ON FUNCTION public.lcc_apply_dia_ownership_property_link(jsonb) TO service_role;
