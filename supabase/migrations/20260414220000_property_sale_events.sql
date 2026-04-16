-- ============================================================================
-- Migration: property_sale_events — canonical sale record
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- This migration creates the canonical sale-event table read by the Sales
-- tab, Ownership History, and Intel → Prior Sale summary. An AFTER INSERT
-- trigger flips concurrent/active listings on the same property to
-- status='Sold' with sold_date and sold_price populated from the event.
-- The seed backfills events from sales_transactions and ownership_history.
--
-- Column-name alignment with the dialysis schema:
--   sales_transactions uses sold_price (no sale_price) and data_source
--     (no source); cap rate is chosen in the COALESCE(cap_rate,
--     calculated_cap_rate, stated_cap_rate) order that mirrors
--     normalizeSalesTxnRow().
--   ownership_history uses start_date (no transfer_date) and sold_price
--     (no sale_price); it has no name columns, so buyer/seller_name stay
--     NULL and can be enriched later via owner joins if needed.
--
-- cap_rate is NUMERIC (unconstrained precision) because some legacy rows
-- store cap rates as full percentages (e.g. 5.85) rather than as decimals.
-- ============================================================================

BEGIN;

-- Step 0: ensure available_listings has sold_date / sold_price columns.
ALTER TABLE public.available_listings
    ADD COLUMN IF NOT EXISTS sold_date  DATE,
    ADD COLUMN IF NOT EXISTS sold_price NUMERIC(14,2);

COMMENT ON COLUMN public.available_listings.sold_date IS
    'Sale close date. Populated by the property_sale_events trigger.';
COMMENT ON COLUMN public.available_listings.sold_price IS
    'Sale close price. Populated by the property_sale_events trigger.';

