-- Migration: dia — Round 70 Layer B / D10: clamp over-cap synthetic listing
-- windows to the cohort's imputed DOM. Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- D10 receipts (read-only): the dia active-listing universe peaks at 226
-- (2025-Q1), NOT >350 — within Scott's anecdotal 200-300. Organic/tracked is
-- stable ~125; synthetics add 21-43% (the R68-A retroactive-deal lift, by
-- design). No framing change needed. BUT 8 of 1,207 synthetic_from_sale
-- listings carry windows of 1,263-2,559 days (3.5-7 yr) vs the cohort
-- median/mode window of 175 days — their listing_date_source claims
-- 'synth_sale_minus_median_dom' but the median-DOM subtraction did not take, so
-- each over-cap synthetic counts as "active" across up to 28 extra quarters
-- (genuine window-stacking bug).
--
-- Fix (unconditional, per Scott): set listing_date = sold_date - 175 (the
-- cohort's imputed DOM, "no 1095 tail") for synthetics whose window exceeds the
-- 1095-day cap, restoring a ~175-day window like every other synthetic.
-- Idempotent: re-running finds no window > 1095 (no-op). Bounded to 8 rows.
--
-- Builder note: the synthetic-listing creator should enforce the cap so this
-- can't recur; flagged as a Layer-B follow-up (these 8 are a one-time backfill
-- artifact). This data fix is safe to apply now regardless.

WITH offenders AS (
  SELECT listing_id, COALESCE(sold_date, off_market_date) AS anchor
  FROM available_listings
  WHERE data_source = 'synthetic_from_sale'
    AND listing_date IS NOT NULL
    AND COALESCE(sold_date, off_market_date) IS NOT NULL
    AND (COALESCE(sold_date, off_market_date) - listing_date) > 1095
)
UPDATE available_listings al
SET listing_date = o.anchor - 175,
    listing_date_source = 'synth_sale_minus_median_dom_clamped_r70d10'
FROM offenders o
WHERE al.listing_id = o.listing_id;
