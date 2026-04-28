-- ============================================================================
-- Round 76cx — listing verification system Phase 1 (dia)
--
-- Schema foundation for replacing the manual "research every property in
-- the available tables every 30 days" workflow. Two append-only history
-- tables, helper columns on available_listings, and views that power
-- snapshot reporting + the manual-research triage queue.
--
-- KEY PRINCIPLE: never delete on-market data. listing_status_history is
-- append-only; available_listings.is_active / off_market_date are
-- denormalized summaries that history can always reconstruct.
--
-- Existing dia.available_listings columns we leverage (no rename, no drop):
--   listing_date, off_market_date, is_active, last_seen, url_last_checked,
--   listing_url, url, price_change_history, sold_date, sold_price,
--   sale_transaction_id
-- ============================================================================

ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS off_market_reason text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS consecutive_check_failures integer DEFAULT 0;

ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS al_off_market_reason_check;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_off_market_reason_check
  CHECK (off_market_reason IS NULL
         OR off_market_reason IN ('sold','expired','withdrawn','unverified_assumed_off','duplicate','other'));

ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS al_verification_priority_check;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_verification_priority_check
  CHECK (verification_priority IN ('high','normal','low'));

CREATE TABLE IF NOT EXISTS public.listing_status_history (
  id              bigserial PRIMARY KEY,
  listing_id      integer NOT NULL REFERENCES public.available_listings(listing_id) ON DELETE CASCADE,
  status          text NOT NULL,
  effective_at    timestamptz NOT NULL,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  asking_price    numeric,
  cap_rate        numeric,
  source          text,
  notes           text,
  recorded_by     uuid,
  CONSTRAINT lsh_status_check CHECK (status IN
    ('active','price_changed','withdrawn','expired','sold','re_listed')),
  CONSTRAINT lsh_source_check CHECK (source IS NULL OR source IN
    ('auto_scrape','sidebar_capture','manual_user','sale_imported','matcher_inferred','seed_import'))
);
CREATE INDEX IF NOT EXISTS lsh_listing_id_effective_at_idx
  ON public.listing_status_history (listing_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS lsh_status_effective_at_idx
  ON public.listing_status_history (status, effective_at DESC);

CREATE TABLE IF NOT EXISTS public.listing_verification_history (
  id                     bigserial PRIMARY KEY,
  listing_id             integer NOT NULL REFERENCES public.available_listings(listing_id) ON DELETE CASCADE,
  verified_at            timestamptz NOT NULL DEFAULT now(),
  method                 text NOT NULL,
  check_result           text NOT NULL,
  asking_price_at_check  numeric,
  prior_asking_price     numeric,
  price_delta            numeric,
  source_url             text,
  http_status            integer,
  response_summary       text,
  notes                  text,
  verified_by            uuid,
  CONSTRAINT lvh_method_check CHECK (method IN
    ('auto_scrape','manual_user','sidebar_capture','sold_imported')),
  CONSTRAINT lvh_check_result_check CHECK (check_result IN
    ('still_available','price_changed','off_market','sold','unreachable','manual_review_needed'))
);
CREATE INDEX IF NOT EXISTS lvh_listing_id_verified_at_idx
  ON public.listing_verification_history (listing_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS lvh_method_result_idx
  ON public.listing_verification_history (method, check_result);

CREATE OR REPLACE FUNCTION public.lcc_compute_verification_due_at(
  p_listing_date date,
  p_last_verified_at timestamptz
) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_listing_date IS NULL THEN now() + interval '30 days'
    WHEN (CURRENT_DATE - p_listing_date) < 30 THEN
      COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '14 days'
    WHEN (CURRENT_DATE - p_listing_date) < 90 THEN
      COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '30 days'
    ELSE
      COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '60 days'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dia_listings_set_verification_due_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active IS NOT FALSE THEN
    NEW.verification_due_at := public.lcc_compute_verification_due_at(
      NEW.listing_date, NEW.last_verified_at
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_listings_verification_due_at ON public.available_listings;
CREATE TRIGGER trg_dia_listings_verification_due_at
  BEFORE INSERT OR UPDATE OF listing_date, last_verified_at, is_active
  ON public.available_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.dia_listings_set_verification_due_at();

UPDATE public.available_listings
   SET verification_due_at = public.lcc_compute_verification_due_at(listing_date, last_verified_at)
 WHERE is_active IS NOT FALSE
   AND verification_due_at IS NULL;

-- v_listings_on_market_at: returns listings that were on market on target_date
-- by reading listing_status_history (authoritative) and falling back to
-- denormalized columns for listings that pre-date status_history adoption.
CREATE OR REPLACE FUNCTION public.v_listings_on_market_at(target_date date)
RETURNS TABLE(
  listing_id integer,
  property_id integer,
  listing_date date,
  off_market_date date,
  asking_price numeric,
  cap_rate numeric,
  status_at_target text
) LANGUAGE sql STABLE AS $$
  WITH per_listing_state_at AS (
    SELECT DISTINCT ON (h.listing_id) h.listing_id, h.status, h.asking_price, h.cap_rate
    FROM public.listing_status_history h
    WHERE h.effective_at <= (target_date + interval '1 day')
    ORDER BY h.listing_id, h.effective_at DESC
  )
  SELECT
    al.listing_id,
    al.property_id,
    al.listing_date,
    al.off_market_date,
    COALESCE(s.asking_price, al.last_price) AS asking_price,
    COALESCE(s.cap_rate, al.current_cap_rate, al.cap_rate) AS cap_rate,
    COALESCE(s.status,
             CASE WHEN al.off_market_date IS NULL OR al.off_market_date > target_date
                  THEN 'active' ELSE 'off_market' END) AS status_at_target
  FROM public.available_listings al
  LEFT JOIN per_listing_state_at s ON s.listing_id = al.listing_id
  WHERE al.listing_date IS NOT NULL
    AND al.listing_date <= target_date
    AND (al.off_market_date IS NULL OR al.off_market_date > target_date)
    AND COALESCE(s.status,
                 CASE WHEN al.off_market_date IS NULL OR al.off_market_date > target_date
                      THEN 'active' ELSE 'off_market' END) NOT IN
        ('off_market','withdrawn','expired','sold');
$$;

-- v_listings_due_for_verification: the triage queue
CREATE OR REPLACE VIEW public.v_listings_due_for_verification AS
SELECT
  al.listing_id,
  al.property_id,
  al.listing_date,
  CURRENT_DATE - al.listing_date AS days_on_market,
  al.last_price AS asking_price,
  al.last_verified_at,
  al.verification_due_at,
  al.verification_priority,
  al.consecutive_check_failures,
  COALESCE(al.listing_url, al.url) AS source_url,
  CASE
    WHEN al.consecutive_check_failures >= 3 THEN 'manual_research'
    WHEN COALESCE(al.listing_url, al.url) IS NULL THEN 'manual_research'
    WHEN COALESCE(al.listing_url, al.url) ILIKE '%costar.com%'  THEN 'auto_scrape_eligible'
    WHEN COALESCE(al.listing_url, al.url) ILIKE '%loopnet.com%' THEN 'auto_scrape_eligible'
    WHEN COALESCE(al.listing_url, al.url) ILIKE '%crexi.com%'   THEN 'auto_scrape_eligible'
    WHEN COALESCE(al.listing_url, al.url) ILIKE '%rcanalytics%' THEN 'sidebar_recapture'
    ELSE 'manual_research'
  END AS next_action
FROM public.available_listings al
WHERE al.is_active IS NOT FALSE
  AND (al.verification_due_at IS NULL OR al.verification_due_at <= now());
