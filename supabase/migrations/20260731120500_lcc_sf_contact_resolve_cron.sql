-- ============================================================================
-- SF-CONTACT-RECONCILE Unit 2 — schedule the WhoId resolve tick (LCC Opps)
-- 2026-07-15
--
-- Drains public.sf_contact_resolve_queue: for each queued WhoId, calls the
-- "SF Get Contact By Id" flow (SF_CONTACT_BYID_URL), mints (or attaches-by-email
-- via ensureEntityLink's R39 tier) the person + a salesforce/Contact identity,
-- runs the SF account/email mismatch detector, and marks the row
-- resolved/no_data/dead. See api/_handlers/sf-contact-resolve.js.
--
-- Cadence: every 30 minutes — GENTLE (small volume: a few new WhoIds per sync).
-- Each tick is bounded by `limit` AND a wall-clock budget (~20s), and the worker
-- no-ops entirely when SF_CONTACT_BYID_URL is unset (queue rows stay 'seen'), so
-- this cron is harmless until the by-id flow is wired — apply order is
-- irrelevant.
--
-- The endpoint 404s on Railway until api/operations.js (+ the handler) ships, so
-- verify post-deploy with a GET dry-run before relying on the cron — same
-- go-live posture as lcc-contact-acquisition / lcc-folder-feed.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-sf-contact-resolve');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- lcc_cron_post POSTs <base>/api/sf-contact-resolve-tick with
    -- Authorization: Bearer <vault.lcc_api_key>. POST = drain. limit bounds the
    -- per-tick by-id flow calls (the budget caps wall-clock regardless).
    PERFORM cron.schedule(
      'lcc-sf-contact-resolve',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/sf-contact-resolve-tick?limit=25', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
