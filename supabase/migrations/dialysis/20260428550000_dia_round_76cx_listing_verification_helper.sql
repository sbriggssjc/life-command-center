-- ============================================================================
-- Round 76cx — listing verification system Phase 1 helper (dia)
--
-- lcc_record_listing_check: single entry point for ALL verification paths
-- (auto_scrape cron, sidebar verify button, manual user click in dashboard).
-- Atomic: writes a verification_history row, conditionally writes a
-- status_history row when state actually transitions, updates the
-- denormalized fields on available_listings.
--
-- Usage examples:
--   -- Sidebar verify button confirms still available at same price:
--   SELECT * FROM lcc_record_listing_check(
--     p_listing_id => 12345,
--     p_method => 'sidebar_capture',
--     p_check_result => 'still_available'
--   );
--
--   -- Auto-scrape detects price drop:
--   SELECT * FROM lcc_record_listing_check(
--     p_listing_id => 12345, p_method => 'auto_scrape',
--     p_check_result => 'price_changed', p_asking_price => 1750000,
--     p_source_url => 'https://...', p_http_status => 200
--   );
--
--   -- Manual user marks property as sold:
--   SELECT * FROM lcc_record_listing_check(
--     p_listing_id => 12345, p_method => 'manual_user',
--     p_check_result => 'sold', p_effective_at => '2026-04-15'::timestamptz,
--     p_verified_by => '<user-uuid>'
--   );
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id   integer,
  p_method       text,
  p_check_result text,
  p_asking_price numeric DEFAULT NULL,
  p_cap_rate     numeric DEFAULT NULL,
  p_source_url   text    DEFAULT NULL,
  p_http_status  integer DEFAULT NULL,
  p_response_summary text DEFAULT NULL,
  p_off_market_reason text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_verified_by  uuid    DEFAULT NULL,
  p_notes        text    DEFAULT NULL
) RETURNS TABLE(
  verification_id bigint,
  status_history_id bigint,
  state_transitioned boolean,
  new_status text
) LANGUAGE plpgsql AS $$
DECLARE
  v_prior_price       numeric;
  v_new_status        text;
  v_state_transition  boolean := false;
  v_verif_id          bigint;
  v_status_id         bigint;
  v_listing_active    boolean;
BEGIN
  SELECT last_price, is_active INTO v_prior_price, v_listing_active
    FROM public.available_listings WHERE listing_id = p_listing_id;

  v_new_status := CASE p_check_result
    WHEN 'still_available'      THEN CASE WHEN v_listing_active THEN NULL ELSE 're_listed' END
    WHEN 'price_changed'        THEN 'price_changed'
    WHEN 'off_market'           THEN 'withdrawn'
    WHEN 'sold'                 THEN 'sold'
    WHEN 'unreachable'          THEN NULL
    WHEN 'manual_review_needed' THEN NULL
    ELSE NULL
  END;

  INSERT INTO public.listing_verification_history (
    listing_id, verified_at, method, check_result,
    asking_price_at_check, prior_asking_price, price_delta,
    source_url, http_status, response_summary, notes, verified_by
  ) VALUES (
    p_listing_id, COALESCE(p_effective_at, now()), p_method, p_check_result,
    p_asking_price, v_prior_price,
    CASE WHEN p_asking_price IS NOT NULL AND v_prior_price IS NOT NULL
         THEN p_asking_price - v_prior_price ELSE NULL END,
    p_source_url, p_http_status, p_response_summary, p_notes, p_verified_by
  ) RETURNING id INTO v_verif_id;

  IF v_new_status IS NOT NULL THEN
    INSERT INTO public.listing_status_history (
      listing_id, status, effective_at, asking_price, cap_rate, source, notes, recorded_by
    ) VALUES (
      p_listing_id, v_new_status, COALESCE(p_effective_at, now()),
      p_asking_price, p_cap_rate, p_method, p_notes, p_verified_by
    ) RETURNING id INTO v_status_id;
    v_state_transition := true;
  END IF;

  UPDATE public.available_listings
     SET last_verified_at = COALESCE(p_effective_at, now()),
         consecutive_check_failures = CASE
           WHEN p_check_result = 'unreachable' THEN consecutive_check_failures + 1
           ELSE 0
         END,
         last_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL
                            THEN p_asking_price ELSE last_price END,
         current_cap_rate = CASE WHEN p_cap_rate IS NOT NULL THEN p_cap_rate ELSE current_cap_rate END,
         price_change_date = CASE WHEN p_check_result = 'price_changed'
                                   THEN COALESCE(p_effective_at::date, CURRENT_DATE)
                                   ELSE price_change_date END,
         is_active = CASE
           WHEN p_check_result IN ('off_market','sold') THEN false
           WHEN p_check_result = 'still_available' THEN true
           ELSE is_active
         END,
         off_market_date = CASE
           WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL
                THEN COALESCE(p_effective_at::date, CURRENT_DATE)
           ELSE off_market_date
         END,
         off_market_reason = CASE
           WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn')
           WHEN p_check_result = 'sold' THEN 'sold'
           ELSE off_market_reason
         END
   WHERE listing_id = p_listing_id;

  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $$;
