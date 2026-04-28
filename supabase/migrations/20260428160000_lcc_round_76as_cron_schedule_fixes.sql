-- ============================================================================
-- Round 76as — persist the cron schedule fixes uncovered post-Round 76ar
--
-- Once lcc_cron_post() finally pointed at the right URL (Round 76ar) and
-- vault.lcc_api_key got the real key, we manually re-fired each cron and
-- discovered TWO MORE bugs in the schedules themselves:
--
-- 1. nightly-cross-domain-match
--    Was: SELECT lcc_cron_post('/api/cross-domain-match')
--    Got: HTTP 400 "No workspace context. Provide X-LCC-Workspace header
--         or workspace_id in body."
--    Fix: send workspace_id in the body, like the preassemble cron does.
--
-- 2. daily-briefing-snapshot
--    Was: SELECT lcc_cron_post('/daily-briefing', '{"action":"snapshot"}',
--                               'edge')
--    Got: HTTP 404 "Requested function was not found"
--    The Supabase Edge Function 'daily-briefing' is documented in CLAUDE.md
--    but has never been deployed. The Railway server.js has /api/daily-briefing
--    that does the same job — switch to it.
--    Fix: target='vercel' (which now resolves to Railway via vault).
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Replace nightly-cross-domain-match with the workspace_id-bearing form
    BEGIN
      PERFORM cron.unschedule('nightly-cross-domain-match');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'nightly-cross-domain-match',
      '0 8 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/cross-domain-match', '{"workspace_id":"a0000000-0000-0000-0000-000000000001"}'::jsonb)$cmd$
    );

    -- Replace daily-briefing-snapshot with the Railway-targeting form
    BEGIN
      PERFORM cron.unschedule('daily-briefing-snapshot');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'daily-briefing-snapshot',
      '0 10 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/daily-briefing', '{"action":"snapshot"}'::jsonb)$cmd$
    );
  END IF;
END $$;
