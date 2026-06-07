-- Migration: dia — Round 70 B3 (D9): park the 2026 over-stamped listing_date
-- batch + canonical gated new-to-market view. Project: Dialysis_DB. Applied live.
--
-- The OM promoter discarded deriveListingDate's .source and its capture-date
-- fallback hard-stamped today(), so 186 dia (+438 gov) listings landed
-- NULL-source with a fabricated 2026 listing_date (8-10x the ~50/yr baseline;
-- 2025 correspondingly deflated). Ingestion fixed separately (promoter +
-- entities-handler now store listing_date_source).
--
-- This migration parks the historical batch + adds the gated count view.
--
-- RIDER (a): 'date_unknown_r70b34' is a PARKING TAG, not a verdict. The
--   availability-checker page-marker path may later upgrade an individual row
--   to a real source WITH a receipt — that overwrites the parking tag and the
--   gated count heals automatically (no deploy).
-- RIDER (b): because the promoter discarded .source even when deriveListingDate
--   found a real OM on-market signal, SOME parked rows almost certainly carry a
--   true list date we cannot currently prove. That is the documented cost of the
--   bug; we do NOT fabricate dates (R68-A: no re-dating without per-row receipts).
--
-- Re-tag (idempotent simple predicate; legacy 2010-2024 NULL-source rows with
-- real historical dates are NOT touched):
UPDATE available_listings
SET listing_date_source = 'date_unknown_r70b34'
WHERE listing_date_source IS NULL
  AND data_source IS DISTINCT FROM 'synthetic_from_sale'
  AND date_part('year', listing_date) = 2026;

-- Before/after gated new-to-market (annual): 2023 144/144, 2024 146/146,
-- 2025 25/25 (honest floor, untouched), 2026 215(raw)->5(gated) [full year];
-- the quarter-capped view shows 2026-Q1 gated 1 / raw 7.
CREATE OR REPLACE VIEW public.cm_dialysis_new_to_market_q AS
SELECT (date_trunc('quarter', listing_date) + interval '3 mons -1 day')::date AS period_end,
  'all'::text AS subspecialty,
  count(*) FILTER (WHERE data_source IS DISTINCT FROM 'synthetic_from_sale'
    AND COALESCE(listing_date_source,'') NOT IN ('date_unknown_r70b34','capture_date_fallback','date_unknown')) AS new_listings,
  count(*) FILTER (WHERE data_source IS DISTINCT FROM 'synthetic_from_sale') AS new_listings_raw_incl_unknown
FROM available_listings
WHERE listing_date IS NOT NULL AND listing_date >= '2017-01-01' AND listing_date <= cm_last_completed_quarter_end()
GROUP BY 1 ORDER BY 1;
