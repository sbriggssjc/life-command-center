-- ============================================================================
-- GATED — APPLY ONLY AFTER gov_backfill.sql is COMMITted and re-audited.
-- Target: gov (scknotsqkcheojiaewwh) public.available_listings
-- Gives gov the recurrence guards dia already has, adapted to gov columns
-- (listing_status text; sale_transaction_id uuid; NO notes column;
--  sales link via sales_transactions.sale_id (uuid) — NOT property_sale_events,
--  whose sales_transaction_id is bigint and cannot populate the uuid FK).
-- The two functions/triggers run in a normal txn. The UNIQUE INDEX must be
-- created CONCURRENTLY OUTSIDE a transaction (see bottom).
-- ============================================================================
BEGIN;

-- (1) Close-on-sale trigger — mirrors dia fn_listing_close_if_sold, gov-shaped.
--     Gate Decision 3 sub-option: this DOES close listings that post-date a sale
--     within the window (dia's accepted behavior). To spare post-sale re-lists,
--     uncomment the `AND st.sale_date >= NEW.listing_date` guard below.
CREATE OR REPLACE FUNCTION public.fn_gov_listing_close_if_sold()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_sale_date date; v_sale_price numeric; v_sale_id uuid;
BEGIN
  IF COALESCE(NEW.is_active, TRUE) IS NOT TRUE
     AND lower(COALESCE(NEW.listing_status,'')) IN ('sold','closed','superseded','withdrawn','expired') THEN
    RETURN NEW;
  END IF;
  SELECT st.sale_date, st.sold_price, st.sale_id
    INTO v_sale_date, v_sale_price, v_sale_id
    FROM public.sales_transactions st
   WHERE st.property_id = NEW.property_id
     AND st.sale_date IS NOT NULL AND st.sale_date <= CURRENT_DATE
     AND COALESCE(st.exclude_from_market_metrics,false)=false
     AND (NEW.listing_date IS NULL OR st.sale_date >= NEW.listing_date - INTERVAL '90 days')
     -- AND (NEW.listing_date IS NULL OR st.sale_date >= NEW.listing_date)  -- spare post-sale re-lists (Decision 3)
     AND st.sale_date >= CURRENT_DATE - INTERVAL '12 months'
   ORDER BY st.sale_date DESC, st.sale_id DESC LIMIT 1;
  IF v_sale_date IS NOT NULL THEN
    -- gov is_active is GENERATED from listing_status — set status only.
    NEW.listing_status      := 'sold';
    NEW.off_market_date     := COALESCE(NEW.off_market_date, v_sale_date);
    NEW.off_market_reason   := COALESCE(NEW.off_market_reason, 'sold');
    NEW.sale_transaction_id := COALESCE(NEW.sale_transaction_id, v_sale_id);
    NEW.updated_at          := now();
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_gov_listing_close_if_sold ON public.available_listings;
CREATE TRIGGER trg_gov_listing_close_if_sold
  BEFORE INSERT OR UPDATE OF listing_date, is_active, listing_status, property_id
  ON public.available_listings FOR EACH ROW EXECUTE FUNCTION public.fn_gov_listing_close_if_sold();

-- (2) Supersede-prior-active trigger (Gate Decision 5 = DB-authoritative guard).
--     When a row becomes active for a property, retire any OTHER active row so the
--     one-active invariant holds regardless of writer correctness. Guarded against
--     recursion (only acts on OTHER rows; the supersede UPDATE sets is_active=false
--     so it cannot re-enter this branch).
CREATE OR REPLACE FUNCTION public.fn_gov_supersede_prior_active()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_active IS TRUE AND NEW.property_id IS NOT NULL
     AND COALESCE(NEW.exclude_from_market_metrics,false)=false THEN
    UPDATE public.available_listings o
       SET listing_status='superseded',   -- is_active follows (generated)
           off_market_date=COALESCE(o.off_market_date, COALESCE(NEW.listing_date, CURRENT_DATE)),
           off_market_reason=COALESCE(o.off_market_reason,'superseded'),
           updated_at=now()
     WHERE o.property_id = NEW.property_id
       AND o.listing_id IS DISTINCT FROM NEW.listing_id
       AND o.is_active IS TRUE
       AND COALESCE(o.exclude_from_market_metrics,false)=false;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_gov_supersede_prior_active ON public.available_listings;
CREATE TRIGGER trg_gov_supersede_prior_active
  AFTER INSERT OR UPDATE OF is_active, property_id
  ON public.available_listings FOR EACH ROW
  WHEN (NEW.is_active IS TRUE)
  EXECUTE FUNCTION public.fn_gov_supersede_prior_active();

-- (3) Forward/sane off_market_date (no future stamps; +1d clock-skew grace)
ALTER TABLE public.available_listings
  DROP CONSTRAINT IF EXISTS al_off_market_not_future;
ALTER TABLE public.available_listings
  ADD CONSTRAINT al_off_market_not_future
  CHECK (off_market_date IS NULL OR off_market_date <= CURRENT_DATE + 1) NOT VALID;
-- VALIDATE after confirming gov_backfill cleared the existing violators:
-- ALTER TABLE public.available_listings VALIDATE CONSTRAINT al_off_market_not_future;

-- (3b) G3 PHANTOM GUARD — stop the availability-checker over-stamp at the
--      choke point. lcc_record_listing_check stamps off_market_date on a row
--      that may have NULL listing_date (the Round 76ej availability-checker's
--      'unverified_assumed_off' path), producing a backward/zero on-market
--      window. Backfill listing_date from first_seen_at IN THE SAME UPDATE so
--      the window has a forward start. Same family as the property-first
--      writer fix: never let a state stamp imply a window that never existed.
--      Verbatim copy of the live function + the one new listing_date line.
CREATE OR REPLACE FUNCTION public.lcc_record_listing_check(
  p_listing_id uuid, p_method text, p_check_result text,
  p_asking_price numeric DEFAULT NULL, p_cap_rate numeric DEFAULT NULL,
  p_source_url text DEFAULT NULL, p_http_status integer DEFAULT NULL,
  p_response_summary text DEFAULT NULL, p_off_market_reason text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL, p_verified_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL)
RETURNS TABLE(verification_id bigint, status_history_id bigint, state_transitioned boolean, new_status text)
LANGUAGE plpgsql AS $function$
DECLARE
  v_prior_price numeric; v_prior_status text; v_new_status text;
  v_state_transition boolean := false; v_verif_id bigint; v_status_id bigint;
  v_eff_date date := LEAST(COALESCE(p_effective_at::date, CURRENT_DATE), CURRENT_DATE); -- R74e: no future stamps
BEGIN
  SELECT asking_price, listing_status INTO v_prior_price, v_prior_status
    FROM public.available_listings WHERE listing_id = p_listing_id;
  v_new_status := CASE p_check_result
    WHEN 'still_available' THEN CASE WHEN COALESCE(v_prior_status,'active') <> 'active' THEN 're_listed' ELSE NULL END
    WHEN 'price_changed'   THEN 'price_changed'
    WHEN 'off_market'      THEN 'withdrawn'
    WHEN 'sold'            THEN 'sold'
    ELSE NULL END;
  INSERT INTO public.listing_verification_history (
    listing_id, verified_at, method, check_result,
    asking_price_at_check, prior_asking_price, price_delta,
    source_url, http_status, response_summary, notes, verified_by
  ) VALUES (
    p_listing_id, COALESCE(p_effective_at, now()), p_method, p_check_result,
    p_asking_price, v_prior_price,
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
         asking_price = CASE WHEN p_check_result = 'price_changed' AND p_asking_price IS NOT NULL THEN p_asking_price ELSE asking_price END,
         asking_cap_rate = CASE WHEN p_cap_rate IS NOT NULL THEN p_cap_rate ELSE asking_cap_rate END,
         last_price_change = CASE WHEN p_check_result = 'price_changed' THEN v_eff_date ELSE last_price_change END,
         listing_status = CASE
           WHEN p_check_result = 'off_market' THEN 'withdrawn'
           WHEN p_check_result = 'sold'       THEN 'sold'
           WHEN p_check_result = 'still_available' AND COALESCE(listing_status,'active') <> 'active' THEN 'active'
           ELSE listing_status END,
         -- G3 GUARD: give an off_market/sold stamp a forward window start.
         listing_date = CASE WHEN p_check_result IN ('off_market','sold') AND listing_date IS NULL
                             THEN LEAST(first_seen_at::date, v_eff_date) ELSE listing_date END,
         off_market_date = CASE WHEN p_check_result IN ('off_market','sold') AND off_market_date IS NULL THEN v_eff_date ELSE off_market_date END,
         off_market_reason = CASE
           WHEN p_check_result = 'off_market' THEN COALESCE(p_off_market_reason, 'withdrawn')
           WHEN p_check_result = 'sold' THEN 'sold'
           ELSE off_market_reason END
   WHERE listing_id = p_listing_id;
  RETURN QUERY SELECT v_verif_id, v_status_id, v_state_transition, v_new_status;
END $function$;

COMMIT;

-- (4) Hard backstop — one active row per property (mirrors dia). MUST run
--     OUTSIDE a transaction and ONLY after gov_backfill collapsed the dups,
--     else the build fails on the existing 116 violators.
-- CREATE UNIQUE INDEX CONCURRENTLY available_listings_one_active_per_property
--   ON public.available_listings (property_id)
--   WHERE is_active IS TRUE AND property_id IS NOT NULL
--     AND COALESCE(exclude_from_market_metrics,false)=false;
