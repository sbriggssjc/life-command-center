-- ============================================================================
-- Dialysis_DB (ref zqzrriwuavgrquhisnoa) — sf_files stage-queued cron retune
-- 2026-06-05
--
-- Context: the intake-salesforce-files edge function's `?action=stage-queued`
-- action drains dia.sf_files rows at ingestion_status='stored' /
-- extraction_status='queued' through LCC's /api/intake/stage-om pipeline. Per
-- row it downloads the full PDF from the salesforce-files bucket, base64-encodes
-- it, and POSTs to LCC (5-30s each). On 2026-06-05 a tick returned HTTP 546
-- (edge CPU/wall budget exceeded) after 90.8s because the cron sent limit=50 and
-- several large 6-9MB PDFs landed in one tick, leaving ~100 dia rows stuck.
--
-- The edge function now (v13) has a 45s wall-clock budget, a default limit of 3
-- (body override capped at 10), an oversize-file skip (>15MB), and an
-- allocation-friendly base64 encoder. This migration retunes the driving cron to
-- match: 3 rows/tick, every 15 minutes (was 50 rows/tick, hourly). At ~3
-- rows/tick within the 45s budget, 96 ticks/day comfortably drains a ~100-row
-- backlog in well under 24h, then maintains coverage as new SF files arrive.
--
-- The previous job `sf-files-extract-queued-hourly` (jobid 31) was created live
-- and never tracked in a migration; this file is the first version-controlled
-- record of the cron. Idempotent — safe to re-run.
-- ============================================================================

-- Retire the old hourly job if it still exists (cron.unschedule errors if the
-- job is absent, so guard the call).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sf-files-extract-queued-hourly') THEN
    PERFORM cron.unschedule('sf-files-extract-queued-hourly');
  END IF;
END$$;

-- (Re)schedule the 15-minute, 3-rows/tick job. cron.schedule upserts by name,
-- so re-running this migration just refreshes the schedule/command in place.
SELECT cron.schedule(
  'sf-files-stage-queued-15m',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=stage-queued',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-PA-Webhook-Secret', 'f276b9065a855ed500f39eb55eb31721073863498fcf28b7'
    ),
    body := jsonb_build_object('vertical', 'dia', 'limit', 3)
  );
  $cron$
);