-- Step 1: canonical property_sale_events table.
CREATE TABLE IF NOT EXISTS public.property_sale_events (
    sale_event_id         BIGSERIAL   PRIMARY KEY,
    property_id           TEXT        NOT NULL,
    sale_date             DATE,
    price                 NUMERIC(14,2),
    cap_rate              NUMERIC,
    buyer_id              UUID,
    seller_id             UUID,
    broker_id             UUID,
    buyer_name            TEXT,
    seller_name           TEXT,
    broker_name           TEXT,
    source                TEXT,
    notes                 TEXT,
    sales_transaction_id  BIGINT,
    ownership_history_id  BIGINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.property_sale_events IS
    'Canonical, single-source-of-truth record of closed sales. Written to by Ownership History, Intel → Prior Sale, and the Sales tab; read by all three.';

CREATE INDEX IF NOT EXISTS idx_pse_property_id
    ON public.property_sale_events (property_id);
CREATE INDEX IF NOT EXISTS idx_pse_sale_date
    ON public.property_sale_events (sale_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pse_property_sale
    ON public.property_sale_events (property_id, sale_date DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pse_property_date_price
    ON public.property_sale_events (property_id, sale_date, price)
    WHERE sale_date IS NOT NULL AND price IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_pse_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pse_touch_updated_at ON public.property_sale_events;
CREATE TRIGGER trg_pse_touch_updated_at
    BEFORE UPDATE ON public.property_sale_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_pse_touch_updated_at();

-- Step 2: mark concurrent/active listings Sold on INSERT.
CREATE OR REPLACE FUNCTION public.fn_sale_event_mark_listings_sold()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.available_listings l
    SET status          = 'Sold',
        is_active       = FALSE,
        sold_date       = COALESCE(l.sold_date, NEW.sale_date),
        sold_price      = COALESCE(l.sold_price, NEW.price),
        off_market_date = COALESCE(l.off_market_date, NEW.sale_date)
    WHERE l.property_id::TEXT = NEW.property_id
      AND (
          (NEW.sale_date IS NULL AND COALESCE(l.is_active, TRUE) = TRUE)
          OR
          (NEW.sale_date IS NOT NULL
            AND (l.listing_date IS NULL OR l.listing_date <= NEW.sale_date)
            AND (
                l.off_market_date IS NULL
                OR (l.off_market_date BETWEEN (NEW.sale_date - INTERVAL '90 days')
                                          AND (NEW.sale_date + INTERVAL '90 days'))
            )
          )
      )
      AND (
          LOWER(COALESCE(l.status, '')) <> 'sold'
          OR l.sold_price IS DISTINCT FROM NEW.price
          OR l.sold_date  IS DISTINCT FROM NEW.sale_date
      );
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_event_mark_listings_sold ON public.property_sale_events;
CREATE TRIGGER trg_sale_event_mark_listings_sold
    AFTER INSERT ON public.property_sale_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_sale_event_mark_listings_sold();

-- Step 3: Backfill from sales_transactions.
INSERT INTO public.property_sale_events
    (property_id, sale_date, price, cap_rate,
     buyer_name, seller_name, broker_name,
     source, notes, sales_transaction_id)
SELECT
    st.property_id::TEXT,
    st.sale_date,
    st.sold_price,
    COALESCE(st.cap_rate, st.calculated_cap_rate, st.stated_cap_rate),
    st.buyer_name,
    st.seller_name,
    st.listing_broker,
    COALESCE(NULLIF(st.data_source, ''), 'sales_transactions'),
    st.notes,
    st.sale_id
FROM public.sales_transactions st
WHERE st.property_id IS NOT NULL
  AND (st.sale_date IS NOT NULL OR st.sold_price IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Step 4: Backfill from ownership_history (only rows with a sold_price).
INSERT INTO public.property_sale_events
    (property_id, sale_date, price, cap_rate,
     buyer_name, seller_name, source, ownership_history_id)
SELECT
    oh.property_id::TEXT,
    oh.start_date,
    oh.sold_price,
    oh.cap_rate,
    NULL,
    NULL,
    COALESCE(NULLIF(oh.ownership_source, ''), 'ownership_history'),
    oh.ownership_id
FROM public.ownership_history oh
WHERE oh.property_id IS NOT NULL
  AND oh.sold_price IS NOT NULL
  AND oh.start_date IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.property_sale_events pse
      WHERE pse.property_id = oh.property_id::TEXT
        AND pse.sale_date IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (pse.sale_date::timestamp - oh.start_date::timestamp)) / 86400) <= 30
        AND (pse.price IS NULL
             OR ABS(pse.price - oh.sold_price) / NULLIF(oh.sold_price, 0) <= 0.05)
  )
ON CONFLICT DO NOTHING;

-- Step 5: Reconcile still-active listings on properties that now have
-- a recorded sale.
UPDATE public.available_listings l
SET status          = 'Sold',
    is_active       = FALSE,
    sold_date       = COALESCE(l.sold_date, pse.sale_date),
    sold_price      = COALESCE(l.sold_price, pse.price),
    off_market_date = COALESCE(l.off_market_date, pse.sale_date)
FROM (
    SELECT DISTINCT ON (property_id)
           property_id, sale_date, price
    FROM public.property_sale_events
    WHERE sale_date IS NOT NULL
    ORDER BY property_id, sale_date DESC NULLS LAST
) pse
WHERE l.property_id::TEXT = pse.property_id
  AND COALESCE(l.is_active, TRUE) = TRUE
  AND LOWER(COALESCE(l.status, '')) <> 'sold'
  AND (l.listing_date IS NULL OR l.listing_date <= pse.sale_date);

-- Step 6: latest-sale convenience view for Intel → Prior Sale summary.
CREATE OR REPLACE VIEW public.v_property_latest_sale AS
SELECT DISTINCT ON (property_id)
    property_id,
    sale_event_id,
    sale_date,
    price,
    cap_rate,
    buyer_name,
    seller_name,
    broker_name,
    source,
    notes,
    created_at,
    updated_at
FROM public.property_sale_events
ORDER BY property_id, sale_date DESC NULLS LAST, sale_event_id DESC;

COMMENT ON VIEW public.v_property_latest_sale IS
    'Most recent sale_event per property — used by Intel → Prior Sale read-only summary.';

-- Step 7: RLS and anon read grants so the PostgREST edge proxy can serve
-- the table + view to the LCC frontend.
ALTER TABLE public.property_sale_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read property_sale_events" ON public.property_sale_events;
CREATE POLICY "Allow anon read property_sale_events" ON public.property_sale_events
    FOR SELECT TO anon USING (true);

GRANT SELECT ON public.property_sale_events TO anon;
GRANT SELECT ON public.v_property_latest_sale TO anon;

COMMIT;
