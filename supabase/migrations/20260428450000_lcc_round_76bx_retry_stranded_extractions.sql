-- ============================================================================
-- Round 76bx — retry cron for stranded queued intakes (root-cause fix for
--              the strand bug Round 76bw papered over with the discard sweep)
--
-- The strand pattern (traced in Round 76bx):
--   1. stageOmIntake inserts staged_intake_items.status='queued', then
--      calls processIntakeExtraction() in a Promise.race against
--      EXTRACT_RACE_MS=7000ms (api/_shared/intake-om-pipeline.js:30).
--   2. When extraction takes > 7s (common for big OMs — pdf-parse + AI
--      call legitimately runs 20-60s), the race times out and the HTTP
--      handler returns to the caller.
--   3. Vercel kills the in-flight extraction Promise the moment the
--      response is sent. There is no waitUntil() pattern in use.
--   4. The extractor's eventual status PATCH to 'review_required' or
--      'failed' never fires. Row stays at status='queued' forever.
--
-- Round 76bw added a 48h discard sweep as a safety net but didn't address
-- the root cause. This round adds a true retry path:
--
--   - lcc_retry_stranded_extractions(limit_n) picks up to N items where
--     status='queued' AND age > 5 min AND no extraction_result AND
--     retry_count < 3, then POSTs /api/intake?_route=extract with the
--     intake_id. Each retry runs in its own Vercel function with a fresh
--     timeout budget, so even big OMs get repeated chances.
--
--   - Tracks retry attempts in raw_payload._retry_meta { count, last_at }
--     to prevent infinite retry loops. After 3 unsuccessful retries an
--     intake will be left for the 48h discard sweep.
--
--   - Scheduled every 5 minutes. Limit_n=10 per tick = 120 retries/hr
--     max throughput, plenty for normal flow.
--
-- This complements (does not replace) Round 76bw's discard sweep. Items
-- that retry successfully advance to review_required; ones that hit
-- max-retries fall through to discard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_retry_stranded_extractions(limit_n int DEFAULT 10)
RETURNS TABLE(retried int, skipped int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r record;
  n_retried int := 0;
  n_skipped int := 0;
  v_count int;
BEGIN
  FOR r IN
    SELECT intake_id,
           COALESCE((raw_payload->'_retry_meta'->>'count')::int, 0) AS retry_count
      FROM public.staged_intake_items
     WHERE status = 'queued'
       AND created_at < now() - interval '5 minutes'
       AND NOT (raw_payload ? 'extraction_result')
       AND COALESCE((raw_payload->'_retry_meta'->>'count')::int, 0) < 3
       -- Don't retry too aggressively — 10 minute backoff between attempts
       AND (
         raw_payload->'_retry_meta'->>'last_at' IS NULL
         OR (raw_payload->'_retry_meta'->>'last_at')::timestamptz < now() - interval '10 minutes'
       )
     ORDER BY created_at ASC
     LIMIT limit_n
  LOOP
    -- Bump retry meta first so concurrent ticks don't double-fire
    UPDATE public.staged_intake_items
       SET raw_payload = raw_payload || jsonb_build_object(
             '_retry_meta', jsonb_build_object(
               'count',   r.retry_count + 1,
               'last_at', now()
             )
           ),
           updated_at = now()
     WHERE intake_id = r.intake_id;

    -- Fire the extract endpoint async via pg_net
    BEGIN
      PERFORM public.lcc_cron_post(
        '/api/intake?_route=extract',
        jsonb_build_object('intake_id', r.intake_id),
        'vercel'
      );
      n_retried := n_retried + 1;
    EXCEPTION WHEN OTHERS THEN
      n_skipped := n_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT n_retried, n_skipped;
END $$;

-- Schedule every 5 minutes (offset by 2 to avoid colliding with the
-- 5-min refresh-work-counts cron)
SELECT cron.unschedule('lcc-retry-stranded-extractions')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-retry-stranded-extractions');

SELECT cron.schedule(
  'lcc-retry-stranded-extractions',
  '2-59/5 * * * *',
  $sql$SELECT public.lcc_retry_stranded_extractions(10)$sql$
);
