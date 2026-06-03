-- E2E#5 — Canonicalize BD-engine domain/vertical naming (dia/gov).
--
-- Third occurrence of the dia/gov alias bug class (after getDomainCredentials
-- and QA#9). The BD priority queue mixed three naming conventions:
--   • short forms  'dia' / 'gov'        (lcc_entity_portfolio_facts.source_domain,
--                                         most bd_opportunities.vertical)
--   • long  forms  'dialysis' / 'government'  (entities.domain, the legacy seed
--                                         cadences flowing through
--                                         touchpoint_cadence.domain -> P7)
--   • NULL vertical (5 orphaned seed cadences with no domain anchor)
--
-- handlePriorityBand (api/admin.js) filtered source_domain on the LONG form, so
-- the per-property band lookup silently missed every row carrying the short
-- form (P5 dia/gov rows). Live audit 2026-06-03 (LCC Opps xengecqvemvfknjvbvrq):
--   touchpoint_cadence.domain : dia 1 / dialysis 130 / gov 2 / government 169 / NULL 6
--   entities.domain           : dia 625 / dialysis 5654 / gov 3376 / government 5486 / lcc 35 / NULL 994
--   bd_opportunities.vertical : dia 1 / gov 2 (already canonical)
--   portfolio.source_domain   : dia 1676 / gov 4268 (already canonical)
--   v_priority_queue_enriched.vertical : dia 190 / dialysis 130 / gov 627 / government 169 / NULL 5
--
-- Canonical form = SHORT (dia/gov), matching the frontend and the portfolio
-- facts. ('lcc' is a legitimate third entities.domain value for LCC-internal
-- entities and is intentionally left untouched; only dialysis->dia and
-- government->gov are remapped.)
--
-- Fix at the source (data + writers) AND at the view boundary (belt-and-
-- suspenders), so a future stray long form still presents canonically.
--
-- Idempotent: every UPDATE is guarded on the long-form value; every CREATE OR
-- REPLACE is a full redefinition.

BEGIN;

-- ===========================================================================
-- 1. One-time data normalization  (dialysis -> dia, government -> gov)
-- ===========================================================================

UPDATE public.bd_opportunities SET vertical = 'dia' WHERE vertical = 'dialysis';
UPDATE public.bd_opportunities SET vertical = 'gov' WHERE vertical = 'government';

UPDATE public.touchpoint_cadence SET domain = 'dia', updated_at = now() WHERE domain = 'dialysis';
UPDATE public.touchpoint_cadence SET domain = 'gov', updated_at = now() WHERE domain = 'government';

UPDATE public.entities SET domain = 'dia' WHERE domain = 'dialysis';
UPDATE public.entities SET domain = 'gov' WHERE domain = 'government';

-- Defensive: portfolio facts already short, but normalize any stray long form.
UPDATE public.lcc_entity_portfolio_facts SET source_domain = 'dia' WHERE source_domain = 'dialysis';
UPDATE public.lcc_entity_portfolio_facts SET source_domain = 'gov' WHERE source_domain = 'government';

-- ===========================================================================
-- 2. Disposition the orphaned seed cadences (the 5 NULL-vertical P7 rows)
--
-- Investigation 2026-06-03: the 5 NULL-vertical P7 rows are real-firm seed
-- cadences (CenterPoint Properties, Novogroder Companies, WOW Logistics, BH
-- Properties, Symmetry Property Dev) with NO portfolio facts, NO bd_opportunity,
-- NO contact and NULL entities.domain. They cannot be "backfilled from portfolio
-- domain" because there is none. Per the operator's decision (E2E#5): soft-
-- disposition rather than hard-delete — set each to the terminal 'dormant' phase,
-- clear next_touch_due (drops them out of every due-based band), and stamp an
-- audit note. The names are genuine firms; if any is worked later the
-- bd_opportunity_auto_seed_cadence trigger will seed a fresh, properly-domained
-- cadence at that moment, so nothing is lost. (Symmetry in particular has a
-- just-promoted "new contact" action in My Work whose loop will re-seed itself.)
--
-- There is also 1 fully-orphan cadence (entity_id IS NULL) that is unactionable
-- by construction; it is dispositioned the same way (UPDATE on a NULL entity_id
-- row is clean, so no DELETE is needed).
-- ===========================================================================

UPDATE public.touchpoint_cadence
SET phase            = 'dormant',
    next_touch_due   = NULL,
    notes            = COALESCE(notes || E'\n', '')
                       || 'orphaned seed cadence — no portfolio/opportunity/contact; cleared 2026-06-03 (E2E#5)',
    updated_at       = now()
WHERE domain IS NULL
  AND phase <> 'dormant'
  AND bd_opportunity_id IS NULL
  AND contact_id IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.lcc_entity_portfolio_facts f
        WHERE f.entity_id = touchpoint_cadence.entity_id
      );

