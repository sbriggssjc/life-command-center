-- Topic 20 (audit §11.37): cron-schedule all five BD-data syncs.
--
-- The §11.22 / §11.23 / §11.28 / §11.32 / §11.36 topics built five
-- pg_net-based syncs that each have a (fire, finalize) pair:
--   - lcc_sync_classified_owners        / lcc_finalize_classified_owners
--   - lcc_sync_entity_portfolios        / lcc_finalize_entity_portfolios
--   - lcc_sync_property_attributes      / lcc_finalize_property_attributes
--   - lcc_sync_listing_events           / lcc_finalize_listing_events
--
-- All four data-sync pairs were left unscheduled in their original
-- topics because the four vault secrets they require
-- (dia_supabase_url, dia_supabase_anon_key, gov_supabase_url,
-- gov_supabase_anon_key) hadn't been seeded yet. Each function
-- gracefully RAISE NOTICEs and skips when its secrets are missing,
-- so scheduling them now is safe — the jobs will no-op until the
-- vault secrets land, then start running automatically.
--
-- Schedule layout (all UTC, staggered by 5 minutes per pair):
--
--   :05/:10 (every 4h) — entity sync       (owner classifications)
--   :15/:20 (every 4h) — portfolio sync    (owner↔property edges)
--   :25/:30 (every 4h) — listing events    (sales_transactions)
--   :35/:40 (every 24h, 4 AM UTC) — property attributes (changes slowly)
--   :45     (hourly)   — pg_net response cleanup (>24h old)
--
-- Why 4h vs daily:
--   * Entity classifications change continuously as the dia/gov
--     reclassify-cron jobs run; want LCC fresh within 4h.
--   * Portfolio edges follow ownership_history inserts, which lag
--     classifications by 0-24h — 4h pickup is appropriate.
--   * Listing events tied to sales_transactions; weekly cadence
--     in raw data, but the 30-day lookback window in the sync
--     means each 4h call mostly re-confirms recent inserts. Cost
--     is low (~30 events per pull) so 4h keeps the queue fresh.
--   * Property attributes (address/lat/lng/year/agency) are
--     write-once for most properties. Daily refresh is more than
--     enough.

BEGIN;

-- ---------------------------------------------------------------------------
-- Entity classification sync (§11.22)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-entity-sync-fire',
  '5 */4 * * *',
  $$SELECT public.lcc_sync_classified_owners('both');$$
);

SELECT cron.schedule(
  'lcc-entity-sync-finalize',
  '10 */4 * * *',
  $$SELECT public.lcc_finalize_classified_owners();$$
);

-- ---------------------------------------------------------------------------
-- Portfolio facts sync (§11.23)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-portfolio-sync-fire',
  '15 */4 * * *',
  $$SELECT public.lcc_sync_entity_portfolios('both');$$
);

SELECT cron.schedule(
  'lcc-portfolio-sync-finalize',
  '20 */4 * * *',
  $$SELECT public.lcc_finalize_entity_portfolios();$$
);

-- ---------------------------------------------------------------------------
-- Listing-event watcher (§11.32)
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-listing-event-sync-fire',
  '25 */4 * * *',
  $$SELECT public.lcc_sync_listing_events('both', 30);$$
);

SELECT cron.schedule(
  'lcc-listing-event-sync-finalize',
  '30 */4 * * *',
  $$SELECT public.lcc_finalize_listing_events();$$
);

-- ---------------------------------------------------------------------------
-- Property attribute sync (§11.28 / §11.36) — daily
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-property-attrs-sync-fire',
  '35 4 * * *',
  $$SELECT public.lcc_sync_property_attributes('both');$$
);

SELECT cron.schedule(
  'lcc-property-attrs-sync-finalize',
  '40 4 * * *',
  $$SELECT public.lcc_finalize_property_attributes();$$
);

-- ---------------------------------------------------------------------------
-- pg_net response cleanup — pg_net stores HTTP responses in
-- net._http_response indefinitely by default. With five syncs firing
-- 6×/day each averaging ~30 requests, that's 900 rows/day. Keep 24h
-- of history for debugging and drop anything older.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-pg-net-response-cleanup',
  '45 * * * *',
  $$DELETE FROM net._http_response WHERE created < now() - interval '24 hours';$$
);

COMMIT;
