-- ============================================================================
-- Phase 2 Slice 2d — crawl + extract-drain crons (LCC Opps)
-- 2026-06-11 (PROPERTIES cloud crawl engine)
--
-- Two new GENTLE crons (the artifact-offload lesson — never the every-5-min
-- cadence that exhausted the 60-connection tier):
--
--   lcc-folder-feed-crawl        (Unit 1) — drives the folder-feed worker in
--     FRONTIER mode for the enrich/PROPERTIES roots, so PROPERTIES gets its own
--     budget independent of On Market. Each tick pops a bounded set of pending
--     frontier folders, descends one BFS level, attaches docs, and stages OMs.
--     Offset from lcc-folder-feed (:00/:30) to :10/:40 so the two folder-feed
--     workers don't contend.
--
--   lcc-intake-extract-drain     (Unit 3) — processes a bounded batch of
--     async-staged 'queued' intakes (the folder-feed crawl stages OMs FAST and
--     defers extraction when FOLDER_FEED_ASYNC_EXTRACT=true). Also drains the
--     On Market deferred backlog. Bounded per tick (batch + time budget), so it
--     never floods LCC Opps. Runs at :05/:20/:35/:50 (every 15) to keep the
--     queue moving without contending with the crawl ticks.
--
-- ORDERING: both crons call /api/* routes that 404 until intake.js (folder-feed +
-- intake-extract-drain) ships on Railway. The endpoints no-op / report cleanly,
-- so apply order is irrelevant; verify post-deploy with a GET dry-run before
-- relying on them (same posture as lcc-folder-feed / lcc-artifact-offload).
-- The crawl no-ops until SHAREPOINT_LIST_URL + FOLDER_FEED_ENRICH_ROOTS are set.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('lcc-folder-feed-crawl');     EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('lcc-intake-extract-drain');  EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Unit 1 — frontier crawl of the PROPERTIES (enrich) roots. limit_folders
    -- bounds the BFS level walked per tick; source=frontier selects the durable
    -- cursor path instead of re-walking the roots.
    PERFORM cron.schedule(
      'lcc-folder-feed-crawl',
      '10,40 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/folder-feed-tick?source=frontier&limit_folders=10', '{}'::jsonb, 'vercel')$cmd$
    );

    -- Unit 3 — bounded async extraction drain.
    PERFORM cron.schedule(
      'lcc-intake-extract-drain',
      '5,20,35,50 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake-extract-drain?limit=6', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
