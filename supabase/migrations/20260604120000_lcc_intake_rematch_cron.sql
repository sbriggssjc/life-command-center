-- ============================================================================
-- Intake rematch — schedule the retro re-match tick (LCC Opps)
--
-- Background: a 2026-06-04 forensic on the review_required intake "purgatory
-- pile" (~2,705 rows) found the bulk of OM intakes with an extracted address
-- were unmatched PURELY on street normalization (N vs North, Ave vs Avenue) —
-- the property already existed in the domain DB. The matcher now canonicalizes
-- both sides of the address comparison, splits multi-property OMs, and falls
-- back cross-domain, so the backlog is recoverable.
--
-- New api/admin.js sub-route (handleIntakeRematch):
--   POST /api/intake-rematch?limit=100
--     -> walks staged_intake_items status='review_required' with an extracted
--        address, re-runs the improved match, and on a hit re-runs the existing
--        promotion path (runDownstreamPipeline) — advancing status exactly as a
--        fresh intake would. GET = dry-run (counts only).
--     -> idempotent: matched rows leave the review set; still-unmatched rows are
--        cooldown-stamped (REMATCH_COOLDOWN_HOURS, default 168h) so the cron
--        doesn't re-grind the same misses every tick.
--
-- Cadence: every 30 minutes. At 100 rows/tick × 2 ticks/hr the ~2.7k backlog
-- drains in ~14 hours; afterwards the cron idles cheaply (cooldown + empty
-- working set), only re-matching freshly-unmatched intakes as they arrive.
--
-- ORDERING: this cron calls /api/intake-rematch, which 404s until admin.js
-- ships. Apply this migration AFTER the worker route deploys (same rule as the
-- artifact-offload / llc-research-tick workers). Verify post-deploy with a GET
-- dry-run before relying on the cron.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent: drop any prior schedule before reinstalling so re-running
    -- this migration doesn't double the rate.
    BEGIN
      PERFORM cron.unschedule('lcc-intake-rematch');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Vercel target: lcc_cron_post POSTs to <base>/api/intake-rematch with
    -- Authorization: Bearer <vault.lcc_api_key>. The handler reads limit from
    -- the query string, so encode it in the URL rather than the JSON body.
    PERFORM cron.schedule(
      'lcc-intake-rematch',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake-rematch?limit=100', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
