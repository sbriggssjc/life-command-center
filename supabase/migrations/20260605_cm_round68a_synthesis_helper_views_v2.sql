-- Migration: dia — Round 68-A synthesis/link helper views v2 (Task 2, amended)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- Plan-v1 verification (Scott, 2026-06-04) found a LINK class hiding inside the
-- synth set: 401 unlinked sales whose property already has a REAL (non-synthetic)
-- listing in the 3y-prior window. Synthesizing those would double-count the
-- marketing event on every INCLUDE view (the real listing AND a synthetic one).
-- Receipt: sale 266 (2017-12-15, property 23350) — real listing 9507
-- (2017-08-22) exists, already linked to sibling sale 265; sale 266 itself is
-- unlinked. v1 synthesized it; v2 excludes it.
--
-- Split:
--   * LINK class (401) — excluded from synthesis. Where an UNLINKED real prior
--     listing is available (222, deduped to 212 unique listing->nearest sale),
--     link it instead (scripts/round68a-link-listings.mjs). The remaining ~189
--     are already covered by a sibling-linked real listing — no synth, no link.
--   * SYNTH class (1,207) — proceeds as planned (price-less rows).
--
-- Read-only views; safe to apply (gate-enablement). Supersedes the synth view
-- from 20260605_cm_round68a_synthesis_helper_views.sql.

-- LINK candidates: one row per actual link (unique real unlinked listing ->
-- its nearest prior sale within 3y). The link script reads this directly.
CREATE OR REPLACE VIEW public.v_round68a_link_candidates AS
 WITH unlinked AS (
   SELECT s.sale_id, s.property_id, s.sale_date
   FROM sales_transactions s
   WHERE s.sale_date >= '2013-01-01' AND s.sold_price > 0::numeric
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
     AND s.property_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM available_listings al WHERE al.sale_transaction_id = s.sale_id)
 ), pairs AS (
   SELECT u.sale_id, u.sale_date, al.listing_id, al.listing_date,
          (u.sale_date - al.listing_date) AS gap_days
   FROM unlinked u
   JOIN available_listings al
     ON al.property_id = u.property_id
    AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
    AND al.sale_transaction_id IS NULL          -- only links currently-unlinked listings
    AND al.listing_date IS NOT NULL
    AND al.listing_date < u.sale_date            -- sanity: marketed before the sale
    AND (u.sale_date - al.listing_date) BETWEEN 1 AND 1095   -- within 3y prior
 ), per_sale AS (   -- nearest prior listing per sale
   SELECT DISTINCT ON (sale_id) sale_id, sale_date, listing_id, listing_date, gap_days
   FROM pairs ORDER BY sale_id, gap_days, listing_id
 ), dedup AS (      -- each listing links to at most one (nearest) sale
   SELECT DISTINCT ON (listing_id) sale_id, sale_date, listing_id, listing_date, gap_days
   FROM per_sale ORDER BY listing_id, gap_days, sale_id
 )
 SELECT listing_id, sale_id, listing_date, sale_date, gap_days FROM dedup;

COMMENT ON VIEW public.v_round68a_link_candidates IS
  'Round 68-A Task 2 LINK class: real unlinked listing -> nearest prior sale '
  '(within 3y). The link script sets sale_transaction_id + off_market/sold + '
  'status=sold on the listing. Drop after the backfill lands.';

-- SYNTH candidates v2: unlinked sales that DO NOT already have a real prior
-- listing in the 3y window (the LINK-class exclusion). Everything else is
-- unchanged from v1 (same DOM imputation).
CREATE OR REPLACE VIEW public.v_round68a_synth_candidates AS
 WITH linked AS (
   SELECT EXTRACT(YEAR FROM s.sale_date)::int AS yr, (s.sale_date - al.listing_date) AS dom
   FROM sales_transactions s
   JOIN available_listings al ON al.sale_transaction_id = s.sale_id
   WHERE al.listing_date IS NOT NULL AND s.sale_date > al.listing_date
     AND (s.sale_date - al.listing_date) BETWEEN 7 AND 1095
     AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
 ), yr_dom AS (
   SELECT yr, count(*) AS n, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int AS med
   FROM linked GROUP BY yr
 ), glob AS (
   SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int AS med FROM linked
 ), unlinked AS (
   SELECT s.sale_id, s.property_id, s.sale_date, s.sold_price,
          EXTRACT(YEAR FROM s.sale_date)::int AS syr
   FROM sales_transactions s
   WHERE s.sale_date >= '2013-01-01' AND s.sold_price > 0::numeric
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
     AND s.property_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM available_listings al WHERE al.sale_transaction_id = s.sale_id)
     -- LINK-class exclusion: skip sales whose property already has a REAL prior
     -- listing in the 3y window (avoids double-counting the marketing event).
     AND NOT EXISTS (
       SELECT 1 FROM available_listings al
       WHERE al.property_id = s.property_id
         AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
         AND al.listing_date IS NOT NULL AND al.listing_date < s.sale_date
         AND (s.sale_date - al.listing_date) BETWEEN 1 AND 1095)
 )
 SELECT u.sale_id, u.property_id, u.sale_date, u.sold_price, u.syr AS sale_year,
   COALESCE((SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365),
            (SELECT med FROM glob)) AS dom_used,
   CASE WHEN (SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365) IS NOT NULL
        THEN 'year_median' ELSE 'pooled_median' END AS dom_class,
   (u.sale_date - COALESCE((SELECT y.med FROM yr_dom y WHERE y.yr = u.syr AND y.n >= 15 AND y.med BETWEEN 45 AND 365),
            (SELECT med FROM glob)) * INTERVAL '1 day')::date AS synth_listing_date
 FROM unlinked u;
