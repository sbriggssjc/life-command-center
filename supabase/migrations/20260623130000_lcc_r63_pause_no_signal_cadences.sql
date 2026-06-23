-- ============================================================================
-- R63 — make cadence track REAL relationships, not captured noise (2026-06-23)
-- Unit 2 — pause the pure-capture noise (reversible sweep)
-- ----------------------------------------------------------------------------
-- The cadence engine (R10/R16/R20/R24 + OUTREACH#1) is correct, but it was
-- pointed at the wrong population: ~185 of 318 active cadences were auto-seeded
-- from CoStar contact captures and carry NO BD signal (no Salesforce identity,
-- connected/portfolio value 0, no open opportunity, no SF activity), were never
-- touched, and just bloat the Cadence Dashboard as perpetually-overdue rows
-- Scott will never work.
--
-- This sweep PAUSES that no-signal, never-touched, active set — phase='paused',
-- metadata.pause_reason='no_bd_signal', prior phase stashed for a clean revert.
-- It is REVERSIBLE (never a delete) and IDEMPOTENT (the active-phase predicate
-- excludes already-paused rows). The signal predicate mirrors the JS producer
-- gate + grow path (api/_shared/cadence-engine.js bdSignalFromFacts) so the
-- gate, the grow path, and this sweep all agree on what "real" means.
--
-- Unit 1 (the JS producer gate — stop seeding noise) and Unit 3 (grow a cadence
-- from real SF/Outlook outreach) ship on the Railway redeploy. This sweep is
-- the DB half, applied live after a dry-run.
--
-- Same value-floor knob shape as R60 (default $500k/yr). buy_side cadences are a
-- P-BUYER relationship and are real by construction — never swept.
--
-- LCC-Opps only; no dia/gov writes; auth schema untouched.
--
-- REVERSE (un-pause everything this sweep paused):
--   UPDATE public.touchpoint_cadence
--      SET phase = COALESCE(metadata->>'paused_phase','prospecting'),
--          metadata = (metadata - 'pause_reason' - 'paused_phase'
--                              - 'paused_at' - 'paused_by'),
--          updated_at = now()
--    WHERE phase = 'paused' AND metadata->>'pause_reason' = 'no_bd_signal';
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_r63_pause_no_signal_cadences(
  p_dry_run boolean DEFAULT true,
  p_floor   numeric DEFAULT 500000
) RETURNS TABLE(action text, n bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  -- The no-signal, never-touched, ACTIVE cadence set (capture noise). A cadence
  -- is REAL (kept) when ANY of: a Salesforce CRM identity, connected value or
  -- portfolio rollup >= floor, an open BD opportunity, real SF activity, or a
  -- buy-side cadence (a P-BUYER relationship).
  SELECT array_agg(c.id) INTO v_ids
  FROM public.touchpoint_cadence c
  WHERE c.phase NOT IN ('paused', 'unsubscribed')
    AND c.phase <> 'buy_side'
    AND c.last_touch_at IS NULL
    AND c.entity_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.external_identities ei
      WHERE ei.entity_id = c.entity_id AND ei.source_system = 'salesforce')
    AND NOT EXISTS (
      SELECT 1 FROM public.bd_opportunities o
      WHERE o.entity_id = c.entity_id AND o.is_open)
    AND NOT EXISTS (
      SELECT 1 FROM public.activity_events ae
      WHERE ae.entity_id = c.entity_id AND ae.source_type = 'salesforce')
    AND COALESCE((
      SELECT cv.connected_property_value FROM public.lcc_entity_connected_value cv
      WHERE cv.entity_id = c.entity_id), 0) < p_floor
    AND COALESCE((
      SELECT vp.current_annual_rent_total FROM public.v_entity_portfolio_all vp
      WHERE vp.entity_id = c.entity_id), 0) < p_floor;

  IF v_ids IS NULL THEN
    v_ids := ARRAY[]::uuid[];
  END IF;

  IF p_dry_run THEN
    RETURN QUERY SELECT 'would_pause'::text, cardinality(v_ids)::bigint;
    RETURN;
  END IF;

  UPDATE public.touchpoint_cadence c
     SET phase = 'paused',
         metadata = COALESCE(c.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'pause_reason', 'no_bd_signal',
                         'paused_phase', c.phase,
                         'paused_at',    now(),
                         'paused_by',    'r63'),
         updated_at = now()
   WHERE c.id = ANY(v_ids);

  RETURN QUERY SELECT 'paused'::text, cardinality(v_ids)::bigint;
END;
$$;

COMMENT ON FUNCTION public.lcc_r63_pause_no_signal_cadences(boolean, numeric) IS
  'R63 Unit 2 — reversible pause of no-signal, never-touched, active capture-noise cadences. Dry-run default true; reverse via metadata.pause_reason=no_bd_signal.';
