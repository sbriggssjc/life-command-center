-- ============================================================================
-- Listing web-page registry + snapshot ledger + crawl worker schedule (LCC Opps)
-- SPEC_forsale_om_and_webpage_ingest.md — Part B2
-- 2026-07-31
-- ----------------------------------------------------------------------------
-- PURPOSE. The sidebar captures a listing's external property webpage (the
-- broker's own listing page — Part B1 persists the primary URL onto the domain
-- listing row) but the extension can't fetch arbitrary broker sites for later
-- re-checks. This migration stands up the server-side (Railway egress) crawl
-- substrate in the BRAIN (LCC Opps):
--
--   * public.lcc_listing_web_pages       — durable registry of external listing
--                                            / property webpages, one row per
--                                            (domain, property_id, url), with a
--                                            crawl schedule + auto-retire state.
--   * public.lcc_listing_page_snapshots  — append-only per-crawl HTML-snapshot
--                                            ledger (dedup on content_hash so an
--                                            unchanged re-crawl reuses the prior
--                                            object).
--   * storage bucket 'listing-page-snapshots' (private) — raw HTML bytes.
--   * v_lcc_listing_page_crawl_worklist  — due pages, actionable-only, ordered
--                                            by next_crawl_at (Consumption-Layer).
--   * feature_flags_registry row for the proactive-AI-extraction toggle
--     (LISTING_PAGE_PROACTIVE_EXTRACT, default OFF).
--   * pg_cron job 'lcc-listing-page-crawl' → POST /api/listing-page-crawl.
--
-- Discipline: additive, idempotent (CREATE ... IF NOT EXISTS / ON CONFLICT /
-- unschedule-then-schedule), reversible (runbook below). Apply on LCC Opps
-- (xengecqvemvfknjvbvrq).
--
-- ----------------------------------------------------------------------------
-- REVERSAL RUNBOOK:
--   -- 1. Drop the cron job (if pg_cron present):
--   --      SELECT cron.unschedule('lcc-listing-page-crawl');
--   -- 2. Remove the feature-flag row:
--   --      DELETE FROM public.feature_flags_registry WHERE flag = 'LISTING_PAGE_PROACTIVE_EXTRACT';
--   -- 3. Drop the view + tables (snapshots FK-cascades from pages):
--   --      DROP VIEW  IF EXISTS public.v_lcc_listing_page_crawl_worklist;
--   --      DROP TABLE IF EXISTS public.lcc_listing_page_snapshots;
--   --      DROP TABLE IF EXISTS public.lcc_listing_web_pages;
--   -- 4. Empty + drop the storage bucket (only if no other data relies on it):
--   --      DELETE FROM storage.objects WHERE bucket_id = 'listing-page-snapshots';
--   --      DELETE FROM storage.buckets WHERE id = 'listing-page-snapshots';
--   -- 5. Drop the touch fn only if nothing else uses it:
--   --      DROP FUNCTION IF EXISTS public.lcc_touch_updated_at();  -- (leaves other tables' triggers dangling — keep unless certain)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared updated_at touch fn (repo convention: fn_pse_touch_updated_at /
-- *_set_updated_at). No single shared helper existed, so define a general one
-- here (idempotent CREATE OR REPLACE) and reuse it for this table.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- Registry — one row per external listing/property webpage we crawl.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_listing_web_pages (
  id                    bigserial PRIMARY KEY,
  domain                text NOT NULL CHECK (domain IN ('dia', 'gov', 'dialysis', 'government')),
  property_id           bigint,
  url                   text NOT NULL,
  label                 text,
  source                text DEFAULT 'costar_sidebar',
  matched_broker_domain boolean DEFAULT false,
  first_seen_at         timestamptz DEFAULT now(),
  last_crawled_at       timestamptz,
  last_http_status      int,
  last_availability     text,
  active                boolean DEFAULT true,
  next_crawl_at         timestamptz DEFAULT now(),
  consecutive_failures  int DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

COMMENT ON TABLE public.lcc_listing_web_pages IS
  'Registry of external listing/property webpages (broker sites) captured by the sidebar, crawled server-side for availability re-checks + proactive detail enrichment (SPEC Part B2).';

-- One registry row per (domain, property, url). property_id is nullable, so
-- COALESCE it to a sentinel for the uniqueness key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_listing_web_pages_domain_prop_url
  ON public.lcc_listing_web_pages (domain, COALESCE(property_id, -1), url);

-- Crawl-worklist index — active + due-first.
CREATE INDEX IF NOT EXISTS ix_lcc_listing_web_pages_active_next_crawl
  ON public.lcc_listing_web_pages (active, next_crawl_at);

DROP TRIGGER IF EXISTS trg_lcc_listing_web_pages_touch ON public.lcc_listing_web_pages;
CREATE TRIGGER trg_lcc_listing_web_pages_touch
  BEFORE UPDATE ON public.lcc_listing_web_pages
  FOR EACH ROW EXECUTE FUNCTION public.lcc_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Snapshot ledger — append-only, one row per crawl that recorded HTML.
-- Dedup on (page_id, content_hash): a re-crawl with identical HTML records the
-- status update on the registry but does NOT store a duplicate object.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_listing_page_snapshots (
  id              bigserial PRIMARY KEY,
  page_id         bigint NOT NULL REFERENCES public.lcc_listing_web_pages(id) ON DELETE CASCADE,
  fetched_at      timestamptz DEFAULT now(),
  http_status     int,
  content_hash    text,
  storage_bucket  text,
  storage_path    text,
  byte_size       bigint,
  availability    text,
  extracted_json  jsonb,
  notes           text
);

COMMENT ON TABLE public.lcc_listing_page_snapshots IS
  'Append-only per-crawl HTML-snapshot ledger for lcc_listing_web_pages. Dedup on (page_id, content_hash) — unchanged re-crawls reuse the prior stored object (SPEC Part B2).';

-- Dedup: at most one snapshot per (page, content_hash) when a hash is present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_listing_page_snapshots_page_hash
  ON public.lcc_listing_page_snapshots (page_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Private Storage bucket for the raw HTML snapshots.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-page-snapshots', 'listing-page-snapshots', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Crawl worklist — due, active pages only; ordered soonest-due first.
-- SECURITY INVOKER (all BD views in this repo are). Actionable-only: the worker
-- (or an operator) reads this instead of scanning the whole registry.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_listing_page_crawl_worklist
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.domain,
  p.property_id,
  p.url,
  p.last_availability,
  p.consecutive_failures,
  p.next_crawl_at
FROM public.lcc_listing_web_pages p
WHERE p.active = true
  AND p.next_crawl_at <= now()
ORDER BY p.next_crawl_at ASC;

COMMENT ON VIEW public.v_lcc_listing_page_crawl_worklist IS
  'Due, active external listing/property webpages for the listing-page-crawl worker, soonest-due first (SPEC Part B2).';

GRANT SELECT ON public.lcc_listing_web_pages TO anon, authenticated, service_role;
GRANT SELECT ON public.lcc_listing_page_snapshots TO anon, authenticated, service_role;
GRANT SELECT ON public.v_lcc_listing_page_crawl_worklist TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Feature-flag registry row — proactive AI detail extraction (default OFF).
-- Matches the exact column list of feature_flags_registry
-- (supabase/migrations/20260809120000_lcc_feature_flags_registry.sql).
-- ----------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry
  (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('LISTING_PAGE_PROACTIVE_EXTRACT',
   'Proactive AI detail extraction of crawled listing/property webpages (only on genuinely-changed HTML)',
   'listing-page-crawl worker (api/_handlers/listing-page-crawl.js)', 'LISTING_PAGE_PROACTIVE_EXTRACT',
   'off', NULL, 'LCC',
   'Requires LISTING_PAGE_PROACTIVE_EXTRACT=true; default OFF ⇒ crawl stores HTML + availability only, extracted_json stays null (no AI spend).')
ON CONFLICT (flag) DO UPDATE SET
  purpose    = EXCLUDED.purpose,
  surface    = EXCLUDED.surface,
  env_var    = EXCLUDED.env_var,
  state      = EXCLUDED.state,
  off_since  = EXCLUDED.off_since,
  owner      = EXCLUDED.owner,
  notes      = EXCLUDED.notes,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- Schedule the crawl worker — every 30 minutes. Idempotent
-- (unschedule-then-schedule inside a pg_cron-guarded DO block, the repo's
-- established cron pattern — see 20260731120500_lcc_sf_contact_resolve_cron.sql).
-- lcc_cron_post POSTs <base>/api/listing-page-crawl with
-- Authorization: Bearer <vault.lcc_api_key>. The endpoint 404s on Railway until
-- api/_handlers/listing-page-crawl.js is mounted in server.js, so this cron is
-- harmless until then — verify post-deploy with a GET/POST dry-run.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-listing-page-crawl');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      'lcc-listing-page-crawl',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/listing-page-crawl', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
