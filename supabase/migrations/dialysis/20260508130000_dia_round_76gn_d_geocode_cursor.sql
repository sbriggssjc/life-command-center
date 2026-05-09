-- Round 76gn.d (2026-05-08): geocode-tick cursor pagination state.
--
-- The geocode-tick cron handler was fetching
--   latitude=is.null ORDER BY property_id ASC LIMIT 60
-- on every tick, which means every tick re-reads the same head-of-queue
-- rows. When the head contains permanent failures (corrupted addresses
-- like 'Unknown Address', PO boxes, suite-only entries that neither
-- Census nor Google can resolve), the cron stalls there forever and
-- never advances to the bulk of the queue. Concrete impact: pre-fix,
-- dia.properties had 8,601 ungeocoded rows above property_id 24,270
-- that the cron had never even fetched in 32 runs over 24 hours.
--
-- Fix: a singleton row per domain DB tracking the last-seen property_id.
-- Each tick fetches `property_id > cursor`, processes, and writes
-- max(property_id) of the batch back. When the query returns no rows,
-- we wrap to 0 so newly-arrived ungeocoded rows get picked up.

CREATE TABLE IF NOT EXISTS public.geocode_cursor (
  id smallint PRIMARY KEY DEFAULT 1,
  last_seen_property_id bigint NOT NULL DEFAULT 0,
  loops_completed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geocode_cursor_singleton CHECK (id = 1)
);

INSERT INTO public.geocode_cursor (id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, UPDATE ON public.geocode_cursor TO service_role;
GRANT SELECT, UPDATE ON public.geocode_cursor TO authenticated;

COMMENT ON TABLE public.geocode_cursor IS
  'Singleton cursor for the geocode-tick cron. Tracks last_seen_property_id so each tick advances past head-of-queue failures instead of re-reading them. See api/_handlers/geocode-backfill.js. Round 76gn.d.';
