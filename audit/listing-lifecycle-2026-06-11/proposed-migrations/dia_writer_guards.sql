-- ============================================================================
-- GATED — APPLY ONLY AFTER dia_backfill.sql is COMMITted and re-audited.
-- Target: dia (zqzrriwuavgrquhisnoa) public.available_listings
-- dia ALREADY HAS the two main guards:
--   * available_listings_one_active_per_property  (partial unique index)
--   * trg_listing_close_if_sold                    (close-on-sale)
-- This file only adds the missing invariants: no future off_market stamp, and
-- active ⇄ off_market mutual exclusion (clear the stamp when a row goes active).
-- ============================================================================
BEGIN;

-- (1) No future off_market_date (+1d clock-skew grace). NOT VALID so it applies
--     to new writes immediately; VALIDATE after dia_backfill clears violators.
ALTER TABLE public.available_listings DROP CONSTRAINT IF EXISTS al_off_market_not_future;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_off_market_not_future
  CHECK (off_market_date IS NULL OR off_market_date <= CURRENT_DATE + 1) NOT VALID;
-- ALTER TABLE public.available_listings VALIDATE CONSTRAINT al_off_market_not_future;

-- (2) active ⇒ no off_market_date. Enforced in a BEFORE trigger (not a CHECK) to
--     avoid multi-column-update ordering hazards. Runs ahead of the existing
--     cap-rate/broker BEFORE triggers harmlessly (column-only mutation).
CREATE OR REPLACE FUNCTION public.fn_dia_listing_active_offmarket_excl()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_active IS TRUE AND NEW.off_market_date IS NOT NULL THEN
    NEW.off_market_date := NULL;
    NEW.off_market_reason := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_dia_active_offmarket_excl ON public.available_listings;
CREATE TRIGGER trg_dia_active_offmarket_excl
  BEFORE INSERT OR UPDATE OF is_active, off_market_date
  ON public.available_listings FOR EACH ROW
  EXECUTE FUNCTION public.fn_dia_listing_active_offmarket_excl();

-- (3) G3 PHANTOM GUARD — same as gov (3b), dia-shaped (last_price /
--     current_cap_rate / is_active / status; window start from created_at /
--     last_seen). Backfill listing_date when an off_market/sold stamp lands on
--     a NULL-listing_date row so the on-market window has a forward start.
--     Verbatim copy of the live dia function + the one new listing_date line.
CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id integer, p_method text, p_check_result text,
  p_asking_price numeric DEFAULT NULL, p_cap_rate numeric DEFAULT NULL,
  p_source_url text DEFAULT NULL, p_http_status integer DEFAULT NULL,
  p_response_summary text DEFAULT NULL, p_off_market_reason text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL, p_verified_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS TABLE(verification_id bigint, status_history_id bigint, state_transitioned boolean, new_status text)
LANGUAGE plpgsql AS $function$
DECLARE
  v_prior_price numeric; v_new_status text; v_state_transition boolean := false;
  v_verif_id bigint; v_status_id bigint; v_listing_active boolean;
  v_eff_date date := LEAST(COALESCE(p_effective_at::date, CURRENT_DATE), CURRENT_DATE); -- R74e: no future stamps
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
         -- G3 GUARD: give an off_market/sold stamp a forward window start.
         listing_date = CASE WHEN p_check_result IN ('off_market','sold') AND listing_date IS NULL
                             THEN LEAST(COALESCE(created_at::date, last_seen), v_eff_date) ELSE listing_date END,
         off_market_date = CASE WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL THEN v_eff_date ELSE off_market_date END,
         off_market_reason = CASE WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn') WHEN p_check_result = 'sold' THEN 'sold' ELSE off_market_reason END
   WHERE listing_id = p_listing_id;
  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $function$;

COMMIT;
