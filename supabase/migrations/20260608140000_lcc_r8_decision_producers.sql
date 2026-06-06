-- R8 Unit 3 (2026-06-08): automation -> decision-lane funnel (LCC Opps).
-- Doctrine (LCC_DECISION_CENTER_DESIGN.md Phase 3b): engines that hit ambiguity
-- emit a decision row instead of parking work in a hidden status. A decision
-- lane is the standard "human needed" output for every engine. This migration
-- wires the DB-side half of three bounded producers:
--
--   1. availability_checker_botblock — SEEDED here from the existing open
--      lcc_health_alerts rows (the Round 76ej.h RPC already opens/auto-resolves
--      the alert; we simply mirror open alerts into the Decision Center and
--      auto-supersede when the alert clears). Pure-DB; no RPC/Edge change.
--   2. match_disambiguation — the intake matcher (JS) calls lcc_open_decision
--      when it finds multiple candidate properties above threshold. The SWEEP
--      here auto-supersedes once the subject intake is no longer review_required
--      (resolved on any path). Producer is JS; predicate lives on LCC Opps.
--   3. llc_research_dead — the llc-research tick (JS) calls lcc_open_decision
--      when it dead-letters a queue row. Its source (domain llc_research_queue)
--      is NOT on LCC Opps, so there is no cheap refresh-sweep predicate; the
--      lane is verdict-driven (retry/resolve/park close it). Bounded by the
--      LLC_MAX_ATTEMPTS dead-letter cap, so it cannot flood.
--
-- All three are BOUNDED producers (ambiguous matches are rare; dead LLC rows are
-- capped; botblock is a per-domain singleton), so seeded mode + auto-supersede
-- is the right anti-bloat posture — lcc_decisions stays the bounded audit trail.
--
-- The producer pattern (documented in CLAUDE.md): when an engine can't decide,
-- call lcc_open_decision(); the refresh sweep auto-supersedes when the predicate
-- clears; verdicts ride existing machinery.
--
-- DB-safety: additive, idempotent. lcc_refresh_decisions gains a return column
-- (seeded_botblock), so it is DROP+CREATE (the cron calls it by name; no hard
-- dependents). context jsonb holds ids + scalar facts only.

BEGIN;

DROP FUNCTION IF EXISTS public.lcc_refresh_decisions();

