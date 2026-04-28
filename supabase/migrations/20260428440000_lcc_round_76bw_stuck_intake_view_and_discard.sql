-- ============================================================================
-- Round 76bw — stuck-intake diagnosis view + discard cron
--
-- Inbox audit found 21 intakes from 2026-04-25/26 stuck in status=queued
-- with no extraction_result, no match, no downstream completion. Mix of:
--   - 2 sidebar Marketing-Brochure flyers (90 -> CoStar capture-time
--     handler should have processed inline, but didn't)
--   - 19+ email-body-*.txt body-only intakes that got staged but never
--     advanced past queued
--
-- These are too stale to re-extract usefully (the underlying email
-- threads are 2+ days old, deal flyers may have priced/gone). Mark them
-- discarded with a reason so the inbox UI's queued count stops including
-- them, and add a cron to auto-discard future stuck-queued items > 48h.
--
-- Also creates a v_stuck_intakes view so the LCC dashboard can surface
-- this category for triage.
-- ============================================================================

-- 1. Discard view — queued > 48h with no extraction progress
CREATE OR REPLACE VIEW public.v_stuck_intakes AS
SELECT
  intake_id,
  source_type,
  raw_payload->>'channel'   AS channel,
  raw_payload->>'file_name' AS file_name,
  created_at,
  EXTRACT(EPOCH FROM (now() - created_at))/3600 AS age_hours,
  raw_payload ? 'extraction_result' AS has_extraction,
  raw_payload ? 'matchResult'       AS has_match
FROM public.staged_intake_items
WHERE status = 'queued'
  AND created_at < now() - interval '24 hours'
  AND NOT (raw_payload ? 'extraction_result');

-- 2. Sweep function: discard stuck-queued > 48h
CREATE OR REPLACE FUNCTION public.lcc_discard_stuck_intakes()
RETURNS TABLE(discarded integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n int := 0;
BEGIN
  WITH d AS (
    UPDATE public.staged_intake_items
       SET status = 'discarded',
           raw_payload = raw_payload || jsonb_build_object(
             '_discard_reason', 'stranded_queued_no_extraction',
             '_discarded_at', now()
           ),
           updated_at = now()
     WHERE status = 'queued'
       AND created_at < now() - interval '48 hours'
       AND NOT (raw_payload ? 'extraction_result')
    RETURNING 1
  )
  SELECT COUNT(*) INTO n FROM d;
  RETURN QUERY SELECT n;
END $$;

-- 3. Backfill: discard the existing 21 stranded rows now (one-shot;
--    they're > 48h old).
SELECT public.lcc_discard_stuck_intakes();

-- 4. Schedule the sweep daily at 04:15 UTC (after data hygiene crons)
SELECT cron.unschedule('lcc-discard-stuck-intakes')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-discard-stuck-intakes');

SELECT cron.schedule(
  'lcc-discard-stuck-intakes',
  '15 4 * * *',
  $sql$SELECT public.lcc_discard_stuck_intakes()$sql$
);
