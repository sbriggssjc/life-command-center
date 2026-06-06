-- ============================================================================
-- R7 Phase 2 — junk-entity-name decision lane (seeded) + sweep
-- ============================================================================
-- Phase 2 folds the legacy Review Console lanes into the decision anatomy and
-- surfaces the surfaceless decision types. Most lanes are LIST-FEDERATED (they
-- read top-N straight from a large/churning source view and only mint a
-- lcc_decisions row at verdict time — see api/admin.js), so they need no DB
-- change here. This migration adds the one NEW *seeded* lane: junk entity names
-- (the 41 entities soft-flagged metadata.junk_name_flagged=true in R4-A). It is
-- bounded, stable, and every row is a real ask ("what should this entity be?"),
-- so seeding is correct (vs. list-federating a universe the source might retract
-- tomorrow — the disk-incident / stale-decision lesson).
--
-- DB-safety (LCC Opps is auth-critical): additive, idempotent, entity-scale
-- (~41 seed rows). No auth-schema contact, no long locks. We replace
-- lcc_refresh_decisions() (Slice-2) with a superset that ALSO seeds + sweeps the
-- junk-entity lane; the two existing lanes are unchanged. The function's return
-- shape gains a column, so we DROP then CREATE (CREATE OR REPLACE can't change
-- the OUT columns of a set-returning function).
-- ============================================================================

DROP FUNCTION IF EXISTS public.lcc_refresh_decisions();

