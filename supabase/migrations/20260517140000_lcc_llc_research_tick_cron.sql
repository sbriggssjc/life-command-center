-- ============================================================================
-- Round AUDIT-02a (2026-05-17): pg_cron schedule for lcc-llc-research-tick.
--
-- Schedules a 30-min cron on LCC Opps that POSTs to the existing Vercel/
-- Railway handler /api/admin?_route=llc-research-tick (handleLlcResearchTick
-- in api/admin.js). The handler drains llc_research_queue on both gov and
-- dia domain databases up to limit=50 rows per tick.
--
-- Feature-flag behavior:
--   • OPENCORPORATES_API_KEY set     → rows process and resolve to done /
--                                       no_match / unsupported_state.
--   • OPENCORPORATES_API_KEY unset   → handler returns handler_configured:
--                                       false; rows stay 'queued' (the
--                                       drainer never advances them, but
--                                       writes nothing destructive).
-- Per Scott's preference, the SOS-direct scraper path is deferred. While
-- the key is absent, the cron is harmless and the new UI (item #2 phase B)
-- surfaces queued rows for manual SOS-link research.
--
-- Already applied to LCC Opps (xengecqvemvfknjvbvrq) at 2026-05-17 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record so any new environment provisioning (branch DBs,
-- restored snapshots, fresh local dev) inherits the schedule.
--
-- Reversal:
--   SELECT cron.unschedule('lcc-llc-research-tick');
--
-- Closes audit findings:
--   • A-1 (the queue-drainer half — UI half ships in phase B)
--   • B-5 (the cron half — UI half ships in phase B)
-- Refs:
--   audit:  LCC_Holistic_Audit_2026-05-17.docx, item #2 (Top-10 priority)
--   branch: audit/02-research-queue-drain
--   handler: api/admin.js:2623 handleLlcResearchTick
-- ============================================================================

-- Idempotent guard: if a job with this name already exists from a prior
-- apply, drop it before re-scheduling. cron.schedule has no IF NOT EXISTS,
-- and re-running would create a second row with the same name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-llc-research-tick') THEN
    PERFORM cron.unschedule('lcc-llc-research-tick');
  END IF;
END$$;

SELECT cron.schedule(
  'lcc-llc-research-tick',
  '*/30 * * * *',
  $$SELECT public.lcc_cron_post(
      '/api/admin?_route=llc-research-tick&domain=both&limit=50',
      '{}'::jsonb,
      'vercel'
    )$$
);

-- Sanity probe (no-op SELECT; result visible in psql but ignored by migrators)
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'lcc-llc-research-tick';
