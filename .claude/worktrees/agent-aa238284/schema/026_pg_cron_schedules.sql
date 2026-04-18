-- ============================================================================
-- 026: pg_cron Scheduled Jobs — OPS Supabase Instance
-- Life Command Center
-- ============================================================================
--
-- PREREQUISITES:
--   1. Enable pg_cron:  Supabase Dashboard -> Database -> Extensions -> search "pg_cron" -> Enable
--   2. Enable pg_net:   Supabase Dashboard -> Database -> Extensions -> search "pg_net" -> Enable
--      pg_net is required for HTTP calls from within PostgreSQL.
--
-- WORKSPACE_ID:
--   Run: SELECT id FROM workspaces LIMIT 1;
--   Replace the WORKSPACE_ID placeholder below with the actual UUID.
--
-- IMPORTANT:
--   These schedules run in the OPS Supabase instance only.
--   Do NOT run this in the Gov or Dia Supabase instances.
--   For Gov pipeline schedules, see 026b_gov_pipeline_cron.sql.
--
-- PLACEHOLDERS (replace before running):
--   RAILWAY_URL         — your deployed LCC base URL (e.g. https://lcc.example.com)
--   LCC_API_KEY         — the API key set in Vercel env vars for authenticated calls
--   WORKSPACE_ID        — the primary workspace UUID from the workspaces table
-- ============================================================================

-- Enable extensions (uncomment if not already enabled via Dashboard):
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule nightly context packet pre-assembly at 2:00 AM CST (8:00 AM UTC)
-- This calls the LCC /api/preassemble endpoint via HTTP to warm the context
-- packet cache for all high-priority entities and the daily briefing.
SELECT cron.schedule(
  'nightly-context-preassembly',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'RAILWAY_URL/api/preassemble',
    headers := '{"Authorization": "Bearer LCC_API_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{"workspace_id": "WORKSPACE_ID"}'::jsonb
  )
  $$
);

-- Schedule cross-domain contact matcher at 3:00 AM CST (9:00 AM UTC)
-- Runs after pre-assembly to ensure freshly matched entities get cached
-- in the next nightly cycle.
SELECT cron.schedule(
  'nightly-cross-domain-match',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'RAILWAY_URL/api/cross-domain-match',
    headers := '{"Authorization": "Bearer LCC_API_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- To verify schedules are registered:
-- SELECT * FROM cron.job;

-- To unschedule if needed:
-- SELECT cron.unschedule('nightly-context-preassembly');
-- SELECT cron.unschedule('nightly-cross-domain-match');