-- ===========================================================================
-- 3. Writer normalization
-- ===========================================================================

-- 3a. lcc_open_prospect_opportunity:
--     • normalize p_vertical to the canonical short form (so the cadence the
--       auto-seed trigger spawns from NEW.vertical is canonical too)
--     • default stage = 'identified' on insert (Nit 1 — was NULL; aligns with
--       bridgeCreateLead which already inserts 'identified')
CREATE OR REPLACE FUNCTION public.lcc_open_prospect_opportunity(
  p_entity_id      uuid,
  p_owner_user_id  uuid     DEFAULT NULL,
  p_vertical       text     DEFAULT NULL,
  p_source         text     DEFAULT 'manual',
  p_notes          text     DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_opp_id uuid;
  v_workspace_id uuid;
  v_existing uuid;
  v_vertical text;
BEGIN
  -- Canonicalize the vertical (dia/gov). NULL and any other value pass through.
  v_vertical := CASE p_vertical
                  WHEN 'dialysis'   THEN 'dia'
                  WHEN 'government' THEN 'gov'
                  ELSE p_vertical
                END;

  SELECT workspace_id INTO v_workspace_id
  FROM public.entities
  WHERE id = p_entity_id
    AND merged_into_entity_id IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lcc_open_prospect_opportunity: entity % not found (or merged)', p_entity_id;
  END IF;

  -- Idempotency: if there's already an open prospect opportunity for this
  -- entity, return that one — don't create a duplicate that would seed a
  -- second cadence.
  SELECT id INTO v_existing
  FROM public.bd_opportunities
  WHERE entity_id = p_entity_id
    AND type = 'prospect'
    AND is_open = true
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- bd_opportunities doesn't carry dedicated opened_by/source/notes columns;
  -- source/notes ride in metadata jsonb. is_open is generated on (closed_at IS
  -- NULL) so we leave closed_at NULL. stage defaults to 'identified' to match
  -- the create_lead bridge path (Nit 1).
  INSERT INTO public.bd_opportunities (
    workspace_id, entity_id, owner_user_id, vertical, type, stage,
    opened_at, metadata
  ) VALUES (
    v_workspace_id, p_entity_id, p_owner_user_id, v_vertical, 'prospect', 'identified',
    now(),
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'notes', p_notes))
  )
  RETURNING id INTO v_opp_id;

  RETURN v_opp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_open_prospect_opportunity(uuid, uuid, text, text, text) FROM PUBLIC;

-- 3b. lcc_seed_onboarding_cadence: normalize p_domain to the canonical short
--     form before it lands in touchpoint_cadence.domain (belt-and-suspenders —
--     the auto-seed trigger already passes the now-canonical bd_opportunities
--     .vertical, but a direct caller could still pass a long form).
CREATE OR REPLACE FUNCTION public.lcc_seed_onboarding_cadence(
  p_entity_id         uuid,
  p_contact_id        uuid     DEFAULT NULL,
  p_owner_user_id     uuid     DEFAULT NULL,
  p_bd_opportunity_id uuid     DEFAULT NULL,
  p_domain            text     DEFAULT NULL,
  p_priority_tier     text     DEFAULT 'B'
) RETURNS uuid AS $$
DECLARE
  v_cadence_id uuid;
  v_step1 record;
  v_domain text;
