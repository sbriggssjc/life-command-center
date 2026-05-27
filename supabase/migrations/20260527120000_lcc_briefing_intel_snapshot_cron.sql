-- ============================================================================
-- Schedule lcc-briefing-intel-snapshot cron on LCC Opps
--
-- The briefing-intel-snapshot edge function builds the daily market/news/AI
-- snapshot that powers the LCC Morning Briefing email's Capital Markets,
-- Analyst's Take, Sector Watch, and What We're Reading sections.
--
-- This was originally scheduled live via SQL during the Executive Briefing v2
-- rollout but never captured in a migration. The 2026-05-26 morning email
-- shipped with `intel_snapshot=null` (every macro section blank). Edge function
-- logs confirmed zero invocations of briefing-intel-snapshot in the prior 24h.
--
-- Schedule: 10:00 UTC daily (5:00 AM CDT in summer, 4:00 AM CST in winter).
-- The Power Automate flow that renders + sends the email typically fires
-- around 7:30 AM CT, leaving 2.5-3.5 hours of buffer for retries.
--
-- Mon-Fri only — the briefing is a workday email; no weekend snapshots needed.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-briefing-intel-snapshot');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-briefing-intel-snapshot',
      '0 10 * * 1-5',
      $cmd$SELECT public.lcc_cron_post('/briefing-intel-snapshot', '{}'::jsonb, 'edge')$cmd$
    );
  END IF;
END $$;
