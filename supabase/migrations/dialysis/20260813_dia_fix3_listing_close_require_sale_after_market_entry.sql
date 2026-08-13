-- Fix #3 (root cause, DB layer): narrow fn_listing_close_if_sold's sale-match window
-- so it can only attribute a sale that occurred ON OR AFTER the listing's market-entry
-- date (v_ref = COALESCE(on_market_date, listing_date)). Previously it matched any
-- same-property sale back to v_ref - 90 days, so a PRIOR owner's sale (predating the
-- listing) got mis-attributed as this listing's close, forcing status='Sold' with a
-- wrong exit date. DB twin of the api/admin.js handleAutoScrapeListings fix (same commit).
-- Behavior otherwise identical (off_market_date still derives from the matched sale date
-- via COALESCE). Idempotent CREATE OR REPLACE; reverse by restoring the '- 90 days' bound.
-- Applied live to dia (zqzrriwuavgrquhisnoa).
CREATE OR REPLACE FUNCTION public.fn_listing_close_if_sold()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_sale_date  DATE;
    v_sale_price NUMERIC;
    v_sale_txn   BIGINT;
    v_ref        DATE := COALESCE(NEW.on_market_date, NEW.listing_date);
    v_hi         DATE;
BEGIN
    IF COALESCE(NEW.is_active, TRUE) IS NOT TRUE
       AND LOWER(COALESCE(NEW.status, '')) IN ('sold','closed','closed but obligated','superseded','stale','withdrawn','expired','orphan')
    THEN
        RETURN NEW;
    END IF;

    IF v_ref IS NULL THEN
        RETURN NEW;
    END IF;

    v_hi := LEAST(CURRENT_DATE, (v_ref + INTERVAL '1356 days' + INTERVAL '180 days')::date);

    SELECT pse.sale_date, pse.price, pse.sales_transaction_id
      INTO v_sale_date, v_sale_price, v_sale_txn
      FROM public.property_sale_events pse
     WHERE pse.property_id = NEW.property_id
       AND pse.sale_date IS NOT NULL
       AND pse.sale_date >= v_ref          -- was: v_ref - INTERVAL '90 days' (allowed pre-listing sales)
       AND pse.sale_date <= v_hi
     ORDER BY pse.sale_date DESC, pse.sale_event_id DESC
     LIMIT 1;

    IF v_sale_date IS NULL THEN
        SELECT st.sale_date, st.sold_price, st.sale_id
          INTO v_sale_date, v_sale_price, v_sale_txn
          FROM public.sales_transactions st
         WHERE st.property_id = NEW.property_id
           AND st.sale_date IS NOT NULL
           AND COALESCE(st.exclude_from_market_metrics, FALSE) = FALSE
           AND st.sale_date >= v_ref        -- was: v_ref - INTERVAL '90 days'
           AND st.sale_date <= v_hi
         ORDER BY st.sale_date DESC, st.sale_id DESC
         LIMIT 1;
    END IF;

    IF v_sale_txn IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = v_sale_txn) THEN
        v_sale_txn := NULL;
    END IF;

    IF v_sale_date IS NOT NULL THEN
        NEW.status              := 'Sold';
        NEW.is_active           := FALSE;
        NEW.sold_date           := COALESCE(NEW.sold_date,       v_sale_date);
        NEW.sold_price          := COALESCE(NEW.sold_price,      v_sale_price);
        NEW.off_market_date     := COALESCE(NEW.off_market_date, v_sale_date);
        NEW.off_market_reason   := COALESCE(NEW.off_market_reason, 'sold');
        NEW.sale_transaction_id := COALESCE(NEW.sale_transaction_id, v_sale_txn::integer);
        NEW.notes               := COALESCE(NULLIF(NEW.notes, '') || E'\n', '') ||
                                   '[fn_listing_close_if_sold ' || CURRENT_DATE ||
                                   '] auto-closed: matched sale on ' || v_sale_date;
    END IF;
    RETURN NEW;
END $function$;
