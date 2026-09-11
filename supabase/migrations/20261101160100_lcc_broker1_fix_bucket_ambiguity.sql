-- ============================================================================
-- BROKER1 hotfix (2026-09-11, Cowork) — fix bucket-column ambiguity found and
-- fixed live against xengecqvemvfknjvbvrq.
-- ----------------------------------------------------------------------------
-- lcc_broker1_assign_prospect_brokers's own RETURNS TABLE(bucket text, n
-- bigint) makes `bucket` an implicit PL/pgSQL variable in the function body,
-- colliding with _b1_default.bucket in three `count(*) FILTER (WHERE bucket
-- = '...')` lines -- Postgres 42702 "column reference \"bucket\" is
-- ambiguous". The prior migration's own privilege self-check passed (it
-- never calls the function), so this was never caught until the first real
-- invocation. The 13-test Node guard could not have caught it either -- none
-- of those tests touch live Postgres.
--
-- Fix only: qualify every `bucket` reference inside the three FILTER clauses
-- and the final default-buckets SELECT with the temp table's own alias (`d`).
-- No behavior change -- same rule, same buckets, same fill-blanks-only
-- discipline as the original migration's own header documents in full.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_broker1_assign_prospect_brokers(p_dry_run boolean DEFAULT true)
RETURNS TABLE(bucket text, n bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scott uuid;
  v_kelly uuid;
  v_nate  uuid;
  v_gov bigint := 0;
  v_dia bigint := 0;
  v_catchall bigint := 0;
  v_already_sf bigint := 0;
  v_already_manual bigint := 0;
BEGIN
  SELECT lcc_user_id INTO v_scott FROM public.lcc_users
   WHERE lower(display_name) LIKE 'scott%' AND COALESCE(active, true) LIMIT 1;
  SELECT lcc_user_id INTO v_kelly FROM public.lcc_users
   WHERE lower(display_name) LIKE 'kelly%' AND COALESCE(active, true) LIMIT 1;
  SELECT lcc_user_id INTO v_nate FROM public.lcc_users
   WHERE lower(display_name) LIKE 'nate%' AND COALESCE(active, true) LIMIT 1;

  IF v_scott IS NULL OR v_kelly IS NULL THEN
    RAISE EXCEPTION 'lcc_broker1_assign_prospect_brokers: could not resolve Scott/Kelly in lcc_users (scott=%, kelly=%)',
      v_scott, v_kelly;
  END IF;

  CREATE TEMP TABLE _b1_prospects ON COMMIT DROP AS
  SELECT DISTINCT q.entity_id, e.domain
  FROM public.lcc_priority_queue_resolved q
  JOIN public.entities e ON e.id = q.entity_id
  WHERE q.entity_id IS NOT NULL;

  SELECT count(*) INTO v_already_sf FROM _b1_prospects p
    JOIN public.lcc_entity_owner_override o ON o.entity_id = p.entity_id
   WHERE COALESCE(o.set_by, '') LIKE 'sf_owner%' OR COALESCE(o.set_by, '') LIKE 'broker1_roe_self%';

  SELECT count(*) INTO v_already_manual FROM _b1_prospects p
    JOIN public.lcc_entity_owner_override o ON o.entity_id = p.entity_id
   WHERE NOT (COALESCE(o.set_by, '') LIKE 'sf_owner%' OR COALESCE(o.set_by, '') LIKE 'broker1_roe_self%')
     AND NOT (COALESCE(o.set_by, '') LIKE 'broker1_%');

  CREATE TEMP TABLE _b1_default ON COMMIT DROP AS
  SELECT p.entity_id,
         CASE WHEN p.domain IN ('dia', 'dialysis') THEN v_kelly ELSE v_scott END AS owner_user_id,
         CASE WHEN p.domain IN ('dia', 'dialysis') THEN 'dia_default'
              WHEN p.domain IN ('gov', 'government') THEN 'gov_default'
              ELSE 'catchall_default' END AS bucket
  FROM _b1_prospects p
  WHERE NOT EXISTS (SELECT 1 FROM public.lcc_entity_owner_override o WHERE o.entity_id = p.entity_id);

  -- Structural guard, not a runtime check: Nate is never referenced as a
  -- candidate owner anywhere above, so this function cannot assign him.
  PERFORM 1 WHERE v_nate IS NULL; -- no-op; v_nate resolved for reporting only, never used as an owner value below

  -- FIX: qualified with the temp table alias `d` -- `bucket` bare collides
  -- with this function's own RETURNS TABLE(bucket text, ...) column name.
  SELECT count(*) FILTER (WHERE d.bucket = 'gov_default') INTO v_gov FROM _b1_default d;
  SELECT count(*) FILTER (WHERE d.bucket = 'dia_default') INTO v_dia FROM _b1_default d;
  SELECT count(*) FILTER (WHERE d.bucket = 'catchall_default') INTO v_catchall FROM _b1_default d;

  IF p_dry_run THEN
    RETURN QUERY VALUES
      ('already_resolved_via_roe_signal', v_already_sf),
      ('already_manual_assignment_left_alone', v_already_manual),
      ('would_default_gov_to_scott', v_gov),
      ('would_default_dia_to_kelly', v_dia),
      ('would_default_catchall_to_scott', v_catchall);
    RETURN;
  END IF;

  INSERT INTO public.lcc_entity_owner_override (entity_id, owner_user_id, set_by, note)
  SELECT d.entity_id, d.owner_user_id, 'broker1_' || d.bucket, 'BROKER1 vertical-default assignment'
  FROM _b1_default d
  ON CONFLICT (entity_id) DO NOTHING; -- fill-blanks only; never reassigns

  RETURN QUERY VALUES
    ('already_resolved_via_roe_signal', v_already_sf),
    ('already_manual_assignment_left_alone', v_already_manual),
    ('defaulted_gov_to_scott', v_gov),
    ('defaulted_dia_to_kelly', v_dia),
    ('defaulted_catchall_to_scott', v_catchall);
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_broker1_assign_prospect_brokers(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_broker1_assign_prospect_brokers(boolean) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_broker1_assign_prospect_brokers(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_broker1_assign_prospect_brokers: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_broker1_assign_prospect_brokers(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_broker1_assign_prospect_brokers: anon must NOT be able to execute this (mutating)';
  END IF;
END $$;
