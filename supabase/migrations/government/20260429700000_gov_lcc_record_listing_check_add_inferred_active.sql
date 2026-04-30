-- ============================================================================
-- Round 76et-C (gov): mirror of the dia migration. Adds 'inferred_active' as
-- a check_result for the auto-scrape cron's no-sale-match path. See the dia
-- migration in this round for the full rationale.
--
-- Gov differences from dia:
--   - listing_id is uuid (not integer)
--   - asking_price (not last_price)
--   - asking_cap_rate (not current_cap_rate)
--   - listing_status text (not is_active boolean) — values 'active' /
--     'sold' / 'withdrawn'
--   - last_price_change (not price_change_date)
-- ============================================================================

ALTER TABLE public.listing_verification_history
  DROP CONSTRAINT IF EXISTS lvh_check_result_check;
ALTER TABLE public.listing_verification_history
  ADD CONSTRAINT lvh_check_result_check
  CHECK (check_result IN (
    'still_available','price_changed','off_market','sold',
    'unreachable','manual_review_needed','inferred_active'
  ));

CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id   uuid,
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
  v_prior_status      text;
  v_new_status        text;
  v_state_transition  boolean := false;
  v_verif_id          bigint;
  v_status_id         bigint;
BEGIN
  SELECT asking_price, listing_status INTO v_prior_price, v_prior_status
    FROM public.available_listings WHERE listing_id = p_listing_id;

  v_new_status := CASE p_check_result
    WHEN 'still_available' THEN CASE WHEN COALESCE(v_prior_status,'active') <> 'active' THEN 're_listed' ELSE NULL END
    WHEN 'price_changed'   THEN 'price_changed'
    WHEN 'off_market'      THEN 'withdrawn'
    WHEN 'sold'            THEN 'sold'
    WHEN 'inferred_active' THEN NULL  -- no transition; cron just advanced timer
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

  -- inferred_active: timer advance only. Do NOT reset URL-scrape failure
  -- counter, do NOT change listing_status, do NOT touch pricing columns.
  UPDATE public.available_listings
     SET last_verified_at = COALESCE(p_effective_at, now()),
         consecutive_check_failures = CASE
           WHEN p_check_result = 'unreachable' THEN consecutive_check_failures + 1
           WHEN p_check_result = 'inferred_active' THEN consecutive_check_failures
           ELSE 0
         END,
         asking_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL
                              THEN p_asking_price ELSE asking_price END,
         asking_cap_rate = CASE
           WHEN p_check_result = 'inferred_active' THEN asking_cap_rate
           WHEN p_cap_rate IS NOT NULL THEN p_cap_rate
           ELSE asking_cap_rate END,
         last_price_change = CASE WHEN p_check_result = 'price_changed'
                                   THEN COALESCE(p_effective_at::date, CURRENT_DATE)
                                   ELSE last_price_change END,
         listing_status = CASE
           WHEN p_check_result = 'off_market' THEN 'withdrawn'
           WHEN p_check_result = 'sold'       THEN 'sold'
           WHEN p_check_result = 'still_available' AND COALESCE(listing_status,'active') <> 'active' THEN 'active'
           WHEN p_check_result = 'inferred_active' THEN listing_status
           ELSE listing_status
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
