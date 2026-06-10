-- =============================================================================
-- R74e Task 6c Phase A — STOP the over-stamp writer (dia, Dialysis_DB
-- zqzrriwuavgrquhisnoa).
--
-- Root cause of the "~222 NULL listing_date + FUTURE off_market_date" wall that
-- inflated the #9 active count: public.lcc_record_listing_check stamps
--   off_market_date = COALESCE(p_effective_at::date, CURRENT_DATE)
-- with NO upper bound. Any caller that passes a FUTURE p_effective_at (e.g. a
-- verification-cadence/next-due timestamp mistakenly forwarded as the effective
-- date) lands a FUTURE off_market_date. For an undated row the turnover view then
-- synthesizes eff_start = off_market - 196d (a fake-recent start) which sails
-- through every active-count gate. The #9 fix (20260716) excluded those rows from
-- active_count; THIS fix stops them being produced at the source so the backfill
-- (Phase B) can't re-accumulate.
--
-- FIX (caller-agnostic, minimal): clamp the off-market and price-change stamps to
-- CURRENT_DATE via LEAST(...). off_market_date can never be set in the future from
-- this function regardless of which cron/edge/handler calls it. All other behavior
-- is byte-identical to the live function (captured 2026-06-10).
--
-- Idempotent: CREATE OR REPLACE, same signature -> existing GRANTs / callers
-- unchanged. Safe to apply DB-first (no deployed caller depends on future stamps).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id integer,
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
  v_prior_price numeric; v_new_status text; v_state_transition boolean := false;
  v_verif_id bigint; v_status_id bigint; v_listing_active boolean;
  -- R74e: never let an off-market / price-change stamp land in the future.
  v_eff_date date := LEAST(COALESCE(p_effective_at::date, CURRENT_DATE), CURRENT_DATE);
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
    ELSE NULL END;
  INSERT INTO public.listing_verification_history (
    listing_id, verified_at, method, check_result, asking_price_at_check, prior_asking_price,
    price_delta, source_url, http_status, response_summary, notes, verified_by
  ) VALUES (
    p_listing_id, COALESCE(p_effective_at, now()), p_method, p_check_result, p_asking_price, v_prior_price,
    CASE WHEN p_asking_price IS NOT NULL AND v_prior_price IS NOT NULL THEN p_asking_price - v_prior_price ELSE NULL END,
    p_source_url, p_http_status, p_response_summary, p_notes, p_verified_by
  ) RETURNING id INTO v_verif_id;
  IF v_new_status IS NOT NULL THEN
    INSERT INTO public.listing_status_history (
      listing_id, status, effective_at, asking_price, cap_rate, source, notes, recorded_by
    ) VALUES (
      p_listing_id, v_new_status, COALESCE(p_effective_at, now()), p_asking_price, p_cap_rate, p_method, p_notes, p_verified_by
    ) RETURNING id INTO v_status_id;
    v_state_transition := true;
  END IF;
  UPDATE public.available_listings
     SET last_verified_at = COALESCE(p_effective_at, now()),
         consecutive_check_failures = CASE WHEN p_check_result = 'unreachable' THEN consecutive_check_failures + 1 ELSE 0 END,
         last_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL THEN p_asking_price ELSE last_price END,
         current_cap_rate = CASE WHEN p_cap_rate IS NOT NULL THEN p_cap_rate ELSE current_cap_rate END,
         price_change_date = CASE WHEN p_check_result = 'price_changed' THEN v_eff_date ELSE price_change_date END,
         is_active = CASE WHEN p_check_result IN ('off_market','sold') THEN false WHEN p_check_result = 'still_available' THEN true ELSE is_active END,
         status = CASE
           WHEN p_check_result = 'sold' THEN 'Sold'
           WHEN p_check_result = 'off_market' THEN 'Off Market'
           WHEN p_check_result = 'still_available' AND is_active = false THEN 'Active'
           ELSE status END,
         off_market_date = CASE WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL THEN v_eff_date ELSE off_market_date END,
         off_market_reason = CASE WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn') WHEN p_check_result = 'sold' THEN 'sold' ELSE off_market_reason END
   WHERE listing_id = p_listing_id;
  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $function$;
