-- Round 76gp.c (2026-05-21) — Gov cross-source backfill from available_listings + properties
-- ============================================================================
-- Mirror of the dia Round 76gp.b backfill, adapted for gov schema:
--   * sales_transactions.seller (not seller_name)
--   * sales_transactions.buyer (not buyer_name)
--   * sales_transactions.sold_cap_rate (not stated_cap_rate)
--   * gov denormalizes year_built/rba/land_acres onto sales_transactions
--   * available_listings.asking_cap_rate (not cap_rate)
--   * available_listings.asking_price (not sold_price)
--   * No cap_rate_method / cap_rate_notes columns — no provenance markers
--
-- Audit findings preceding this migration (gov DB, 8,812 sales):
--
--   Field                  Before    After    Filled
--   null sold_price        5,420     5,345    75
--   null sold_cap_rate     5,811     5,757    54
--   null listing_broker    7,022     6,914    108
--   null seller            1,905     1,898    7
--   null year_built        6,365     3,300    3,065 ← properties join
--   null land_acres        6,319     5,707    612   ← properties join
--   null rba               6,298       440    5,858 ← properties join (biggest)
--
-- Total ~9,800 cells filled. The properties-table join is the biggest win
-- here because gov sales_transactions denormalizes year_built/rba/land_acres
-- onto each sale row, and many legacy imports left those columns null while
-- the matching properties row was populated.
--
-- Match predicate for available_listings rows: lifecycle window
-- (listing_date → off_market_date) containing sale_date wins; else closest
-- listing_date.
--
-- Guards:
--   * sold_price >= $50,000 (chk_sold_price_realistic CHECK)
--   * sold_cap_rate BETWEEN 0.005 AND 0.30 (chk_sold_cap_rate_range CHECK)
--   * (property_id, sale_date, sold_price) unique index respected via
--     NOT EXISTS subquery (partial index excludes exclude_from_market_metrics
--     rows, so we filter those out of the duplicate check)
--
-- Reversibility: no provenance markers on gov writes (schema has no place
-- for them). Reverse via re-running the same predicate to identify
-- candidates, or restore from logical-replication lag/backup.
--
-- IMPORTANT: this migration was applied via Supabase MCP execute_sql on
-- 2026-05-21 and is recorded here for the project's migration history.
-- ============================================================================

BEGIN;

-- 1) listing_broker from al.listing_broker
UPDATE sales_transactions st
SET listing_broker = (
  SELECT al.listing_broker FROM available_listings al
  WHERE al.property_id = st.property_id AND coalesce(al.listing_broker,'') <> ''
  ORDER BY
    CASE WHEN al.listing_date <= st.sale_date
          AND coalesce(al.off_market_date, current_date) >= st.sale_date
         THEN 0 ELSE 1 END,
    ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
  LIMIT 1
)
WHERE coalesce(st.listing_broker, '') = ''
  AND EXISTS (SELECT 1 FROM available_listings al WHERE al.property_id = st.property_id AND coalesce(al.listing_broker,'') <> '');

-- 2) seller from al.seller_name
UPDATE sales_transactions st
SET seller = (
  SELECT al.seller_name FROM available_listings al
  WHERE al.property_id = st.property_id AND coalesce(al.seller_name,'') <> ''
  ORDER BY
    CASE WHEN al.listing_date <= st.sale_date
          AND coalesce(al.off_market_date, current_date) >= st.sale_date
         THEN 0 ELSE 1 END,
    ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
  LIMIT 1
)
WHERE coalesce(st.seller, '') = ''
  AND EXISTS (SELECT 1 FROM available_listings al WHERE al.property_id = st.property_id AND coalesce(al.seller_name,'') <> '');

-- 3) sold_cap_rate from al.asking_cap_rate / current / original / initial.
-- Range-guarded against chk_sold_cap_rate_range (0.005..0.30).
UPDATE sales_transactions st
SET sold_cap_rate = candidate.cap
FROM (
  SELECT st.sale_id,
    (SELECT coalesce(al.asking_cap_rate, al.current_cap_rate, al.original_cap_rate, al.initial_cap_rate)
     FROM available_listings al
     WHERE al.property_id = st.property_id
       AND coalesce(al.asking_cap_rate, al.current_cap_rate, al.original_cap_rate, al.initial_cap_rate) BETWEEN 0.005 AND 0.30
     ORDER BY
       CASE WHEN al.listing_date <= st.sale_date
             AND coalesce(al.off_market_date, current_date) >= st.sale_date
            THEN 0 ELSE 1 END,
       ABS(coalesce(extract(epoch from (al.listing_date::timestamp - st.sale_date::timestamp))::bigint, 9999999999))
     LIMIT 1) AS cap
  FROM sales_transactions st
  WHERE st.sold_cap_rate IS NULL
) candidate
WHERE st.sale_id = candidate.sale_id AND candidate.cap IS NOT NULL;

-- 4) sold_price from al.asking_price / original / initial / last.
-- Guarded against chk_sold_price_realistic ($50K floor) and
-- uq_st_property_date_price (partial unique index).
UPDATE sales_transactions st
SET sold_price = candidate.price
FROM (
  SELECT st.sale_id, st.property_id, st.sale_date,
    (SELECT coalesce(al.asking_price, al.original_price, al.initial_price, al.last_price)
     FROM available_listings al
     WHERE al.property_id = st.property_id
       AND coalesce(al.asking_price, al.original_price, al.initial_price, al.last_price) >= 50000
     ORDER BY
       CASE WHEN al.listing_date <= st.sale_date
             AND coalesce(al.off_market_date, current_date) >= st.sale_date
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
      AND other.exclude_from_market_metrics IS NOT TRUE
  );

-- 5) Denormalize properties metadata onto sales_transactions rows when null.
-- gov keeps year_built/rba/land_acres on EACH sale row (as-of-sale snapshot
-- semantics), but the legacy CSV import often left these null even when
-- properties had them. This pass fills from properties (current values).
UPDATE sales_transactions st
SET year_built = p.year_built
FROM properties p
WHERE st.property_id = p.property_id
  AND (st.year_built IS NULL OR st.year_built = 0)
  AND p.year_built IS NOT NULL AND p.year_built > 0;

UPDATE sales_transactions st
SET rba = p.rba
FROM properties p
WHERE st.property_id = p.property_id
  AND (st.rba IS NULL OR st.rba = 0)
  AND p.rba IS NOT NULL AND p.rba > 0;

UPDATE sales_transactions st
SET land_acres = p.land_acres
FROM properties p
WHERE st.property_id = p.property_id
  AND (st.land_acres IS NULL OR st.land_acres = 0)
  AND p.land_acres IS NOT NULL AND p.land_acres > 0;

-- 6) properties.year_built ← year_renovated for properties with sales.
-- (Yielded 0 fills at audit time, included for parity with dia migration.)
UPDATE properties
SET year_built = year_renovated
WHERE year_built IS NULL
  AND year_renovated IS NOT NULL
  AND year_renovated BETWEEN 1600 AND 2100
  AND EXISTS (SELECT 1 FROM sales_transactions st WHERE st.property_id = properties.property_id);

COMMIT;
