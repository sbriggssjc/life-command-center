-- ============================================================================
-- Migration: available_listings FK to sales_transactions
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL) — zqzrriwuavgrquhisnoa
-- Life Command Center
--
-- Problem:
--   available_listings has no direct relationship to sales_transactions.
--   The only link is via property_id, so when a listing closes (sold_date is
--   populated) we cannot know which specific sales_transactions row the
--   listing corresponds to, nor audit the closing price without joining
--   on property_id + sold_date guesses.
--
-- This migration:
--   1. Adds `sale_transaction_id INTEGER REFERENCES sales_transactions(sale_id)
--      ON DELETE SET NULL` on available_listings.
--   2. Adds `sold_price NUMERIC(15,2)` on available_listings so the close price
--      is stored on the listing row itself (no JOIN required to surface it).
--   3. Backfills both columns for every listing whose sold_date IS NOT NULL by
--      picking the sales_transactions row on the same property_id whose
--      sale_date is closest to the listing's sold_date.
--
-- The sidebar pipeline's listing-auto-close path (closeActiveListingsOnSale
-- and the upsertDialysisListings auto-close) is updated in the same PR to
-- populate these columns on every new close going forward.
-- ============================================================================

ALTER TABLE available_listings
  ADD COLUMN IF NOT EXISTS sale_transaction_id INTEGER
    REFERENCES sales_transactions(sale_id) ON DELETE SET NULL;

ALTER TABLE available_listings
  ADD COLUMN IF NOT EXISTS sold_price NUMERIC(15, 2);

CREATE INDEX IF NOT EXISTS available_listings_sale_transaction_id_idx
  ON available_listings (sale_transaction_id)
  WHERE sale_transaction_id IS NOT NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- For each closed listing (sold_date IS NOT NULL) on a given property, pick
-- the sales_transactions row for the same property whose sale_date is
-- closest to the listing's sold_date. DISTINCT ON collapses to one sale per
-- property — acceptable here because the production dataset generally has
-- one "current" sale per property; historical deed rows exist but the
-- closest-by-date match selects the operational transaction.
WITH closest_sale AS (
  SELECT DISTINCT ON (al.listing_id)
    al.listing_id,
    st.sale_id,
    st.sold_price
  FROM available_listings al
  JOIN sales_transactions st
    ON st.property_id = al.property_id
   AND st.sale_date IS NOT NULL
  WHERE al.sold_date IS NOT NULL
  ORDER BY al.listing_id, ABS(st.sale_date - al.sold_date)
)
UPDATE available_listings al
   SET sale_transaction_id = cs.sale_id,
       sold_price          = COALESCE(al.sold_price, cs.sold_price)
  FROM closest_sale cs
 WHERE al.listing_id = cs.listing_id
   AND al.sold_date IS NOT NULL
   AND (al.sale_transaction_id IS NULL OR al.sold_price IS NULL);

DO $$
DECLARE
  closed_count INTEGER;
  linked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO closed_count
    FROM available_listings
   WHERE sold_date IS NOT NULL;
  SELECT COUNT(*) INTO linked_count
    FROM available_listings
   WHERE sold_date IS NOT NULL AND sale_transaction_id IS NOT NULL;
  RAISE NOTICE '[listing-fk-backfill] closed_listings=% linked=%',
    closed_count, linked_count;
END $$;
