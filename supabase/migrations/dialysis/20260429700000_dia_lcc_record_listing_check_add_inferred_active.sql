-- ============================================================================
-- Round 76et-C (dia): add 'inferred_active' check_result for the auto-scrape
-- cron's no-sale-match path. The cron currently uses 'still_available' which:
--   - resets consecutive_check_failures (a URL-scrape counter the cron never
--     actually exercises — the cron only queries sales_transactions),
--   - via 'still_available' -> is_active=true, can flip a listing back to
--     active that was somehow non-active.
--
-- Both are overstatements of what the cron actually verified. The cron
-- evidence is "no sale row exists in the property's ±3-year window" — a
-- weaker statement than "the listing's URL is still live and the asking
-- price is unchanged."
--
-- This migration:
--   1. Expands the lvh_check_result_check constraint to allow
--      'inferred_active' alongside the existing values.
--   2. Updates lcc_record_listing_check to handle 'inferred_active' as a
--      narrow timer advance:
--        - audit row IS written (the cron's check IS recorded)
--        - status_history row is NOT written (no transition asserted)
--        - last_verified_at IS updated (timer advances)
--        - consecutive_check_failures stays the same (URL counter)
--        - is_active stays the same (status counter)
--        - pricing/off-market columns stay the same
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
    WHEN 'inferred_active'      THEN NULL  -- no transition; cron just advanced timer
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
  -- counter, do NOT change is_active, do NOT touch pricing columns.
  -- This keeps the audit trail honest about what the cron actually did.
  UPDATE public.available_listings
     SET last_verified_at = COALESCE(p_effective_at, now()),
         consecutive_check_failures = CASE
           WHEN p_check_result = 'unreachable' THEN consecutive_check_failures + 1
           WHEN p_check_result = 'inferred_active' THEN consecutive_check_failures
           ELSE 0
         END,
         last_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL
                            THEN p_asking_price ELSE last_price END,
         current_cap_rate = CASE
           WHEN p_check_result = 'inferred_active' THEN current_cap_rate
           WHEN p_cap_rate IS NOT NULL THEN p_cap_rate
           ELSE current_cap_rate END,
         price_change_date = CASE WHEN p_check_result = 'price_changed'
                                   THEN COALESCE(p_effective_at::date, CURRENT_DATE)
                                   ELSE price_change_date END,
         is_active = CASE
           WHEN p_check_result IN ('off_market','sold') THEN false
           WHEN p_check_result = 'still_available' THEN true
           WHEN p_check_result = 'inferred_active' THEN is_active
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
