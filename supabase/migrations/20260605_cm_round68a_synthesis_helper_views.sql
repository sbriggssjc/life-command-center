-- Migration: dia — Round 68-A synthesis helper views (Task 2)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- Read-only helper views that (a) make the synthesis plan independently
-- verifiable with a single SELECT and (b) are the source the workstation
-- synthesis script (scripts/round68a-synthesize-listings.mjs) reads from. The
-- days-on-market medians are COMPUTED here (never hard-coded), per the brief.
--
-- These are Round 68-A backfill artifacts — safe to DROP after the synthesis
-- bulk insert has landed and been verified. They depend on the data_source
-- column (20260605_cm_round68a_listing_provenance_columns.sql).
--
-- DOM imputation rule (single source of truth, mirrored by the script):
--   listing_date = sale_date - DOM_used
--   DOM_used = the sale-year median DOM from the LINKED cohort
--              WHEN that year has n >= 15 linked pairs AND its median is in
--              [45, 365] days; ELSE the pooled all-years median.
--   Linked cohort = sales joined to their real (non-synthetic) listing via
--   sale_transaction_id, with 7 <= (sale_date - listing_date) <= 1095.

-- Per-year DOM rule (drives the plan doc's "computed medians" table).
CREATE OR REPLACE VIEW public.v_round68a_dom_rule AS
 WITH linked AS (
   SELECT EXTRACT(YEAR FROM s.sale_date)::int AS yr,
          (s.sale_date - al.listing_date) AS dom
   FROM sales_transactions s
   JOIN available_listings al ON al.sale_transaction_id = s.sale_id
   WHERE al.listing_date IS NOT NULL
     AND s.sale_date > al.listing_date
     AND (s.sale_date - al.listing_date) BETWEEN 7 AND 1095
     AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
 )
 SELECT yr,
   count(*) AS linked_n,
   round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int AS median_dom,
   (count(*) >= 15
     AND round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom)) BETWEEN 45 AND 365) AS uses_year_median
 FROM linked
 GROUP BY yr
 ORDER BY yr;

-- One row per synthesizable unlinked sale, with the resolved synthetic
-- listing_date and its provenance class. The script INSERTs from this set.
CREATE OR REPLACE VIEW public.v_round68a_synth_candidates AS
 WITH linked AS (
   SELECT EXTRACT(YEAR FROM s.sale_date)::int AS yr,
          (s.sale_date - al.listing_date) AS dom
   FROM sales_transactions s
   JOIN available_listings al ON al.sale_transaction_id = s.sale_id
   WHERE al.listing_date IS NOT NULL
     AND s.sale_date > al.listing_date
     AND (s.sale_date - al.listing_date) BETWEEN 7 AND 1095
     AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
 ), yr_dom AS (
   SELECT yr, count(*) AS n,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int AS med
   FROM linked GROUP BY yr
 ), glob AS (
   SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int AS med FROM linked
 ), unlinked AS (
   SELECT s.sale_id, s.property_id, s.sale_date, s.sold_price,
          EXTRACT(YEAR FROM s.sale_date)::int AS syr
   FROM sales_transactions s
   WHERE s.sale_date >= '2013-01-01'
     AND s.sold_price > 0::numeric
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
     AND s.property_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM available_listings al WHERE al.sale_transaction_id = s.sale_id)
 )
 SELECT u.sale_id,
   u.property_id,
   u.sale_date,
   u.sold_price,
   u.syr AS sale_year,
   COALESCE((SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365),
            (SELECT med FROM glob)) AS dom_used,
   CASE WHEN (SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365) IS NOT NULL
        THEN 'year_median' ELSE 'pooled_median' END AS dom_class,
   (u.sale_date - COALESCE((SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365),
            (SELECT med FROM glob)) * INTERVAL '1 day')::date AS synth_listing_date
 FROM unlinked u;

COMMENT ON VIEW public.v_round68a_synth_candidates IS
  'Round 68-A Task 2 backfill source: unlinked sold deals (2013+, price>0, not '
  'excluded, property linked) to be synthesized as price-less listing rows. '
  'Drop after the backfill lands.';
