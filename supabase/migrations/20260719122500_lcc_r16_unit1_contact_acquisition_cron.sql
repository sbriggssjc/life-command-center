-- ============================================================================
-- R16 Unit 1 — schedule the contact-acquisition tick (LCC Opps)
-- 2026-06-13
--
-- Drains contactless overdue cadences whose entity carries a Salesforce ACCOUNT
-- identity: pulls the account's contacts via the existing find_contacts_by_account
-- flow, creates+links them as person entities, and stamps the primary onto the
-- cadence so it becomes outreach-ready. See api/_handlers/contact-acquisition.js.
--
-- Cadence: every 30 minutes — GENTLE, per the artifact-offload lesson. Each tick
-- is bounded by `limit` AND a wall-clock budget (~20s), and the worker no-ops
-- entirely when SF_LOOKUP_WEBHOOK_URL is unset, so this cron is harmless until
-- the SF flow is wired — apply order is irrelevant.
--
-- The endpoint 404s on Railway until api/operations.js (+ the handler) ships, so
-- verify post-deploy with a GET dry-run before relying on the cron — same
-- go-live posture as lcc-folder-feed / lcc-artifact-offload.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-contact-acquisition');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- lcc_cron_post POSTs <base>/api/contact-acquisition-tick with
    -- Authorization: Bearer <vault.lcc_api_key>. POST = drain. limit bounds the
    -- per-tick SF flow calls (the budget caps wall-clock regardless).
    PERFORM cron.schedule(
      'lcc-contact-acquisition',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/contact-acquisition-tick?limit=25', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