CREATE FUNCTION public.lcc_refresh_decisions()
RETURNS TABLE(seeded_true_owner integer, seeded_buyer_parent integer,
              seeded_junk_entity integer, seeded_botblock integer, superseded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sup int := 0; v_to int := 0; v_bp int := 0; v_je int := 0; v_bb int := 0;
BEGIN
  -- ===== SWEEP: auto-close decisions whose subject no longer qualifies =======
  WITH still_valid AS (
    SELECT entity_id FROM public.v_priority_queue_enriched
    WHERE priority_band = 'P0.4' AND resolve_reason = 'true_owner_known_connect'
  ), closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='confirm_true_owner' AND d.status='open'
      AND NOT EXISTS (SELECT 1 FROM still_valid s WHERE s.entity_id = d.subject_entity_id)
    RETURNING 1
  ) SELECT count(*) INTO v_sup FROM closed;

  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    FROM public.lcc_buyer_parents bp
    WHERE d.subject_entity_id = bp.parent_entity_id AND d.status='open'
      AND ( (d.decision_type='confirm_buyer_parent'
              AND (bp.confirmed_at IS NOT NULL OR bp.needs_sf_mapping = false))
         OR (d.decision_type='map_sf_parent_account' AND bp.needs_sf_mapping = false) )
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='junk_entity_name' AND d.status='open'
      AND NOT EXISTS (SELECT 1 FROM public.entities e
        WHERE e.id = d.subject_entity_id AND (e.metadata->>'junk_name_flagged')='true')
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  -- R8: availability_checker_botblock — close once the underlying health alert
  -- is resolved (or gone). subject_ref = 'botblock:' || alert source.
  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='availability_checker_botblock' AND d.status='open'
      AND NOT EXISTS (
        SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind='availability_checker_botblock'
          AND a.resolved_at IS NULL
          AND ('botblock:' || a.source) = d.subject_ref)
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  -- R8: match_disambiguation — close once the subject intake is no longer
  -- review_required (resolved on any path). intake_id rides in the context.
  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='match_disambiguation' AND d.status='open'
      AND NOT EXISTS (
        SELECT 1 FROM public.staged_intake_items si
        WHERE si.intake_id = NULLIF(d.context->>'intake_id','')::uuid
          AND si.status = 'review_required')
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  -- ===== SEED ================================================================
  WITH seeded AS (
    SELECT public.lcc_open_decision('confirm_true_owner', e.workspace_id,
      'Is the domain true owner current, or stale (pre-acquisition)?',
      jsonb_strip_nulls(jsonb_build_object('entity_name', e.name,
        'true_owner_name', e.resolve_true_owner_name,
        'source_property_address', e.source_property_address,
        'source_property_state', e.source_property_state,
        'annual_rent', e.current_annual_rent_total)),
      e.entity_id, e.source_domain, e.source_property_id, NULL, e.current_annual_rent_total) AS id
    FROM public.v_priority_queue_enriched e
    WHERE e.priority_band='P0.4' AND e.resolve_reason='true_owner_known_connect'
  ) SELECT count(*) INTO v_to FROM seeded;

  WITH seeded AS (
    SELECT public.lcc_open_decision(
      CASE WHEN bp.confirmed_at IS NULL AND pe.name ILIKE '%unconfirm%'
           THEN 'confirm_buyer_parent' ELSE 'map_sf_parent_account' END,
      pe.workspace_id,
      CASE WHEN bp.confirmed_at IS NULL AND pe.name ILIKE '%unconfirm%'
           THEN 'Confirm the controlling sponsor for this buyer parent.'
           ELSE 'Map this buyer parent to its Salesforce parent account.' END,
      jsonb_strip_nulls(jsonb_build_object('parent_name', pe.name, 'domain', bp.domain,
        'spe_count', r.spe_count, 'rollup_annual_rent', r.rollup_annual_rent,
        'rollup_property_count', r.rollup_property_count, 'sf_account_id', bp.sf_account_id,
        'sf_account_name', bp.sf_account_name, 'needs_sf_mapping', bp.needs_sf_mapping,
        'sponsor_confirmed', (bp.confirmed_at IS NOT NULL))),
      bp.parent_entity_id, bp.domain, NULL, NULL, r.rollup_annual_rent) AS id
    FROM public.lcc_buyer_parents bp
    JOIN public.entities pe ON pe.id = bp.parent_entity_id
    LEFT JOIN public.v_lcc_buyer_parent_rollup r ON r.parent_entity_id = bp.parent_entity_id
    WHERE bp.needs_sf_mapping = true
  ) SELECT count(*) INTO v_bp FROM seeded;

  WITH ident AS (
    SELECT entity_id, count(*)::numeric AS n FROM public.external_identities GROUP BY entity_id
  ), seeded AS (
    SELECT public.lcc_open_decision('junk_entity_name', e.workspace_id,
      'What should this entity be? (renamed, merged into another, or left flagged)',
      jsonb_strip_nulls(jsonb_build_object('entity_name', e.name, 'entity_type', e.entity_type,
        'domain', e.domain, 'identity_count', COALESCE(i.n,0))),
      e.id, e.domain, NULL, NULL, COALESCE(i.n,0)) AS id
    FROM public.entities e
    LEFT JOIN ident i ON i.entity_id = e.id
    WHERE (e.metadata->>'junk_name_flagged')='true'
  ) SELECT count(*) INTO v_je FROM seeded;

  -- R8: availability_checker_botblock — one decision per OPEN bot-block alert.
  -- subject_ref = 'botblock:' || source so the sweep can pair them 1:1.
  WITH seeded AS (
    SELECT public.lcc_open_decision('availability_checker_botblock', NULL,
      'Availability-checker is being bot-blocked — verify the top listings manually or acknowledge.',
      jsonb_strip_nulls(jsonb_build_object(
        'domain', a.details->>'domain',
        'source', a.source,
        'scanned', (a.details->>'scanned'),
        'unreachable', (a.details->>'unreachable'),
        'unreachable_share', (a.details->>'unreachable_share'),
        'summary', a.summary,
        'detected_at', a.detected_at)),
      NULL, a.details->>'domain', NULL, 'botblock:' || a.source,
      COALESCE((a.details->>'unreachable')::numeric, 0)) AS id
    FROM public.lcc_health_alerts a
    WHERE a.alert_kind='availability_checker_botblock' AND a.resolved_at IS NULL
  ) SELECT count(*) INTO v_bb FROM seeded;

  seeded_true_owner := v_to; seeded_buyer_parent := v_bp;
  seeded_junk_entity := v_je; seeded_botblock := v_bb; superseded := v_sup;
  RETURN NEXT;
END; $function$;

-- Re-seed immediately so the new lane is populated on apply (0 botblock today).
SELECT * FROM public.lcc_refresh_decisions();

COMMIT;
