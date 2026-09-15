-- ============================================================================
-- OWN-T0i (2026-09-15) — extend broker default assignment to every reachable
-- current OR prior target-market owner, not just the live priority-queue's
-- lease-timing bands.
-- ----------------------------------------------------------------------------
-- Decision #6 of Scott's six ownership-pipeline decisions, closing round.
-- Scott's follow-up answer, verbatim: "Yes, we want to pursue, in research,
-- until every current and prior owner of a building leased to one of the
-- operators or agencies in our target swimlanes (dialysis and government-
-- leased) are known and connected to our LCC app and code processes. The
-- brokers can then make the election on whether to pursue the account or not
-- individually, with the guidance and coaching of the LCC on the next best
-- relatively important lead."
--
-- REUSED, NOT REBUILT, again: this is the exact same vertical-default policy
-- BROKER1 already shipped and ran live 2026-09-11
-- (lcc_broker1_assign_prospect_brokers) — fill-blanks-only, gov->Scott,
-- dia->Kelly Largent, else->Scott catch-all, Nate never assigned. BROKER1's
-- own population is `lcc_priority_queue_resolved` (the seller-prospecting
-- queue's lease-timing bands); this migration does NOT touch that function or
-- its population definition. It ADDS the same policy over the wider
-- population Scott just asked for: every entity that is a CURRENT owner of a
-- target-market asset, or a PRIOR owner (held one, holds none now), gated on
-- the SAME reachability signal C6 already established
-- (owner_contact_pivot.active_contact_entity_id IS NOT NULL) -- assigning a
-- broker to an owner nobody can contact is not "connected," it is just a row.
--
-- Role classification was investigated and needs NO migration: the live
-- deterministic role-SET view (v_lcc_entity_roles, owner-role-classification.md)
-- already correctly tags 445 of 447 reachable current owners `investor_owner`
-- and 3,804 of 3,820 prior owners `former_owner` — the stale label lives only
-- in the OLD scalar entities.owner_role/behavioral_override column, which C6
-- already stopped gating on. This migration does not touch that column either
-- -- rewriting it would duplicate a value the SET model already computes live
-- and correctly, the exact "second registry" class this repo avoids (P116).
--
-- Discipline, matching every prior OWN-T/BROKER1 migration this session:
-- fill-blanks-only (ON CONFLICT DO NOTHING, never reassigns an existing row,
-- from ANY source) · reversible (set_by tag; delete
-- WHERE set_by LIKE 'own_t0i_%' to undo) · idempotent · dry-run-default ·
-- honest counts (named buckets, never a blended total).
--
-- Verify:  select bucket, n from lcc_own_t0i_extend_broker_assignment(true);
-- Apply:   select bucket, n from lcc_own_t0i_extend_broker_assignment(false);
-- Reverse: delete from lcc_entity_owner_override where set_by like 'own_t0i_%';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_own_t0i_extend_broker_assignment(p_dry_run boolean DEFAULT true)
RETURNS TABLE(bucket text, n bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scott uuid;
  v_kelly uuid;
BEGIN
  SELECT lcc_user_id INTO v_scott FROM public.lcc_users
   WHERE lower(display_name) LIKE 'scott%' AND COALESCE(active, true) LIMIT 1;
  SELECT lcc_user_id INTO v_kelly FROM public.lcc_users
   WHERE lower(display_name) LIKE 'kelly%' AND COALESCE(active, true) LIMIT 1;

  IF v_scott IS NULL OR v_kelly IS NULL THEN
    RAISE EXCEPTION 'lcc_own_t0i_extend_broker_assignment: could not resolve Scott/Kelly in lcc_users (scott=%, kelly=%)',
      v_scott, v_kelly;
  END IF;

  CREATE TEMP TABLE _t0i_reachable_owners ON COMMIT DROP AS
  WITH reach_current AS (
    SELECT DISTINCT e.id, e.domain
    FROM public.entities e
    JOIN public.lcc_entity_portfolio_facts f ON f.entity_id = e.id AND f.is_current
    WHERE e.merged_into_entity_id IS NULL
      AND EXISTS (SELECT 1 FROM public.owner_contact_pivot ocp
                   WHERE ocp.entity_id = e.id AND ocp.active_contact_entity_id IS NOT NULL)
  ),
  reach_prior AS (
    SELECT DISTINCT e.id, e.domain
    FROM public.entities e
    JOIN public.lcc_entity_portfolio_facts f ON f.entity_id = e.id
    WHERE f.is_current = false
      AND e.merged_into_entity_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.lcc_entity_portfolio_facts f2
                        WHERE f2.entity_id = e.id AND f2.is_current = true)
      AND EXISTS (SELECT 1 FROM public.owner_contact_pivot ocp
                   WHERE ocp.entity_id = e.id AND ocp.active_contact_entity_id IS NOT NULL)
  )
  SELECT id, domain FROM reach_current
  UNION
  SELECT id, domain FROM reach_prior;

  CREATE TEMP TABLE _t0i_default ON COMMIT DROP AS
  SELECT p.id AS entity_id,
         CASE WHEN p.domain IN ('dia', 'dialysis') THEN v_kelly ELSE v_scott END AS owner_user_id,
         CASE WHEN p.domain IN ('dia', 'dialysis') THEN 'dia_default'
              WHEN p.domain IN ('gov', 'government') THEN 'gov_default'
              ELSE 'catchall_default' END AS bucket
  FROM _t0i_reachable_owners p
  WHERE NOT EXISTS (SELECT 1 FROM public.lcc_entity_owner_override o WHERE o.entity_id = p.id);

  IF p_dry_run THEN
    RETURN QUERY
      SELECT 'would_' || d.bucket, count(*) FROM _t0i_default d GROUP BY d.bucket
      UNION ALL
      SELECT 'already_assigned', count(*) FROM _t0i_reachable_owners p
        WHERE EXISTS (SELECT 1 FROM public.lcc_entity_owner_override o WHERE o.entity_id = p.id);
    RETURN;
  END IF;

  INSERT INTO public.lcc_entity_owner_override (entity_id, owner_user_id, set_by, note)
  SELECT entity_id, owner_user_id, 'own_t0i_' || d.bucket, 'OWN-T0i reachable current+prior owner vertical-default assignment'
  FROM _t0i_default d
  ON CONFLICT (entity_id) DO NOTHING; -- fill-blanks only; never reassigns

  RETURN QUERY
    SELECT 'defaulted_' || d.bucket, count(*) FROM _t0i_default d GROUP BY d.bucket
    UNION ALL
    SELECT 'already_assigned', count(*) FROM _t0i_reachable_owners p
      WHERE EXISTS (SELECT 1 FROM public.lcc_entity_owner_override o
                     WHERE o.entity_id = p.id AND COALESCE(o.set_by,'') NOT LIKE 'own_t0i_%');
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_own_t0i_extend_broker_assignment(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_own_t0i_extend_broker_assignment(boolean) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.lcc_own_t0i_extend_broker_assignment(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0i_extend_broker_assignment: service_role EXECUTE grant did not take';
  END IF;
  IF has_function_privilege('anon', 'public.lcc_own_t0i_extend_broker_assignment(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_own_t0i_extend_broker_assignment: anon must NOT be able to execute this (mutating)';
  END IF;
END $$;

COMMENT ON FUNCTION public.lcc_own_t0i_extend_broker_assignment(boolean) IS
  'OWN-T0i: fill-blanks default broker assignment (gov->Scott, dia->Kelly, else->Scott) for every
   reachable current-or-prior target-market owner, not just the live priority-queue bands. Never
   overwrites an existing lcc_entity_owner_override row from any source. Reverse: delete from
   lcc_entity_owner_override where set_by like ''own_t0i_%''.';
