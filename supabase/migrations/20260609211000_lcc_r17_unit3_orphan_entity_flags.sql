-- R17 Unit 3: orphan-entity hygiene. Soft-flag entities with NO relationship,
-- NO external identity, and NO portfolio fact (reversible metadata flag, mirrors
-- the R4-A junk_name_flagged posture). Name-match / picker surfaces exclude
-- flagged orphans (operations.js getBuyerContacts). Re-evaluated on a schedule:
-- an entity that later gains an edge clears the flag.
--
-- Applied live 2026-06-09: 698 orphans flagged (down from a pre-merge 1,028 -
-- the Unit 2 fuzzy-merge drain absorbed ~330 orphan-duplicates first).
CREATE OR REPLACE FUNCTION public.lcc_refresh_orphan_flags()
RETURNS TABLE(flagged integer, cleared integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_flagged integer;
  v_cleared integer;
BEGIN
  WITH cleared AS (
    UPDATE public.entities e
    SET metadata = (e.metadata - 'orphan_flagged' - 'orphan_flagged_at')
    WHERE COALESCE((e.metadata->>'orphan_flagged')::boolean, false)
      AND (
        e.merged_into_entity_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id)
        OR EXISTS (SELECT 1 FROM public.external_identities x WHERE x.entity_id = e.id)
        OR EXISTS (SELECT 1 FROM public.lcc_entity_portfolio_facts pf WHERE pf.entity_id = e.id)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM cleared;

  WITH newly AS (
    UPDATE public.entities e
    SET metadata = COALESCE(e.metadata, '{}'::jsonb)
                   || jsonb_build_object('orphan_flagged', true, 'orphan_flagged_at', now())
    WHERE e.merged_into_entity_id IS NULL
      AND NOT COALESCE((e.metadata->>'orphan_flagged')::boolean, false)
      AND NOT EXISTS (SELECT 1 FROM public.entity_relationships r WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM public.external_identities x WHERE x.entity_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM public.lcc_entity_portfolio_facts pf WHERE pf.entity_id = e.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_flagged FROM newly;

  flagged := v_flagged;
  cleared := v_cleared;
  RETURN NEXT;
END;
$function$;

SELECT * FROM public.lcc_refresh_orphan_flags();

DO $cron$
BEGIN
  PERFORM cron.unschedule('lcc-orphan-flag-refresh') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'lcc-orphan-flag-refresh');
  PERFORM cron.schedule('lcc-orphan-flag-refresh', '40 6 * * *',
    $$SELECT public.lcc_refresh_orphan_flags()$$);
END
$cron$;
