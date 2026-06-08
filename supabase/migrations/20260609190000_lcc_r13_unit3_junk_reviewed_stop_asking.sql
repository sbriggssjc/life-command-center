-- R13 Unit 3 (2026-06-08): junk_entity_name "stop asking" semantic (LCC Opps).
--
-- Problem: the junk_entity_name lane carries ~1,000+ soft-flagged entities.
-- The leave_flagged verdict records the lcc_decisions row as 'skipped', but the
-- entity stays metadata.junk_name_flagged=true, so lcc_refresh_decisions's seed
-- re-mints a fresh open decision for it every */15 run — the operator re-sees
-- rows they already dismissed.
--
-- Fix (the "stop asking" hook CLAUDE.md anticipated): leave_flagged now also
-- sets metadata.junk_name_reviewed=true (JS side, api/admin.js). This migration
-- teaches lcc_refresh_decisions to:
--   * SEED: exclude reviewed entities (junk_name_reviewed=true) — never re-mint.
--   * SWEEP: supersede any still-open junk decision whose entity is now reviewed
--     (robustness — e.g. a decision minted just before the review, or a race).
--
-- The entity stays junk_name_flagged (its name IS junk); junk_name_reviewed is
-- the orthogonal "operator chose to keep it, don't re-ask" judgment. Rename /
-- merge clear junk_name_flagged outright (and the existing sweep closes those).
--
-- DB-safety: additive, idempotent. The OUT-row signature is UNCHANGED, so
-- CREATE OR REPLACE is valid (no DROP needed — keeps the cron binding intact).
-- Function body is the R8 (20260608140000) body verbatim plus the two edits
-- below, both marked "R13 Unit 3".

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_refresh_decisions()
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

  -- Junk sweep: close an open junk decision once the entity is no longer
  -- junk_name_flagged (renamed/merged cleared it) OR has been reviewed
  -- (R13 Unit 3 "stop asking" — junk_name_reviewed=true).
  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='junk_entity_name' AND d.status='open'
      AND NOT EXISTS (SELECT 1 FROM public.entities e
        WHERE e.id = d.subject_entity_id
          AND (e.metadata->>'junk_name_flagged')='true'
          AND COALESCE((e.metadata->>'junk_name_reviewed')::boolean, false) = false)
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
      -- R13 Unit 3: "stop asking" — don't re-mint a decision for an entity the
      -- operator already reviewed-and-kept via the leave_flagged verdict.
      AND COALESCE((e.metadata->>'junk_name_reviewed')::boolean, false) = false
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

-- Re-run so reviewed entities (if any already exist) drop out immediately.
SELECT * FROM public.lcc_refresh_decisions();

COMMIT;
