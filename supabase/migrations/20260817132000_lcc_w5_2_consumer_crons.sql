-- ============================================================================
-- W5.2 — schedule the three signal-consumer ticks (LCC Opps pg_cron)
-- ============================================================================
-- Mirrors the R48 / generate-research-tasks scheduling pattern: pg_cron on LCC
-- Opps calls lcc_cron_post() (reads the API key from Vault) to POST the Railway
-- /api/admin?_route=<tick> handler. GET is the dry-run; the cron POSTs = apply.
--   * state-lease-consume  — daily 04:40 (state leases move slowly; also the
--                            producer-staleness alarm heartbeat).
--   * agency-risk-consume  — every 6h :23 (auto-dismiss keeps the lane bounded
--                            as low/moderate/unlinked-elevated accrue daily).
--   * npi-consume          — daily 04:50 (missing/new NPI -> research_tasks).
-- Idempotent (unschedule-if-exists then schedule); reversible (unschedule).
-- A tick that fires before the JS deploy just 404s and retries next run.
-- ============================================================================

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-state-lease-consume')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-state-lease-consume');
    PERFORM cron.schedule('lcc-state-lease-consume', '40 4 * * *',
      $job$SELECT public.lcc_cron_post('/api/admin?_route=state-lease-consume&limit=200','{}'::jsonb,'vercel')$job$);

    PERFORM cron.unschedule('lcc-agency-risk-consume')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-agency-risk-consume');
    PERFORM cron.schedule('lcc-agency-risk-consume', '23 */6 * * *',
      $job$SELECT public.lcc_cron_post('/api/admin?_route=agency-risk-consume&limit=1000','{}'::jsonb,'vercel')$job$);

    PERFORM cron.unschedule('lcc-npi-consume')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-npi-consume');
    PERFORM cron.schedule('lcc-npi-consume', '50 4 * * *',
      $job$SELECT public.lcc_cron_post('/api/admin?_route=npi-consume&limit=200','{}'::jsonb,'vercel')$job$);
  END IF;
END;
$cron$;

-- REVERSAL: SELECT cron.unschedule('lcc-state-lease-consume');
--           SELECT cron.unschedule('lcc-agency-risk-consume');
--           SELECT cron.unschedule('lcc-npi-consume');
