-- ============================================================================
-- Round 76cx — listing verification system Phase 1 (gov)
--
-- Mirror of dia migration adapted for gov.available_listings shape:
--   - listing_id is uuid (not integer)
--   - asking_price (not last_price)
--   - listing_status text (not is_active)
--   - source_url + tracked_urls jsonb (not listing_url + url)
--   - exclude_from_listing_metrics boolean already exists
-- ============================================================================

ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS off_market_reason text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS consecutive_check_failures integer DEFAULT 0;

ALTER TABLE public.available_listings DROP CONSTRAINT IF EXISTS al_off_market_reason_check;
ALTER TABLE public.available_listings ADD CONSTRAINT al_off_market_reason_check
  CHECK (off_market_reason IS NULL OR off_market_reason IN ('sold','expired','withdrawn','unverified_assumed_off','duplicate','other'));

ALTER TABLE public.available_listings DROP CONSTRAINT IF EXISTS al_verification_priority_check;
ALTER TABLE public.available_listings ADD CONSTRAINT al_verification_priority_check
  CHECK (verification_priority IN ('high','normal','low'));

CREATE TABLE IF NOT EXISTS public.listing_status_history (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.available_listings(listing_id) ON DELETE CASCADE,
  status text NOT NULL,
  effective_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  asking_price numeric, cap_rate numeric, source text, notes text, recorded_by uuid,
  CONSTRAINT lsh_status_check CHECK (status IN ('active','price_changed','withdrawn','expired','sold','re_listed')),
  CONSTRAINT lsh_source_check CHECK (source IS NULL OR source IN ('auto_scrape','sidebar_capture','manual_user','sale_imported','matcher_inferred','seed_import'))
);
CREATE INDEX IF NOT EXISTS lsh_listing_id_effective_at_idx ON public.listing_status_history (listing_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS lsh_status_effective_at_idx ON public.listing_status_history (status, effective_at DESC);

CREATE TABLE IF NOT EXISTS public.listing_verification_history (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.available_listings(listing_id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL, check_result text NOT NULL,
  asking_price_at_check numeric, prior_asking_price numeric, price_delta numeric,
  source_url text, http_status integer, response_summary text, notes text, verified_by uuid,
  CONSTRAINT lvh_method_check CHECK (method IN ('auto_scrape','manual_user','sidebar_capture','sold_imported')),
  CONSTRAINT lvh_check_result_check CHECK (check_result IN ('still_available','price_changed','off_market','sold','unreachable','manual_review_needed'))
);
CREATE INDEX IF NOT EXISTS lvh_listing_id_verified_at_idx ON public.listing_verification_history (listing_id, verified_at DESC);

CREATE OR REPLACE FUNCTION public.lcc_compute_verification_due_at(p_listing_date date, p_last_verified_at timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_listing_date IS NULL THEN now() + interval '30 days'
    WHEN (CURRENT_DATE - p_listing_date) < 30 THEN COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '14 days'
    WHEN (CURRENT_DATE - p_listing_date) < 90 THEN COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '30 days'
    ELSE COALESCE(p_last_verified_at, p_listing_date::timestamptz) + interval '60 days'
  END;
$$;

CREATE OR REPLACE FUNCTION public.gov_listings_set_verification_due_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.listing_status, 'active') = 'active' THEN
    NEW.verification_due_at := public.lcc_compute_verification_due_at(NEW.listing_date, NEW.last_verified_at);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gov_listings_verification_due_at ON public.available_listings;
CREATE TRIGGER trg_gov_listings_verification_due_at
  BEFORE INSERT OR UPDATE OF listing_date, last_verified_at, listing_status ON public.available_listings
  FOR EACH ROW EXECUTE FUNCTION public.gov_listings_set_verification_due_at();

UPDATE public.available_listings
   SET verification_due_at = public.lcc_compute_verification_due_at(listing_date, last_verified_at)
 WHERE COALESCE(listing_status, 'active') = 'active' AND verification_due_at IS NULL;

CREATE OR REPLACE FUNCTION public.v_listings_on_market_at(target_date date)
RETURNS TABLE(listing_id uuid, property_id bigint, listing_date date, off_market_date date,
              asking_price numeric, cap_rate numeric, status_at_target text)
LANGUAGE sql STABLE AS $$
  WITH per_listing_state_at AS (
    SELECT DISTINCT ON (h.listing_id) h.listing_id, h.status, h.asking_price, h.cap_rate
    FROM public.listing_status_history h
    WHERE h.effective_at <= (target_date + interval '1 day')
    ORDER BY h.listing_id, h.effective_at DESC
  )
  SELECT al.listing_id, al.property_id, al.listing_date, al.off_market_date,
         COALESCE(s.asking_price, al.asking_price),
         COALESCE(s.cap_rate, al.asking_cap_rate),
         COALESCE(s.status, CASE WHEN al.off_market_date IS NULL OR al.off_market_date > target_date THEN 'active' ELSE 'off_market' END)
  FROM public.available_listings al
  LEFT JOIN per_listing_state_at s ON s.listing_id = al.listing_id
  WHERE al.listing_date IS NOT NULL AND al.listing_date <= target_date
    AND (al.off_market_date IS NULL OR al.off_market_date > target_date)
    AND COALESCE(al.exclude_from_listing_metrics, false) IS FALSE
    AND COALESCE(s.status, CASE WHEN al.off_market_date IS NULL OR al.off_market_date > target_date THEN 'active' ELSE 'off_market' END)
        NOT IN ('off_market','withdrawn','expired','sold');
$$;

CREATE OR REPLACE VIEW public.v_listings_due_for_verification AS
SELECT al.listing_id, al.property_id, al.listing_date,
  CURRENT_DATE - al.listing_date AS days_on_market,
  al.asking_price,
  al.last_verified_at, al.verification_due_at, al.verification_priority,
  al.consecutive_check_failures,
  COALESCE(al.source_url, (al.tracked_urls->>0)::text) AS source_url,
  CASE
    WHEN al.consecutive_check_failures >= 3 THEN 'manual_research'
    WHEN COALESCE(al.source_url, (al.tracked_urls->>0)::text) IS NULL THEN 'manual_research'
    WHEN COALESCE(al.source_url, (al.tracked_urls->>0)::text) ILIKE '%costar.com%'  THEN 'auto_scrape_eligible'
    WHEN COALESCE(al.source_url, (al.tracked_urls->>0)::text) ILIKE '%loopnet.com%' THEN 'auto_scrape_eligible'
    WHEN COALESCE(al.source_url, (al.tracked_urls->>0)::text) ILIKE '%crexi.com%'   THEN 'auto_scrape_eligible'
    ELSE 'manual_research'
  END AS next_action
FROM public.available_listings al
WHERE COALESCE(al.listing_status, 'active') = 'active'
  AND COALESCE(al.exclude_from_listing_metrics, false) IS FALSE
  AND (al.verification_due_at IS NULL OR al.verification_due_at <= now());