BEGIN
  v_domain := CASE p_domain
                WHEN 'dialysis'   THEN 'dia'
                WHEN 'government' THEN 'gov'
                ELSE p_domain
              END;

  SELECT * INTO v_step1 FROM public.lcc_onboarding_schedule WHERE step_number = 1;

  -- Idempotency key: one cadence row per (entity, bd_opportunity) or (entity)
  -- when no opportunity yet. Try the most specific match first.
  SELECT id INTO v_cadence_id
  FROM public.touchpoint_cadence
  WHERE entity_id = p_entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_cadence_id IS NULL THEN
    INSERT INTO public.touchpoint_cadence (
      entity_id, contact_id, owner_user_id, bd_opportunity_id, domain,
      priority_tier, phase, current_touch,
      next_touch_due, next_touch_type, next_touch_template
    ) VALUES (
      p_entity_id, p_contact_id, p_owner_user_id, p_bd_opportunity_id, v_domain,
      COALESCE(p_priority_tier, 'B'), 'onboarding', 0,
      now(), v_step1.touch_type, v_step1.template_name
    )
    RETURNING id INTO v_cadence_id;
  ELSE
    UPDATE public.touchpoint_cadence
    SET phase = 'onboarding',
        current_touch = 0,
        next_touch_due = now(),
        next_touch_type = v_step1.touch_type,
        next_touch_template = v_step1.template_name,
        contact_id = COALESCE(p_contact_id, contact_id),
        owner_user_id = COALESCE(p_owner_user_id, owner_user_id),
        domain = COALESCE(v_domain, domain),
        priority_tier = COALESCE(p_priority_tier, priority_tier),
        updated_at = now()
    WHERE id = v_cadence_id;
  END IF;

  RETURN v_cadence_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_seed_onboarding_cadence(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;

-- ===========================================================================
-- 4. View-boundary normalization + orphan guard
--
-- Re-state v_priority_queue_enriched (same column list/order as the P1-P3
-- definition — CREATE OR REPLACE VIEW is append-only, so order must match) with
-- two changes:
--   • vertical / source_domain wrapped in a canonical CASE map, so any future
--     stray long form still presents as dia/gov.
--   • a WHERE guard that drops rows with NULL entity_id or an unresolvable
--     (NULL) vertical from the priority bands — orphans can't silently pollute
--     the queue again. (The raw v_priority_queue cadence bands inner-join
--     entity_effective_role, so they cannot emit a NULL entity_id; the only
--     real gap was NULL vertical, now closed here for every consumer —
--     band_counts, handlePriorityBand, and the operator console all read this
--     view.)
-- ===========================================================================
CREATE OR REPLACE VIEW public.v_priority_queue_enriched
WITH (security_invoker = true) AS
SELECT
  q.entity_id,
  q.name,
  q.workspace_id,
  CASE q.vertical
    WHEN 'dialysis'   THEN 'dia'
    WHEN 'government' THEN 'gov'
    ELSE q.vertical
  END                                      AS vertical,
  q.owner_user_id,
  q.contact_id,
  q.bd_opportunity_id,
  q.priority_band,
  q.reason,
  q.next_touch_due,
  q.days_overdue,
  q.last_touch_at,
  q.last_touch_type,
  q.effective_owner_role,
  q.owner_role_confidence,
  COALESCE(p.total_property_count, 0)      AS total_property_count,
  COALESCE(p.current_property_count, 0)    AS current_property_count,
  COALESCE(p.dia_property_count, 0)        AS dia_property_count,
  COALESCE(p.gov_property_count, 0)        AS gov_property_count,
  COALESCE(p.is_cross_vertical, false)     AS is_cross_vertical,
  p.earliest_acquisition_date,
  p.latest_acquisition_date,
  p.latest_disposition_date,
  COALESCE(p.current_annual_rent_total, 0) AS current_annual_rent_total,
  p.avg_cap_rate,
  CASE q.source_domain
    WHEN 'dialysis'   THEN 'dia'
    WHEN 'government' THEN 'gov'
    ELSE q.source_domain
  END                                      AS source_domain,
  q.source_property_id,
  pa.address              AS source_property_address,
  pa.city                 AS source_property_city,
  pa.state                AS source_property_state,
  pa.lease_expiration     AS source_property_lease_expiration,
  pa.firm_term_remaining  AS source_property_firm_term_remaining,
  pa.term_remaining       AS source_property_term_remaining
FROM public.v_priority_queue q
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = q.entity_id
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = q.source_domain
 AND pa.source_property_id = q.source_property_id
-- Orphan guard: no NULL-entity rows, no unresolvable-vertical rows.
WHERE q.entity_id IS NOT NULL
  AND CASE q.vertical
        WHEN 'dialysis'   THEN 'dia'
        WHEN 'government' THEN 'gov'
        ELSE q.vertical
      END IS NOT NULL;

GRANT SELECT ON public.v_priority_queue_enriched TO authenticated;

COMMENT ON VIEW public.v_priority_queue_enriched IS
  'v_priority_queue + per-entity portfolio rollup + property context. '
  'vertical/source_domain canonicalized to dia/gov (E2E#5, 2026-06-03); rows '
  'with NULL entity_id or unresolvable vertical are excluded so orphan seed '
  'cadences cannot pollute the priority bands.';

COMMIT;
