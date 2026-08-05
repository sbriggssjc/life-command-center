-- ============================================================================
-- W5.2 — agency_risk_signals consumption seam (gov project scknotsqkcheojiaewwh)
-- ============================================================================
-- Signal → task automation. `agency_risk_signals` (15,299 rows, ~3,508/30d,
-- all signal_type='composite') had NO consumed-seam column, so the stream was
-- an orphaned producer (audit §3.4.1). This adds the seam the LCC consumer tick
-- (api/admin.js handleAgencyRiskConsume + the agency_risk_action Decision-Center
-- lane) marks: `processed_at` (consumed) + `processed_reason` (WHY it left the
-- queue — a human verdict, or an auto-dismiss reason). Mirrors the shape already
-- on state_lease_events (processed_at). Additive + reversible (DROP COLUMN);
-- gov-domain table only, no RLS/auth touched.
--
-- Value gate lives in the CONSUMER, not here: risk_level='high' → always a
-- Decision-Center card; risk_level='elevated' → a card only when the agency
-- links to ≥1 tracked gov property (by agency name); low/moderate + unlinked
-- elevated are auto-dismissed (processed_at stamped with a reason). The partial
-- index keeps the "unconsumed" scan cheap as the table accretes.
-- ============================================================================

BEGIN;

ALTER TABLE public.agency_risk_signals
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_reason text;

COMMENT ON COLUMN public.agency_risk_signals.processed_at IS
  'W5.2: consumed marker. NULL = unconsumed (eligible for the LCC agency_risk '
  'consumer). Set by a Decision-Center verdict (pursue_disposition/monitor/'
  'dismiss) or the auto-dismiss safety valve. Clear to re-surface.';
COMMENT ON COLUMN public.agency_risk_signals.processed_reason IS
  'W5.2: WHY the signal was consumed — a human verdict or an auto-dismiss reason '
  '(low_moderate_below_floor / elevated_no_tracked_exposure). NULL while unconsumed.';

-- Cheap "unconsumed" scan for the consumer tick + lane fetch.
CREATE INDEX IF NOT EXISTS idx_agency_risk_signals_unprocessed
  ON public.agency_risk_signals (created_at DESC)
  WHERE processed_at IS NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--   DROP INDEX IF EXISTS public.idx_agency_risk_signals_unprocessed;
--   ALTER TABLE public.agency_risk_signals
--     DROP COLUMN IF EXISTS processed_reason,
--     DROP COLUMN IF EXISTS processed_at;
-- To un-consume everything (re-surface the whole stream to the consumer):
--   UPDATE public.agency_risk_signals SET processed_at = NULL, processed_reason = NULL;
-- ---------------------------------------------------------------------------
