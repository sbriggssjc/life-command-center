-- ============================================================================
-- BROKER1 (2026-11-01) — assign every prospect to a Team Briggs broker.
-- ----------------------------------------------------------------------------
-- Scott's rule, verbatim: existing ROE dictates first (if a Team Briggs broker
-- is already pursuing, use that broker); else default by vertical (gov→Scott,
-- dia→Kelly); Nate gets nothing assigned in this pass; Scott is the catch-all
-- for anything that doesn't cleanly resolve.
--
-- REUSED, NOT REBUILT: the durable "who owns this prospect" slot already
-- exists — `lcc_entity_owner_override(entity_id, owner_user_id)` — the P112 /
-- SF-owner-capture point-person mechanism (`v_lcc_entity_point_person`,
-- `lcc_cadence_point_person`, `lcc_set_entity_owner_from_sf`). Rows already
-- written there by SF Owner capture (`set_by like 'sf_owner%'`) ARE the
-- materialized form of rule 1 (a Team-Briggs SF Account Owner IS an
-- established "self" ROE signal) — a second table here would be the exact
-- normaliser-drift / second-registry class this repo warns about repeatedly
-- (P116, P189, the C1 "lane predicate vs writer column" split). This
-- migration only adds the DEFAULT layer (rules 2/4) and NEVER overwrites an
-- existing row, from any source, manual or SF-derived — "only fill blanks".
--
-- LIVE ROE self-signal (dia salesforce_activities.assigned_to / accountOwnerName
-- classified via roe.js::brokerClass, for prospects not already covered by an
-- SF-owner-capture row) is resolved in JS BEFORE this sweep runs —
-- api/_shared/broker1-assign.js reuses roe.js's brokerClass() directly rather
-- than re-implementing it in SQL (roe.js has no SQL equivalent to port: its
-- inputs are cross-database — dia salesforce_activities lives on a different
-- Supabase project than lcc_entity_owner_override). That JS pass writes into
-- this SAME table with set_by='broker1_roe_self' before the SQL default runs,
-- so this function's own "already assigned" exclusion picks those rows up for
-- free — no double-write, no second exclusion list to keep in sync.
--
-- "Prospect" population: entities in `lcc_priority_queue_resolved`, the
-- materialized seller-prospecting queue cache (CLAUDE.md: "The priority queue
-- is seller prospecting"). This is the one population Scott and the team
-- already call "prospects" in the app today — not every entities row, not a
-- pipeline_stage (no such column exists on bd_opportunities/entities), not
-- every bd_opportunities row (open opportunities skew toward active deals,
-- not the earlier prospecting population the priority queue targets).
--
-- Discipline: fill-blanks-only (ON CONFLICT DO NOTHING — never reassigns an
-- existing row) · reversible (batch tag in `note`; delete
-- `WHERE set_by LIKE 'broker1_%'` to undo) · idempotent · dry-run-default ·
-- honest counts (named buckets, never a blended total).
--
-- Verify:  select bucket, n from lcc_broker1_assign_prospect_brokers(true);
-- Apply:   select bucket, n from lcc_broker1_assign_prospect_brokers(false);
-- Reverse: delete from lcc_entity_owner_override where set_by like 'broker1_%';
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

  SELECT count(*) FILTER (WHERE bucket = 'gov_default') INTO v_gov FROM _b1_default;
  SELECT count(*) FILTER (WHERE bucket = 'dia_default') INTO v_dia FROM _b1_default;
  SELECT count(*) FILTER (WHERE bucket = 'catchall_default') INTO v_catchall FROM _b1_default;

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
  SELECT entity_id, owner_user_id, 'broker1_' || bucket, 'BROKER1 vertical-default assignment'
  FROM _b1_default
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

COMMENT ON FUNCTION public.lcc_broker1_assign_prospect_brokers(boolean) IS
  'BROKER1: fill-blanks default broker assignment (gov->Scott, dia->Kelly, else->Scott) for every
   prospect in lcc_priority_queue_resolved that has no existing lcc_entity_owner_override row.
   Never overwrites an existing row (manual, sf_owner-captured, or a prior broker1_roe_self write).
   Nate is never a candidate owner in this function. Reverse: delete from
   lcc_entity_owner_override where set_by like ''broker1_%''.';

-- One-shot readout of the prospect population's current assignment state,
-- for the verification step in the response record (not a standing surface).
CREATE OR REPLACE VIEW public.v_lcc_broker1_prospect_assignment_state AS
SELECT
  q.entity_id,
  e.canonical_name,
  e.domain,
  o.owner_user_id,
  lu.display_name AS assigned_to,
  o.set_by,
  (o.entity_id IS NULL) AS unassigned
FROM (SELECT DISTINCT entity_id FROM public.lcc_priority_queue_resolved WHERE entity_id IS NOT NULL) q
JOIN public.entities e ON e.id = q.entity_id
LEFT JOIN public.lcc_entity_owner_override o ON o.entity_id = q.entity_id
LEFT JOIN public.lcc_users lu ON lu.lcc_user_id = o.owner_user_id;

GRANT SELECT ON public.v_lcc_broker1_prospect_assignment_state TO service_role;

COMMENT ON VIEW public.v_lcc_broker1_prospect_assignment_state IS
  'BROKER1 verification surface: every seller-prospecting-queue entity, its current broker
   assignment (if any) and how it was set. Read after lcc_broker1_assign_prospect_brokers to
   confirm the real resolved-count split before writing it up.';
