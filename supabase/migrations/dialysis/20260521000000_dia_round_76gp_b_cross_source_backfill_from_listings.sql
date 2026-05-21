-- Round 76gp.b (2026-05-21) — Cross-source backfill from available_listings
-- ============================================================================
-- One-shot data fix that copies broker / seller / price / cap data from
-- available_listings onto matching sales_transactions rows when the primary
-- column is NULL. Audit findings preceding this migration:
--
--   Before:                              After:                  Filled:
--     null_price            632            305                       327
--     null cap (all 3 cols) 2,410          1,169                   1,241
--     null listing_broker   3,064          2,095                     969
--     null seller_name      1,566            973                     593
--
-- Property-side backfills (year_renovated → year_built, lot_sf → land_area):
--     null year_built (sales props) 1,040 → 938  (102 filled)
--     null land_area (sales props)    808 →  808 (no candidates left after
--                                                 audit — only 1 had both
--                                                 null land_area + populated
--                                                 lot_sf and it was already
--                                                 backfilled)
--
-- Match predicate: for each NULL sale field, pick the available_listings row
-- on the same property whose listing lifecycle (listing_date → off_market or
-- sold_date) contains the sale_date; else the listing whose listing_date is
-- closest to sale_date.
--
-- Provenance / reversibility:
--   - cap_rate writes carry cap_rate_method='listing_asking_backfill_20260521'
--     and cap_rate_confidence='low'; cap_rate_notes is appended (not replaced).
--     Reverse with:
--       UPDATE sales_transactions
--       SET stated_cap_rate=NULL, cap_rate_method=NULL, cap_rate_confidence=NULL,
--           cap_rate_notes = NULLIF(replace(cap_rate_notes,
--             E'\n[2026-05-21 backfill] asking cap copied from available_listings.',
--             ''), '')
--       WHERE cap_rate_method='listing_asking_backfill_20260521';
--   - broker / seller / price writes carry no marker. Reversal is best-effort
--     via re-running the same predicate to identify candidates.
--
-- This migration is idempotent: re-running the UPDATEs against already-filled
-- rows is a no-op (WHERE clauses require NULL primary).
--
-- IMPORTANT: this migration was applied via Supabase MCP execute_sql on
-- 2026-05-21 and is recorded here for the project's migration history.
-- The DDL/DML below mirrors what was executed.
-- ============================================================================

BEGIN;

-- 1) listing_broker
UPDATE sales_transactions st
SET listing_broker = (
  SELECT al.listing_broker FROM available_listings al
  WHERE al.property_id = st.property_id
    AND coalesce(al.listing_broker,'') <> ''
  ORDER BY
    CASE WHEN al.listing_date <= st.sale_date
          AND coalesce(al.off_market_date, al.sold_date, current_date) >= st.sale_date
         THEN 0 ELSE 1 END,
    ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
  LIMIT 1
)
WHERE coalesce(st.listing_broker, '') = ''
  AND EXISTS (
    SELECT 1 FROM available_listings al
    WHERE al.property_id = st.property_id AND coalesce(al.listing_broker,'') <> ''
  );

-- 2) seller_name
UPDATE sales_transactions st
SET seller_name = (
  SELECT al.seller_name FROM available_listings al
  WHERE al.property_id = st.property_id
    AND coalesce(al.seller_name,'') <> ''
  ORDER BY
    CASE WHEN al.listing_date <= st.sale_date
          AND coalesce(al.off_market_date, al.sold_date, current_date) >= st.sale_date
         THEN 0 ELSE 1 END,
    ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
  LIMIT 1
)
WHERE coalesce(st.seller_name, '') = ''
  AND EXISTS (
    SELECT 1 FROM available_listings al
    WHERE al.property_id = st.property_id AND coalesce(al.seller_name,'') <> ''
  );

-- 3) sold_price — guarded against the realistic-price CHECK ($50K floor) and
-- the (property_id, sale_date, sold_price) unique index.
UPDATE sales_transactions st
SET sold_price = candidate.price
FROM (
  SELECT st.sale_id, st.property_id, st.sale_date,
    (SELECT coalesce(al.sold_price, al.last_price, al.initial_price)
     FROM available_listings al
     WHERE al.property_id = st.property_id
       AND coalesce(al.sold_price, al.last_price, al.initial_price) >= 50000
     ORDER BY
       CASE WHEN al.listing_date <= st.sale_date
             AND coalesce(al.off_market_date, al.sold_date, current_date) >= st.sale_date
            THEN 0 ELSE 1 END,
       ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
     LIMIT 1) AS price
  FROM sales_transactions st
  WHERE (st.sold_price IS NULL OR st.sold_price = 0)
) candidate
WHERE st.sale_id = candidate.sale_id
  AND candidate.price IS NOT NULL
  AND candidate.price >= 50000
  AND NOT EXISTS (
    SELECT 1 FROM sales_transactions other
    WHERE other.sale_id <> st.sale_id
      AND other.property_id = candidate.property_id
      AND other.sale_date = candidate.sale_date
      AND coalesce(other.sold_price, 0) = candidate.price
  );

-- 4) stated_cap_rate (with provenance metadata, NEVER overwriting a
-- populated cap_rate / calculated_cap_rate / stated_cap_rate).
UPDATE sales_transactions st
SET stated_cap_rate     = candidate.cap,
    cap_rate_confidence = 'low',
    cap_rate_method     = 'listing_asking_backfill_20260521',
    cap_rate_notes      = trim(coalesce(cap_rate_notes,'') || E'\n[2026-05-21 backfill] asking cap copied from available_listings.')
FROM (
  SELECT st.sale_id,
    (SELECT coalesce(al.cap_rate, al.current_cap_rate, al.last_cap_rate, al.initial_cap_rate)
     FROM available_listings al
     WHERE al.property_id = st.property_id
       AND coalesce(al.cap_rate, al.current_cap_rate, al.last_cap_rate, al.initial_cap_rate) > 0
     ORDER BY
       CASE WHEN al.listing_date <= st.sale_date
             AND coalesce(al.off_market_date, al.sold_date, current_date) >= st.sale_date
            THEN 0 ELSE 1 END,
       ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
     LIMIT 1) AS cap
  FROM sales_transactions st
  WHERE st.cap_rate IS NULL AND st.calculated_cap_rate IS NULL AND st.stated_cap_rate IS NULL
) candidate
WHERE st.sale_id = candidate.sale_id
  AND candidate.cap IS NOT NULL;

-- 5) properties.year_built ← year_renovated (only when year_built null and
-- the property has at least one sale on file).
UPDATE properties
SET year_built = year_renovated
WHERE year_built IS NULL
  AND year_renovated IS NOT NULL
  AND year_renovated >= 1600 AND year_renovated <= 2100
  AND EXISTS (SELECT 1 FROM sales_transactions st WHERE st.property_id = properties.property_id);

-- 6) properties.land_area ← lot_sf / 43560 (acres conversion).
UPDATE properties
SET land_area = round((lot_sf / 43560.0)::numeric, 4)
WHERE land_area IS NULL
  AND lot_sf IS NOT NULL AND lot_sf > 0
  AND EXISTS (SELECT 1 FROM sales_transactions st WHERE st.property_id = properties.property_id);

COMMIT;
