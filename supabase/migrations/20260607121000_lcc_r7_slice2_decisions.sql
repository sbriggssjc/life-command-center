-- ============================================================================
-- R7 Phase 1 (Slice 2) — the decision record + seed/sweep + verdict recorder
-- ============================================================================
-- The Decision Center's first-class record. One table, organized by the
-- QUESTION being asked (decision_type), with a soft-disposition lifecycle
-- (open -> decided | skipped | superseded; never hard-deleted) that doubles as
-- the audit trail for "why is this entity in this bucket."
--
-- Doctrine (LCC_DECISION_CENTER_DESIGN.md): the Decision Center is a router +
-- recorder, not a new pipeline. Verdicts ride existing machinery; this table
-- records WHAT was decided and the effects trail. Automation funnels INTO the
-- same lanes — engines that can't auto-decide call lcc_open_decision() instead
-- of parking work in a hidden status.
--
-- DB-safety (LCC Opps is auth-critical): additive, idempotent, entity-scale
-- (~160 seed rows). context jsonb holds IDS + SCALAR FACTS ONLY — never inline
-- documents/extractions (the artifact-offload lesson) — so it cannot bloat.
-- The status CHECK is safe inline: this is a brand-new table with no existing
-- rows and the only writer is lcc_open_decision()/lcc_record_decision_verdict()
-- shipped in the same migration. No auth-schema contact, no long locks.
-- Idempotent: re-apply re-creates objects (IF NOT EXISTS / OR REPLACE) and
-- re-runs the idempotent seed.
-- ============================================================================

-- 1. The decision record.
CREATE TABLE IF NOT EXISTS public.lcc_decisions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id        uuid,
  decision_type       text        NOT NULL,
  status              text        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','decided','skipped','superseded')),
  subject_entity_id   uuid,
  subject_domain      text,
  subject_property_id text,
  subject_ref         text,
  question            text,
  context             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  rank_value          numeric,           -- $ value for top-N-by-value ordering
  verdict             text,
  verdict_payload     jsonb,
  effects             jsonb,             -- trail of what was written where
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One OPEN decision per (type, subject). The subject key collapses the three
-- subject identities (entity / external ref / domain+property) to one slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_decisions_open_subject
  ON public.lcc_decisions (
    decision_type,
    COALESCE(subject_entity_id::text, subject_ref,
             (COALESCE(subject_domain,'') || ':' || COALESCE(subject_property_id,'')))
  )
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_lcc_decisions_type_status
  ON public.lcc_decisions (decision_type, status);
CREATE INDEX IF NOT EXISTS idx_lcc_decisions_subject_entity
  ON public.lcc_decisions (subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_lcc_decisions_subject_property
  ON public.lcc_decisions (subject_domain, subject_property_id);

-- 2. lcc_open_decision() — the one funnel engines/seeders call to raise a
--    decision. Idempotent on the open-subject key: refreshes the question /
--    context / rank of an already-open decision instead of duplicating it.
CREATE OR REPLACE FUNCTION public.lcc_open_decision(
  p_decision_type       text,
  p_workspace_id        uuid    DEFAULT NULL,
  p_question            text    DEFAULT NULL,
  p_context             jsonb   DEFAULT '{}'::jsonb,
  p_subject_entity_id   uuid    DEFAULT NULL,
  p_subject_domain      text    DEFAULT NULL,
  p_subject_property_id text    DEFAULT NULL,
  p_subject_ref         text    DEFAULT NULL,
  p_rank_value          numeric DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.lcc_decisions
    (decision_type, workspace_id, question, context, rank_value,
     subject_entity_id, subject_domain, subject_property_id, subject_ref, status)
  VALUES
    (p_decision_type, p_workspace_id, p_question, COALESCE(p_context,'{}'::jsonb),
     p_rank_value, p_subject_entity_id, p_subject_domain, p_subject_property_id,
     p_subject_ref, 'open')
  ON CONFLICT (
    decision_type,
    COALESCE(subject_entity_id::text, subject_ref,
             (COALESCE(subject_domain,'') || ':' || COALESCE(subject_property_id,'')))
  ) WHERE status = 'open'
  DO UPDATE SET
    question     = EXCLUDED.question,
    context      = EXCLUDED.context,
    rank_value   = EXCLUDED.rank_value,
    workspace_id = COALESCE(EXCLUDED.workspace_id, public.lcc_decisions.workspace_id),
    updated_at   = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- 3. lcc_record_decision_verdict() — stamps the verdict + effects trail and
--    moves the row off 'open'. The EFFECT (ensureEntityLink, buyer-parent
--    upsert, SF link, …) is performed by the caller; this only records it.
CREATE OR REPLACE FUNCTION public.lcc_record_decision_verdict(
  p_decision_id     bigint,
  p_verdict         text,
  p_status          text    DEFAULT 'decided',
  p_verdict_payload jsonb   DEFAULT NULL,
  p_effects         jsonb   DEFAULT NULL,
  p_decided_by      uuid    DEFAULT NULL
) RETURNS public.lcc_decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row public.lcc_decisions;
BEGIN
  UPDATE public.lcc_decisions SET
    verdict         = p_verdict,
    status          = COALESCE(p_status, 'decided'),
    verdict_payload = p_verdict_payload,
    effects         = p_effects,
    decided_by      = p_decided_by,
    decided_at      = now(),
    updated_at      = now()
  WHERE id = p_decision_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

-- 4. Seed + sweep. lcc_refresh_decisions() sweeps stale open rows to
--    'superseded' (subject no longer meets the question predicate — the
--    auto-close doctrine) then (re)seeds the two Slice-2 lanes. All idempotent
--    via lcc_open_decision()'s ON CONFLICT.
CREATE OR REPLACE FUNCTION public.lcc_refresh_decisions()
RETURNS TABLE(seeded_true_owner integer, seeded_buyer_parent integer, superseded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sup int := 0;
  v_to  int := 0;
  v_bp  int := 0;
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

  -- ---- SEED: confirm_true_owner (the 142 P0.4 true_owner_known_connect) ------
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
  -- Lane = parents needing an SF parent-account mapping (18 today). One card
  -- per parent. A genuinely unconfirmed sponsor (USGBF — flagged in its name)
  -- asks the sponsor-confirmation question; every other unmapped parent asks
  -- the mapping question. Already-mapped parents are NOT seeded (they're done);
  -- the sponsor-confirm verdict is also available inline on a map card.
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

  seeded_true_owner := v_to; seeded_buyer_parent := v_bp; superseded := v_sup;
  RETURN NEXT;
END;
$fn$;

-- 4b. Lane-chip counts (PostgREST can't GROUP BY; the Decision Center reads
--     this slim view for the per-lane open counts).
CREATE OR REPLACE VIEW public.v_lcc_decision_open_counts AS
  SELECT decision_type, count(*)::bigint AS n
  FROM public.lcc_decisions
  WHERE status = 'open'
  GROUP BY decision_type;

-- 5. Seed now so the lanes are populated on apply.
SELECT * FROM public.lcc_refresh_decisions();

-- 6. Keep the lanes fresh + auto-closing. Pure-DB (no route calls), so the
--    cron is safe to register immediately. Distinct dollar-quote tags.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-decision-refresh') THEN
    PERFORM cron.unschedule('lcc-decision-refresh');
  END IF;
  PERFORM cron.schedule('lcc-decision-refresh', '*/15 * * * *',
    $job$SELECT public.lcc_refresh_decisions();$job$);
END
$cron$;