CREATE FUNCTION public.lcc_refresh_decisions()
RETURNS TABLE(seeded_true_owner integer, seeded_buyer_parent integer,
              seeded_junk_entity integer, superseded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sup int := 0;
  v_to  int := 0;
  v_bp  int := 0;
  v_je  int := 0;
BEGIN
  -- ---- SWEEP: auto-close decisions whose subject no longer qualifies --------
  -- confirm_true_owner: only valid while the entity sits in P0.4 with a known
  -- but unconnected domain true_owner.
  WITH still_valid AS (
    SELECT entity_id FROM public.v_priority_queue_enriched
    WHERE priority_band = 'P0.4' AND resolve_reason = 'true_owner_known_connect'
  ), closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='confirm_true_owner' AND d.status='open'
      AND NOT EXISTS (SELECT 1 FROM still_valid s WHERE s.entity_id = d.subject_entity_id)
    RETURNING 1
  ) SELECT count(*) INTO v_sup FROM closed;

  -- confirm_buyer_parent closes once the sponsor is confirmed (or the parent is
  -- no longer in the lane); map closes once the parent is mapped.
  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    FROM public.lcc_buyer_parents bp
    WHERE d.subject_entity_id = bp.parent_entity_id AND d.status='open'
      AND (
        (d.decision_type='confirm_buyer_parent'
            AND (bp.confirmed_at IS NOT NULL OR bp.needs_sf_mapping = false))
     OR (d.decision_type='map_sf_parent_account' AND bp.needs_sf_mapping = false)
      )
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  -- junk_entity_name: closes once the entity is no longer flagged (it was
  -- renamed / merged away, clearing metadata.junk_name_flagged) or deleted.
  WITH closed AS (
    UPDATE public.lcc_decisions d SET status='superseded', updated_at=now()
    WHERE d.decision_type='junk_entity_name' AND d.status='open'
      AND NOT EXISTS (
        SELECT 1 FROM public.entities e
        WHERE e.id = d.subject_entity_id
          AND (e.metadata->>'junk_name_flagged') = 'true')
    RETURNING 1
  ) SELECT v_sup + count(*) INTO v_sup FROM closed;

  -- ---- SEED: confirm_true_owner (the P0.4 true_owner_known_connect set) ------
  WITH seeded AS (
    SELECT public.lcc_open_decision(
      'confirm_true_owner',
      e.workspace_id,
      'Is the domain true owner current, or stale (pre-acquisition)?',
      jsonb_strip_nulls(jsonb_build_object(
        'entity_name',        e.name,
        'true_owner_name',    e.resolve_true_owner_name,
        'source_property_address', e.source_property_address,
        'source_property_state',   e.source_property_state,
        'annual_rent',        e.current_annual_rent_total
      )),
      e.entity_id, e.source_domain, e.source_property_id, NULL,
      e.current_annual_rent_total
    ) AS id
    FROM public.v_priority_queue_enriched e
    WHERE e.priority_band='P0.4' AND e.resolve_reason='true_owner_known_connect'
  ) SELECT count(*) INTO v_to FROM seeded;

  -- ---- SEED: buyer-parent review (the needs_sf_mapping set) -----------------
  WITH seeded AS (
    SELECT public.lcc_open_decision(
      CASE WHEN bp.confirmed_at IS NULL AND pe.name ILIKE '%unconfirm%'
           THEN 'confirm_buyer_parent' ELSE 'map_sf_parent_account' END,
      pe.workspace_id,
      CASE WHEN bp.confirmed_at IS NULL AND pe.name ILIKE '%unconfirm%'
           THEN 'Confirm the controlling sponsor for this buyer parent.'
           ELSE 'Map this buyer parent to its Salesforce parent account.' END,
      jsonb_strip_nulls(jsonb_build_object(
        'parent_name',   pe.name,
        'domain',        bp.domain,
        'spe_count',     r.spe_count,
        'rollup_annual_rent', r.rollup_annual_rent,
        'rollup_property_count', r.rollup_property_count,
        'sf_account_id', bp.sf_account_id,
        'sf_account_name', bp.sf_account_name,
        'needs_sf_mapping', bp.needs_sf_mapping,
        'sponsor_confirmed', (bp.confirmed_at IS NOT NULL)
      )),
      bp.parent_entity_id, bp.domain, NULL, NULL,
      r.rollup_annual_rent
    ) AS id
    FROM public.lcc_buyer_parents bp
    JOIN public.entities pe ON pe.id = bp.parent_entity_id
    LEFT JOIN public.v_lcc_buyer_parent_rollup r ON r.parent_entity_id = bp.parent_entity_id
    WHERE bp.needs_sf_mapping = true
  ) SELECT count(*) INTO v_bp FROM seeded;

  -- ---- SEED: junk_entity_name (the 41 soft-flagged entities) ----------------
  -- Question: "What should this entity be?" Context = the junk name + how
  -- connected it is (identity count) so high-leverage cleanups surface first.
  -- rank_value = identity count (a junk entity that carries SF/domain identities
  -- is worth fixing before an orphan one). Verdicts ride existing machinery:
  -- rename (entities PATCH), merge (lcc_merge_entity), or leave flagged.
  WITH ident AS (
    SELECT entity_id, count(*)::numeric AS n
    FROM public.external_identities GROUP BY entity_id
  ), seeded AS (
    SELECT public.lcc_open_decision(
      'junk_entity_name',
      e.workspace_id,
      'What should this entity be? (renamed, merged into another, or left flagged)',
      jsonb_strip_nulls(jsonb_build_object(
        'entity_name', e.name,
        'entity_type', e.entity_type,
        'domain',      e.domain,
        'identity_count', COALESCE(i.n, 0)
      )),
      e.id, e.domain, NULL, NULL,
      COALESCE(i.n, 0)
    ) AS id
    FROM public.entities e
    LEFT JOIN ident i ON i.entity_id = e.id
    WHERE (e.metadata->>'junk_name_flagged') = 'true'
  ) SELECT count(*) INTO v_je FROM seeded;

  seeded_true_owner := v_to; seeded_buyer_parent := v_bp;
  seeded_junk_entity := v_je; superseded := v_sup;
  RETURN NEXT;
END;
$fn$;

-- Re-seed now so the junk-entity lane is populated on apply (idempotent).
SELECT * FROM public.lcc_refresh_decisions();
