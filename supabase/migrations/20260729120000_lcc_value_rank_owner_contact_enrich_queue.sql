-- value-rank the owner-contact-enrich worker (2026-06-29) — LCC Opps.
--
-- ORE Phase 1 Unit A wired the orphaned SOS managers into owner records and they
-- flowed end to end (signal mirror 298→946, owner_contact_pivot 172→813, 729 with
-- a named decision-maker). But the owner-contact-enrich worker selected its
-- candidate pivots FIFO (order=updated_at.asc), so as it drains the named backlog
-- it attached OLDEST-first — the handful of high-value owners (~5-7 of the 729 are
-- ≥$1M connected value) weren't prioritized, even though those are the entire
-- point. The worker's per-tick throughput is wall-clock-capped, so the ORDER of
-- the candidate pull determines which owners get attached (+ a value-gated cadence
-- seeded) within budget.
--
-- This view value-ranks the SAME candidate set using the EXISTING R34 value
-- sources — the portfolio rollup (v_entity_portfolio_all.current_annual_rent_total)
-- and the R17 connected-property value (lcc_entity_connected_value) — with the
-- SAME COALESCE chain as v_owner_contact_worklist. No new value math. The worker
-- keeps its existing WHERE filters (active_contact_entity_id IS NULL, status in
-- active/exhausted, named-or-actionable) and just selects from this view ordered
-- by rank_value DESC NULLS LAST, updated_at ASC (the FIFO tiebreak that keeps the
-- silent-churn guard progressing among equal-value rows).
--
-- SECURITY INVOKER / additive / read-only. Deploy-order-safe: drop the view → the
-- worker falls back to selecting owner_contact_pivot directly (FIFO, the prior
-- behavior). Reversible — DROP VIEW → zero trace.

BEGIN;

CREATE OR REPLACE VIEW public.v_owner_contact_enrich_queue
WITH (security_invoker = true) AS
SELECT
  p.entity_id,
  p.owner_name,
  p.workspace_id,
  p.active_contact_name,
  p.active_contact_entity_id,
  p.active_authority_level,
  p.active_contact_role,
  p.enrichment_action,
  p.status,
  p.updated_at,
  -- rank_value: portfolio rollup rent, falling back to the R17 connected-property
  -- value — the SAME sources + COALESCE chain as v_owner_contact_worklist / R34.
  COALESCE(NULLIF(pa.current_annual_rent_total, 0), cv.connected_property_value) AS rank_value
FROM public.owner_contact_pivot p
LEFT JOIN public.v_entity_portfolio_all pa ON pa.entity_id = p.entity_id
LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = p.entity_id;

GRANT SELECT ON public.v_owner_contact_enrich_queue TO authenticated;

COMMENT ON VIEW public.v_owner_contact_enrich_queue IS
  'value-rank-enrich-worker: owner_contact_pivot + rank_value (portfolio rollup '
  'rent, fallback R17 connected-property value — same sources/COALESCE chain as '
  'v_owner_contact_worklist). The owner-contact-enrich worker selects from this '
  'view ordered by rank_value DESC NULLS LAST, updated_at ASC so it attaches + '
  'seeds cadences for the highest-value contactless owners FIRST instead of FIFO. '
  'SECURITY INVOKER, read-only.';

COMMIT;
