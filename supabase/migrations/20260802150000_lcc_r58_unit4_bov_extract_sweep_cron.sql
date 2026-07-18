-- ============================================================================
-- R58 "Unit 4" — schedule the coverage-gated BOV-extract sweep (LCC Opps)
-- 2026-07-17
--
-- Turns fully-covered properties (v_lcc_cre_bov_ready — every lease/dd/om has a
-- text sidecar) into reviewable Unit-4 records. Gated by construction: it ONLY
-- extracts a property once its leases are fully OCR'd, so a half-covered property
-- never yields a partial record. Records land status='extracted' (review-gated in
-- the live-ingest UI) — they never silently drive a client deliverable; the
-- generator's {cre_property_id} path prefers 'reviewed'.
--
--   POST /api/intake?_route=bov-extract&mode=sweep&limit=5
--     -> v_lcc_cre_bov_ready minus properties already extracted at this version
--     -> runBovExtract per property (lease text -> abstract/rent/clause_refs;
--        dd/om -> real_estate/underwriting_hints), bounded by limit + ~25s budget.
--     -> GET = dry-run (lists ready-and-pending properties, no AI, no writes).
--
-- Cadence: GENTLE — every 2 hours, cap 5 properties/tick. Each property is a
-- handful of cheap extraction-AI calls (gpt-4o-mini fallback chain); the cap +
-- repeat-tick model works through the ready set without a burst. As the doc-text
-- backlog drains, more properties enter v_lcc_cre_bov_ready and get picked up.
--
-- APPLY ONLY AFTER the deploy carrying the bov-extract `mode=sweep` handler
-- (api/_handlers/bov-extract.js) ships — on the prior deploy the endpoint returns
-- 422 (cre_property_id required). Verify post-deploy with a GET dry-run first.
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-cre-bov-extract-sweep');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-cre-bov-extract-sweep',
      '17 */2 * * *',   -- every 2 hours at :17 (off the :00/:30 doc-text ticks)
      $cmd$SELECT public.lcc_cron_post('/api/intake?_route=bov-extract&mode=sweep&limit=5', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
