-- ============================================================================
-- Round 76ej.g — schedule the availability-checker Edge Function (LCC Opps)
--
-- New Supabase Edge Function:
--   supabase/functions/availability-checker/index.ts
--
-- It pulls overdue active listings from dia.available_listings and
-- gov.available_listings, fetches each listing URL with a browser-shaped
-- User-Agent (jitter 2–3s, concurrency capped at 3), parses the HTML for
-- per-site off-market markers (CREXi, CoStar, LoopNet), and records the
-- outcome via public.lcc_record_listing_check on the source domain DB.
-- A field_provenance row tagged source='availability_scraper' is written
-- through public.lcc_merge_field for each url_status change.
--
-- IMPORTANT distinction from the existing lcc-auto-scrape-listings cron
-- (api/admin.js handleAutoScrapeListings):
--   - lcc-auto-scrape-listings owns the 'sold' path. It checks
--     sales_transactions inside a ±3-year window and auto-marks Sold
--     when a deed lands. Runs every 6h on the hour.
--   - lcc-availability-checker owns the URL-probing path. It writes
--     'off_market' / 'withdrawn' / 'unverified_assumed_off' based on
--     what the listing site itself says. NEVER writes 'sold' — even when
--     the page banner reads "Sold" (in that case it records off_market
--     with reason='unverified_assumed_off' and lets the sales_transactions
--     watcher promote it later, or surface it for manual review).
--
-- The two crons run together at the same 6h cadence. We offset this one
-- by 30 minutes so they don't both hammer PostgREST at the top of the
-- hour.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- Register the new source in field_source_priority so lcc_merge_field
-- doesn't degrade availability_scraper writes to 'unregistered_source_*'
-- decisions on the second pass over the same listing. Priority 65 puts
-- it adjacent to costar_sidebar — both are aggregator-quality, but the
-- scraper is reading the same surface a human would see, so we don't
-- want it to outrank actual human edits or sidebar captures.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('dia.available_listings', 'url_status', 'manual_edit',          1,  null,
   'Explicit human override.'),
  ('dia.available_listings', 'url_status', 'sidebar_capture',      40, null,
   'Sidebar verify button — the user just confirmed visually.'),
  ('dia.available_listings', 'url_status', 'sales_transactions',   45, null,
   'Auto-marked sold from a deed match (lcc-auto-scrape-listings cron).'),
  ('dia.available_listings', 'url_status', 'availability_scraper', 65, null,
   'lcc-availability-checker Edge Function — periodic URL probe.'),
  ('gov.available_listings', 'url_status', 'manual_edit',          1,  null,
   'Explicit human override.'),
  ('gov.available_listings', 'url_status', 'sidebar_capture',      40, null,
   'Sidebar verify button — the user just confirmed visually.'),
  ('gov.available_listings', 'url_status', 'sales_transactions',   45, null,
   'Auto-marked sold from a deed match.'),
  ('gov.available_listings', 'url_status', 'availability_scraper', 65, null,
   'lcc-availability-checker Edge Function — periodic URL probe.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-availability-checker');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- target='edge' => POST to https://<ops>.supabase.co/functions/v1/<endpoint>
    -- with Authorization: Bearer <vault.lcc_api_key> (see
    -- 20260428530000_lcc_round_76cw_pg_net_timeout_bump.sql for lcc_cron_post).
    PERFORM cron.schedule(
      'lcc-availability-checker',
      '30 */6 * * *',  -- every 6h at :30, offset from lcc-auto-scrape-listings
      $cmd$SELECT public.lcc_cron_post('/availability-checker',
        '{"domain":"both","limit":25}'::jsonb, 'edge')$cmd$
    );
  END IF;
END $$;
