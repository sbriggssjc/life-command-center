-- ============================================================================
-- Migration: property_sale_events — canonical sale record
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL)
-- Life Command Center — Sales tab display fix
--
-- Problem symptoms:
--   - Sales tab on a property detail panel shows "2 LISTINGS · 0 SALES"
--     even though the property closed at $5,413,000 / 5.85% cap.
--   - The sale IS visible on the Ownership History tab because it was
--     entered there as a chain row, but it never got written to
--     sales_transactions (the source the Sales tab queries).
--   - Active listings remain flagged ACTIVE long after the sale closed.
--
-- This migration:
--   1. Creates `property_sale_events` as the single source of truth for
--      closed sales. Ownership History, Intel → Prior Sale summary, and
--      the Sales tab all read from this table going forward.
--   2. Adds an AFTER INSERT trigger that sets any concurrent / still-active
--      listing on the same property to status='Sold' with sold_date and
--      sold_price populated from the sale event.
--   3. Backfills property_sale_events from existing sales_transactions and
--      from ownership_history rows that have a sale_price but no matching
--      sale_event (the case that exposed the bug).
--   4. Ensures available_listings has sold_date and sold_price columns
--      (added only if missing so reruns are safe).
--
-- Safe to re-run. All DDL is IF NOT EXISTS / IF EXISTS guarded.
-- ============================================================================

BEGIN;

-- ── Step 0: ensure available_listings has sold_date / sold_price ────────────
ALTER TABLE public.available_listings
    ADD COLUMN IF NOT EXISTS sold_date  DATE,
    ADD COLUMN IF NOT EXISTS sold_price NUMERIC(14,2);

COMMENT ON COLUMN public.available_listings.sold_date IS
    'Sale close date. Populated by the property_sale_events trigger.';
COMMENT ON COLUMN public.available_listings.sold_price IS
    'Sale close price. Populated by the property_sale_events trigger.';

-- ── Step 1: canonical property_sale_events table ────────────────────────────
--
-- property_id is TEXT for cross-DB compatibility (the upstream column may be
-- BIGINT in dialysis, UUID in canonical_entities, TEXT elsewhere). The frontend
-- always passes it through encodeURIComponent, so TEXT is the safe lowest
-- common denominator — matches property_cms_link.

CREATE TABLE IF NOT EXISTS public.property_sale_events (
    sale_event_id         BIGSERIAL   PRIMARY KEY,
    property_id           TEXT        NOT NULL,
    sale_date             DATE,
    price                 NUMERIC(14,2),
    cap_rate              NUMERIC(6,4),
    -- Canonical linked contacts (future: FK to contacts hub)
    buyer_id              UUID,
    seller_id             UUID,
    broker_id             UUID,
    -- Display names for when contact hub resolution has not happened yet
    buyer_name            TEXT,
    seller_name           TEXT,
    broker_name           TEXT,
    -- Provenance
    source                TEXT,
    notes                 TEXT,
    -- Back-links to the row(s) this event was derived from
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

-- Dedup: one canonical event per (property, date, price). Allows NULL date
-- fallback to manage un-dated comps without blocking them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pse_property_date_price
    ON public.property_sale_events (property_id, sale_date, price)
    WHERE sale_date IS NOT NULL AND price IS NOT NULL;

-- updated_at maintenance
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

-- ── Step 2: trigger — mark concurrent/active listings as Sold ───────────────
--
-- A listing is considered "concurrent with" the sale event if:
--   (a) the sale has no date and the listing is still active, OR
--   (b) the listing opened on or before the sale_date AND either it has no
--       off_market_date yet (still live) or its off_market_date is within
--       ±90 days of the sale_date (the listing closed around the same time).
--
-- This prevents historical 2015 sales from accidentally marking today's
-- active listings as Sold during backfill.

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
          -- Case A: sale has no date; touch only live listings
          (NEW.sale_date IS NULL AND COALESCE(l.is_active, TRUE) = TRUE)
          OR
          -- Case B: temporally concurrent listing
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
          -- Only touch listings that aren't already marked Sold with matching data
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

-- ── Step 3: Backfill from sales_transactions ────────────────────────────────
--
-- Every existing row in sales_transactions becomes a property_sale_event.
-- ON CONFLICT (uq_pse_property_date_price) DO NOTHING — idempotent.

INSERT INTO public.property_sale_events
    (property_id, sale_date, price, cap_rate,
     buyer_name, seller_name, broker_name,
     source, notes, sales_transaction_id)
SELECT
    st.property_id::TEXT,
    st.sale_date,
    COALESCE(st.sold_price, st.sale_price),
    st.cap_rate,
    st.buyer_name,
    st.seller_name,
    st.listing_broker,
    COALESCE(NULLIF(st.source, ''), 'sales_transactions'),
    st.notes,
    st.sale_id
FROM public.sales_transactions st
WHERE st.property_id IS NOT NULL
  AND (st.sale_date IS NOT NULL
       OR COALESCE(st.sold_price, st.sale_price) IS NOT NULL)
ON CONFLICT DO NOTHING;

-- ── Step 4: Backfill from ownership_history ─────────────────────────────────
--
-- For every ownership_history row with a sale_price, create a sale_event if
-- no matching event already exists within 30 days and 5% price of the
-- ownership transfer. Uses recorded_owner_name as buyer (new owner).
--
-- This is the fix for the specific bug: the $5,413,000 / 5.85% cap sale that
-- only lived in ownership_history will now appear in the Sales tab.

INSERT INTO public.property_sale_events
    (property_id, sale_date, price, cap_rate,
     buyer_name, seller_name, source)
SELECT
    oh.property_id::TEXT,
    oh.transfer_date,
    oh.sale_price,
    oh.cap_rate,
    COALESCE(oh.recorded_owner_name, oh.true_owner_name),
    NULL,
    COALESCE(NULLIF(oh.ownership_source, ''), 'ownership_history')
FROM public.ownership_history oh
WHERE oh.property_id IS NOT NULL
  AND oh.sale_price IS NOT NULL
  AND oh.transfer_date IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.property_sale_events pse
      WHERE pse.property_id = oh.property_id::TEXT
        AND pse.sale_date IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (pse.sale_date::timestamp - oh.transfer_date::timestamp)) / 86400) <= 30
        AND (pse.price IS NULL
             OR ABS(pse.price - oh.sale_price) / NULLIF(oh.sale_price, 0) <= 0.05)
  )
ON CONFLICT DO NOTHING;

-- ── Step 5: One-shot reconcile — active listings on sold properties ─────────
--
-- The trigger fires during backfill INSERTs, but only on each sale_event's
-- own concurrency window. Run one more pass to catch any listings that were
-- still active on properties that now have *any* recorded sale event more
-- recent than the listing_date. This guarantees the "2 LISTINGS · 0 SALES"
-- bug is resolved after the migration without needing a full re-ingest.

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

-- ── Step 6: Convenience view for the frontend ───────────────────────────────
--
-- Exposes the latest canonical sale per property in the exact shape the
-- Sales tab + Intel → Prior Sale summary need. The Sales tab queries
-- property_sale_events directly for the full timeline; this view is for the
-- one-shot "most recent sale" summary on Intel.

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

COMMIT;
