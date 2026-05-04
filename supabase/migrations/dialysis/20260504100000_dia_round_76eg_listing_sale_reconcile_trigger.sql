-- ============================================================================
-- Round 76eg — Inverse trigger: auto-mark new listings Sold when a sale
--              already exists for the property.
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Context (2026-05-04): the existing trigger
-- public.fn_sale_event_mark_listings_sold (migration 20260414220000) only
-- fires when a property_sale_events row is INSERTed. It closes any
-- concurrent active listings at that moment, but does nothing for listings
-- that arrive AFTER the sale event has been recorded.
--
-- Real-world example that prompted this migration: Fresenius Medical Care
-- New Iberia, LA (property 17069 Edgewater Ln). Sale recorded Feb 25 2026.
-- Then three more available_listings rows were inserted (Apr 20, Apr 21,
-- May 1) — all by independent ingestion paths (CoStar sidebar verify
-- auto-create, OM-intake-promoter, manual). The May 1 row stayed Active
-- because no trigger ever closed it.
--
-- This migration adds the inverse trigger:
--   BEFORE INSERT OR UPDATE OF (listing_date, is_active, status) on
--   available_listings — if the property has any property_sale_events row
--   (or a sales_transactions row) within the last 12 months whose
--   sale_date >= NEW.listing_date - 90 days, mark NEW Sold immediately.
--
-- The 90-day backstop matches fn_sale_event_mark_listings_sold so both
-- directions of the symmetry agree on what counts as "the same listing
-- as the recorded sale" vs. a genuine re-listing. Round 76da's lifecycle
-- backfill set listing_date to the scrape date on many rows, so a tighter
-- window would let those slip through.
--
-- The 12-month forward window keeps legitimate re-listings (sale closed,
-- property goes back on market 18+ months later) functioning normally.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_listing_close_if_sold()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_sale_date  DATE;
    v_sale_price NUMERIC;
    v_sale_txn   BIGINT;
BEGIN
    -- Skip rows already in a terminal state. 'Superseded' MUST be in this
    -- list — otherwise when dia_consolidate_property_listings() flips
    -- losers to Superseded, this trigger would flip them right back to
    -- Sold, colliding with the keeper's enriched (status, listing_date,
    -- sold_date) tuple.
    IF COALESCE(NEW.is_active, TRUE) IS NOT TRUE
       AND LOWER(COALESCE(NEW.status, '')) IN ('sold', 'closed', 'closed but obligated', 'superseded', 'stale', 'withdrawn', 'expired')
    THEN
        RETURN NEW;
    END IF;

    -- Find the most recent recorded sale for this property within the
    -- reconcile window. Prefer property_sale_events (canonical); fall
    -- back to sales_transactions for the FK link.
    SELECT pse.sale_date,
           pse.price,
           pse.sales_transaction_id
      INTO v_sale_date, v_sale_price, v_sale_txn
      FROM public.property_sale_events pse
     WHERE pse.property_id = NEW.property_id
       AND pse.sale_date IS NOT NULL
       AND pse.sale_date <= CURRENT_DATE
       AND (NEW.listing_date IS NULL
            OR pse.sale_date >= NEW.listing_date - INTERVAL '90 days')
       AND pse.sale_date >= CURRENT_DATE - INTERVAL '12 months'
     ORDER BY pse.sale_date DESC, pse.sale_event_id DESC
     LIMIT 1;

    -- Fallback: legacy sales_transactions if no property_sale_events row
    IF v_sale_date IS NULL THEN
        SELECT st.sale_date, st.sold_price, st.sale_id
          INTO v_sale_date, v_sale_price, v_sale_txn
          FROM public.sales_transactions st
         WHERE st.property_id = NEW.property_id
           AND st.sale_date IS NOT NULL
           AND st.sale_date <= CURRENT_DATE
           AND COALESCE(st.exclude_from_market_metrics, FALSE) = FALSE
           AND (NEW.listing_date IS NULL
                OR st.sale_date >= NEW.listing_date - INTERVAL '90 days')
           AND st.sale_date >= CURRENT_DATE - INTERVAL '12 months'
         ORDER BY st.sale_date DESC, st.sale_id DESC
         LIMIT 1;
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
END $$;

