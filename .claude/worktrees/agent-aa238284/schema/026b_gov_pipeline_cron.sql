-- ============================================================================
-- 026b: pg_cron Scheduled Jobs — Gov Supabase Instance (Pipeline Triggers)
-- Life Command Center
-- ============================================================================
--
-- IMPORTANT:
--   Run this in the GOVERNMENT-LEASE Supabase instance, NOT the LCC OPS instance.
--   For OPS-instance schedules, see 026_pg_cron_schedules.sql.
--
-- PREREQUISITES:
--   1. Enable pg_cron:  Supabase Dashboard -> Database -> Extensions -> search "pg_cron" -> Enable
--   2. Enable pg_net:   Supabase Dashboard -> Database -> Extensions -> search "pg_net" -> Enable
--
-- PLACEHOLDERS (replace before running):
--   PIPELINE_TRIGGER_URL    — base URL of the pipeline trigger server
--   PIPELINE_TRIGGER_SECRET — auth secret for the trigger server
-- ============================================================================

-- Enable extensions (uncomment if not already enabled via Dashboard):
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Monthly GSA lease diff — runs 1st of each month at midnight CST (6:00 AM UTC)
-- Triggers a diff of GSA lease data to detect new/changed/expired leases.
SELECT cron.schedule(
  'monthly-gsa-diff',
  '0 6 1 * *',
  $$
  SELECT net.http_post(
    url := 'PIPELINE_TRIGGER_URL/trigger/gsa-diff',
    headers := '{"Authorization": "Bearer PIPELINE_TRIGGER_SECRET"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- Weekly lead pipeline — runs every Monday at 1:00 AM CST (7:00 AM UTC)
-- Processes new leads from GSA diff and other sources through the
-- scoring and enrichment pipeline.
SELECT cron.schedule(
  'weekly-lead-pipeline',
  '0 7 * * 1',
  $$
  SELECT net.http_post(
    url := 'PIPELINE_TRIGGER_URL/trigger/lead-pipeline',
    headers := '{"Authorization": "Bearer PIPELINE_TRIGGER_SECRET"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- To verify schedules are registered:
-- SELECT * FROM cron.job;

-- To unschedule if needed:
-- SELECT cron.unschedule('monthly-gsa-diff');
-- SELECT cron.unschedule('weekly-lead-pipeline');
