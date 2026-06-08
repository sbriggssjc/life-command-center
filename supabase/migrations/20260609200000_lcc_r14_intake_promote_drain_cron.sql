-- ============================================================================
-- R14 — Intake promote-drain: consume the stranded 'matched' bucket (LCC Opps)
--
-- Background: the 2026-06-08 R14 intake-funnel audit found `status='matched'`
-- was a silent dead status — neither auto-promoted nor surfaced for human
-- action. The matcher sets 'matched'; the promoter flips to 'finalized' only
-- when a promotion lands. But NO cron consumed 'matched' (intake-rematch reads
-- only 'review_required'), the inbox triage UI filtered it out, and the
-- Decision Center intake_disposition lane is 'review_required'+'failed' only.
-- 1,266 items sat invisible (oldest 2026-04-25). Two root causes:
--   1. the promoter's finalize flip was gated on listingResult.ok, so dia
--      lease-only (NNN) promotions never flipped (fixed in intake-promoter.js);
--   2. stale 'domain_not_supported' skips recorded before R4-A (2026-06-04)
--      repaired the lcc->domain external_identities bridge — 646/751 of those
--      entities bridge to a real dia/gov property now.
--
-- New api/admin.js sub-route (handleIntakePromoteDrain):
--   POST /api/intake-promote-drain?limit=100
--     -> walks staged_intake_items status='matched', re-runs the proven
--        downstream pipeline (runDownstreamPipeline -> matcher -> the now-fixed
--        promoter, which is idempotent: fills-blanks / dedups / merges).
--     -> promotion succeeds  -> promoter flips status to 'finalized' (drained).
--     -> still 'matched' after PROMOTE_DRAIN_MAX_ATTEMPTS (default 2) ->
--        surfaced to 'review_required' (enters inbox + DC intake_disposition
--        lane) so 'matched' is never silent again.
--     -> under the attempt cap -> stamped + left for the next tick (retry).
--        GET = dry-run (counts only).
--     -> cooldown-stamped (PROMOTE_DRAIN_COOLDOWN_HOURS, default 24h) so the
--        cron doesn't re-grind the same un-promotable rows every tick.
--
-- Cadence: every 30 minutes, offset from lcc-intake-rematch (:00/:30) to :15/:45
-- so the two intake workers don't contend. At 100 rows/tick x 2 ticks/hr the
-- ~1.3k backlog drains in ~7 hours; afterwards the cron idles cheaply (cooldown
-- + the matched set only refills when a fresh promotion attempt skips).
--
-- ORDERING: this cron calls /api/intake-promote-drain, which 404s until
-- admin.js ships. Apply this migration AFTER the worker route deploys (same
-- rule as intake-rematch / artifact-offload). Verify post-deploy with a GET
-- dry-run before relying on the cron.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent: drop any prior schedule before reinstalling.
    BEGIN
      PERFORM cron.unschedule('lcc-intake-promote-drain');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      'lcc-intake-promote-drain',
      '15,45 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake-promote-drain?limit=100', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