COMMENT ON FUNCTION public.fn_listing_close_if_sold() IS
    'Round 76eg: BEFORE INSERT/UPDATE on available_listings. If the property has a recorded sale within the reconcile window, marks the row Sold + links the sale_transaction. Inverse companion to fn_sale_event_mark_listings_sold (which only fires on sale-event INSERT).';

DROP TRIGGER IF EXISTS trg_listing_close_if_sold ON public.available_listings;
CREATE TRIGGER trg_listing_close_if_sold
    BEFORE INSERT OR UPDATE OF listing_date, is_active, status, property_id
    ON public.available_listings
    FOR EACH ROW EXECUTE FUNCTION public.fn_listing_close_if_sold();

-- ── One-time backfill: catch every existing row the trigger would now close
DO $$
DECLARE
    closed_count integer := 0;
BEGIN
    WITH candidates AS (
        SELECT al.listing_id,
               COALESCE(pse.sale_date, st.sale_date)        AS sale_date,
               COALESCE(pse.price,     st.sold_price)       AS sale_price,
               COALESCE(pse.sales_transaction_id, st.sale_id) AS sale_txn
          FROM public.available_listings al
          LEFT JOIN LATERAL (
              SELECT sale_date, price, sales_transaction_id, sale_event_id
                FROM public.property_sale_events p
               WHERE p.property_id = al.property_id
                 AND p.sale_date IS NOT NULL
                 AND p.sale_date <= CURRENT_DATE
                 AND (al.listing_date IS NULL
                      OR p.sale_date >= al.listing_date - INTERVAL '90 days')
                 AND p.sale_date >= CURRENT_DATE - INTERVAL '12 months'
               ORDER BY p.sale_date DESC, p.sale_event_id DESC
               LIMIT 1
          ) pse ON TRUE
          LEFT JOIN LATERAL (
              SELECT sale_date, sold_price, sale_id
                FROM public.sales_transactions s
               WHERE s.property_id = al.property_id
                 AND s.sale_date IS NOT NULL
                 AND s.sale_date <= CURRENT_DATE
                 AND COALESCE(s.exclude_from_market_metrics, FALSE) = FALSE
                 AND (al.listing_date IS NULL
                      OR s.sale_date >= al.listing_date - INTERVAL '90 days')
                 AND s.sale_date >= CURRENT_DATE - INTERVAL '12 months'
               ORDER BY s.sale_date DESC, s.sale_id DESC
               LIMIT 1
          ) st ON pse.sale_date IS NULL
         WHERE COALESCE(al.is_active, TRUE) IS TRUE
           AND LOWER(COALESCE(al.status, '')) NOT IN ('sold','closed','closed but obligated','superseded','stale','withdrawn','expired')
           AND COALESCE(pse.sale_date, st.sale_date) IS NOT NULL
    )
    UPDATE public.available_listings al
       SET status              = 'Sold',
           is_active           = FALSE,
           sold_date           = COALESCE(al.sold_date,       c.sale_date),
           sold_price          = COALESCE(al.sold_price,      c.sale_price),
           off_market_date     = COALESCE(al.off_market_date, c.sale_date),
           off_market_reason   = COALESCE(al.off_market_reason, 'sold'),
           sale_transaction_id = COALESCE(al.sale_transaction_id, c.sale_txn::integer),
           notes               = COALESCE(NULLIF(al.notes, '') || E'\n', '') ||
                                 '[Round 76eg backfill ' || CURRENT_DATE ||
                                 '] auto-closed: matched sale on ' || c.sale_date
      FROM candidates c
     WHERE al.listing_id = c.listing_id;

    GET DIAGNOSTICS closed_count = ROW_COUNT;
    RAISE NOTICE 'Round 76eg backfill: closed % active listings whose property had a recorded sale within the reconcile window', closed_count;
END $$;
