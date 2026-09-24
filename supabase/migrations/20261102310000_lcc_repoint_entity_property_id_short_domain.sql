-- CONSOLIDATE-REVERSIBLE (2026-09-24) — lcc_repoint_entity_property_id matched nothing.
--
-- The merge-log reconcile repoints LCC asset entities from a merged-away domain
-- property id to the kept id. This helper required p_domain in
-- ('dialysis','government') and then filtered `e.domain = p_domain` — but
-- entities.domain is canonical short-form ('dia'/'gov') since the domain
-- canonicalisation. Measured 2026-09-24: asset entities with domain='dialysis'
-- = 0, 'government' = 0; 'dia' = 1,972, 'gov' = 10,109. So every repoint since
-- the canonicalisation updated 0 rows while the reconcile stamped its log rows
-- "reconciled". (83 dia assets carry _round_76ee_repointed_at from before it.)
--
-- Fix: accept either spelling for p_domain and match BOTH spellings on
-- e.domain. Body otherwise byte-for-byte the live definition. Signature and
-- grants unchanged (CREATE OR REPLACE keeps the ACL; not SECURITY DEFINER).
-- This was a live-only object with no committed source until now.
--
-- Revert: re-create with `e.domain = p_domain` and the long-form-only check.

CREATE OR REPLACE FUNCTION public.lcc_repoint_entity_property_id(p_domain text, p_keep_id text, p_drop_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_rows integer := 0;
  v_keep_num numeric;
  v_short text;
  v_long text;
BEGIN
  v_short := CASE lower(p_domain) WHEN 'dialysis' THEN 'dia' WHEN 'dia' THEN 'dia'
                                  WHEN 'government' THEN 'gov' WHEN 'gov' THEN 'gov' END;
  IF v_short IS NULL THEN
    RAISE EXCEPTION 'p_domain must be dia/dialysis or gov/government, got %', p_domain;
  END IF;
  v_long := CASE v_short WHEN 'dia' THEN 'dialysis' ELSE 'government' END;
  IF p_keep_id IS NULL OR p_drop_id IS NULL OR p_keep_id = p_drop_id THEN
    RETURN 0;
  END IF;

  BEGIN
    v_keep_num := p_keep_id::numeric;
  EXCEPTION WHEN others THEN
    v_keep_num := NULL;
  END;

  UPDATE public.entities e
  SET
    metadata = COALESCE(e.metadata, '{}'::jsonb)
      || jsonb_build_object('domain_property_id', p_keep_id)
      || CASE
           WHEN v_keep_num IS NOT NULL
                AND e.metadata ? '_pipeline_summary'
                AND (e.metadata->'_pipeline_summary') ? 'domain_property_id'
           THEN jsonb_build_object(
                  '_pipeline_summary',
                  (e.metadata->'_pipeline_summary')
                    || jsonb_build_object('domain_property_id', v_keep_num)
                )
           ELSE '{}'::jsonb
         END
      || jsonb_build_object(
           '_round_76ee_repointed_at', to_jsonb(now()),
           '_round_76ee_prev_property_id', to_jsonb(p_drop_id)
         ),
    updated_at = now()
  WHERE e.entity_type = 'asset'
    AND e.domain IN (v_short, v_long)
    AND (
      e.metadata->>'domain_property_id' = p_drop_id
      OR (
        e.metadata->'_pipeline_summary'->>'domain_property_id' = p_drop_id
      )
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;
