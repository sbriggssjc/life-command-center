-- =============================================================================
-- R74e Task 6c Phase A — STOP the over-stamp writer (gov, government
-- scknotsqkcheojiaewwh). Mirror of the dia fix.
--
-- Same root cause + fix as the dia migration of the same date: clamp the
-- off-market / price-change stamps to CURRENT_DATE so public.lcc_record_listing_check
-- can never set off_market_date in the future, regardless of caller. gov currently
-- has only 12 undated listings and 0 future-off_market rows, so the gov exposure is
-- tiny — but the writer is shared-shape across both verticals, so it is fixed here too
-- to keep the two functions in lock-step. All other behavior byte-identical to the
-- live gov function (captured 2026-06-10).
--
-- Idempotent CREATE OR REPLACE; same signature (uuid p_listing_id on gov). Safe DB-first.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id uuid,
  p_method text,
  p_check_result text,
  p_asking_price numeric DEFAULT NULL::numeric,
  p_cap_rate numeric DEFAULT NULL::numeric,
  p_source_url text DEFAULT NULL::text,
  p_http_status integer DEFAULT NULL::integer,
  p_response_summary text DEFAULT NULL::text,
  p_off_market_reason text DEFAULT NULL::text,
  p_effective_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_verified_by uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text)
 RETURNS TABLE(verification_id bigint, status_history_id bigint, state_transitioned boolean, new_status text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prior_price       numeric;
  v_prior_status      text;
  v_new_status        text;
  v_state_transition  boolean := false;
  v_verif_id          bigint;
  v_status_id         bigint;
  -- R74e: never let an off-market / price-change stamp land in the future.
  v_eff_date          date := LEAST(COALESCE(p_effective_at::date, CURRENT_DATE), CURRENT_DATE);
BEGIN
  SELECT asking_price, listing_status INTO v_prior_price, v_prior_status
    FROM public.available_listings WHERE listing_id = p_listing_id;

  v_new_status := CASE p_check_result
    WHEN 'still_available' THEN CASE WHEN COALESCE(v_prior_status,'active') <> 'active' THEN 're_listed' ELSE NULL END
    WHEN 'price_changed'   THEN 'price_changed'
    WHEN 'off_market'      THEN 'withdrawn'
    WHEN 'sold'            THEN 'sold'
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
         asking_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL
                              THEN p_asking_price ELSE asking_price END,
         asking_cap_rate = CASE WHEN p_cap_rate IS NOT NULL THEN p_cap_rate ELSE asking_cap_rate END,
         last_price_change = CASE WHEN p_check_result = 'price_changed'
                                   THEN v_eff_date
                                   ELSE last_price_change END,
         listing_status = CASE
           WHEN p_check_result = 'off_market' THEN 'withdrawn'
           WHEN p_check_result = 'sold'       THEN 'sold'
           WHEN p_check_result = 'still_available' AND COALESCE(listing_status,'active') <> 'active' THEN 'active'
           ELSE listing_status
         END,
         off_market_date = CASE
           WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL
                THEN v_eff_date
           ELSE off_market_date
         END,
         off_market_reason = CASE
           WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn')
           WHEN p_check_result = 'sold' THEN 'sold'
           ELSE off_market_reason
         END
   WHERE listing_id = p_listing_id;

  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $function$;
