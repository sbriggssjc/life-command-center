-- CONTACT-SELECTION Slice 3 (2026-06-20) — gentle drain cron for the
-- owner-contact enrichment worker. Drains the FREE classes (attach a named
-- decision-maker / manager drill-through) immediately; the external-enrichment
-- classes (sos / address / deed) no-op until their adapter URL is configured.
--
-- Daily at 05:25 (after the pivot refresh at 05:20), limit 25/tick. No-ops until
-- operations.js ships (the endpoint 404s until then — same posture as the R16
-- contact-acquisition cron). Verify post-deploy with a GET dry-run before relying
-- on the cron. Idempotent (re)registration.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-owner-contact-enrich')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-contact-enrich');
    PERFORM cron.schedule(
      'lcc-owner-contact-enrich',
      '25 5 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/owner-contact-enrich-tick?limit=25', '{}'::jsonb, 'vercel')$cmd$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule the owner-contact-enrich tick manually.';
  END IF;
END $cron$;
