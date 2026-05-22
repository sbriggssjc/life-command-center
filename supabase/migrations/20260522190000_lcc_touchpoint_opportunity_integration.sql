-- ============================================================================
-- 20260522190000_lcc_touchpoint_opportunity_integration.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 7 (revised scope)
--
-- LCC already has the touchpoint infrastructure (activity_events as event
-- log, touchpoint_cadence as per-entity rollup). The audit's Topic 7 was
-- originally scoped to create a new touchpoint_events table — superseded
-- by recognizing the existing infrastructure. This migration adds the
-- two columns the audit specifically calls out as missing:
--   1. bd_opportunity_id — links a touchpoint to a Salesforce Opportunity
--      (foreign key to bd_opportunities, created in 20260522190100)
--   2. stream — 'bd' (counts toward BD scoreboard) vs 'showing' (Buyer
--      cohort outreach; secondary metric)
--
-- These two fields enable the priority queue (Topic 5) to distinguish
-- BD-tracked touchpoints (against open Prospect Opportunities) from
-- Showing Stream events (Buyer listings).
-- ============================================================================

-- activity_events: add opportunity link + stream tag
ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS bd_opportunity_id UUID,
  ADD COLUMN IF NOT EXISTS stream TEXT
    CHECK (stream IS NULL OR stream IN ('bd', 'showing'));

CREATE INDEX IF NOT EXISTS idx_activity_events_opportunity
  ON public.activity_events (bd_opportunity_id)
  WHERE bd_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_events_stream_occurred
  ON public.activity_events (stream, occurred_at DESC)
  WHERE stream IS NOT NULL;

COMMENT ON COLUMN public.activity_events.bd_opportunity_id IS
  'DEVELOPER_BD_AUDIT_v3 §3.4 Topic 7. Links touchpoint events to a '
  'Salesforce Opportunity (bd_opportunities). NULL for non-BD events '
  '(general activity, showing-stream events, etc.).';

COMMENT ON COLUMN public.activity_events.stream IS
  'DEVELOPER_BD_AUDIT_v3 §3.4. ''bd'' = touchpoint counts toward BD '
  'scoreboard (Prospect Opportunity). ''showing'' = Buyer outreach on a '
  'new listing (secondary metric, not scoreboard). NULL = neither stream '
  '(general activity).';

-- touchpoint_cadence: add bd_opportunity_id for cadence-per-opportunity tracking
ALTER TABLE public.touchpoint_cadence
  ADD COLUMN IF NOT EXISTS bd_opportunity_id UUID;

CREATE INDEX IF NOT EXISTS idx_touchpoint_cadence_opportunity
  ON public.touchpoint_cadence (bd_opportunity_id)
  WHERE bd_opportunity_id IS NOT NULL;

COMMENT ON COLUMN public.touchpoint_cadence.bd_opportunity_id IS
  'DEVELOPER_BD_AUDIT_v3 §2.6 Topic 7. Links a cadence row to its '
  'Salesforce Opportunity. Per audit doctrine, the BD unit of tracking '
  'is (entity × open Opportunity), not just (entity). Cadence rows '
  'without an opportunity_id are not counted in the BD scoreboard.';
