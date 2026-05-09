-- ============================================================================
-- Round 76gn — schedule the geocode backfill tick (LCC Opps)
--
-- Background: an audit on 2026-05-08 (debugging the lease-comps export
-- "no comps near this subject" toast on every click) confirmed that
-- essentially zero rows in dia.properties have latitude/longitude
-- populated. Same applies on gov.properties. The lease-comps export
-- ranks comparables by haversine distance, so a NULL lat/lng property
-- silently drops out of consideration.
--
-- New api/admin.js sub-route (api/_handlers/geocode-backfill.js):
--   POST /api/geocode-tick?domain=both&limit=60
--     -> pulls up to 60 rows per domain WHERE latitude IS NULL
--     -> geocodes each via US Census Bureau onelineaddress API
--     -> PATCHes latitude/longitude back to properties
--     -> returns {by_domain: {dia/gov: {scanned, patched, missed, ...}}}
--
-- Cadence: every 10 minutes. Drains a ~5000-row backlog in ~14 hours
-- (60 rows/tick × 6 ticks/hr = 360 rows/hr). Once the backlog is clear,
-- the same cadence keeps the geocode coverage current as new properties
-- arrive via OM intake / CoStar capture / batch imports.
--
-- Why not faster: each tick makes one Census call per row (~300-500ms)
-- plus a PATCH back. 60 rows × ~500ms = ~30s — already pushing Vercel's
-- function ceiling. Bumping the limit risks function timeout; bumping
-- the cadence wastes budget on empty ticks once the backlog is gone.
--
-- For a one-time fast backfill (Census-only, ~25 min for 5000 rows),
-- run scripts/geocode-properties-backfill.mjs from a workstation with
-- the dia + gov SUPABASE_URL/_KEY env vars set. The cron then takes
-- over for ongoing maintenance.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent: drop any prior schedule before reinstalling so re-running
    -- this migration doesn't double the rate.
    BEGIN
      PERFORM cron.unschedule('lcc-geocode-backfill');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Vercel target: lcc_cron_post POSTs to <vercel-base>/api/geocode-tick
    -- with Authorization: Bearer <vault.lcc_api_key>. The handler accepts
    -- query-string params, so we encode domain+limit in the URL rather
    -- than the JSON body.
    PERFORM cron.schedule(
      'lcc-geocode-backfill',
      '*/10 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/geocode-tick?domain=both&limit=60', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
