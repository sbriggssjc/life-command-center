-- Migration: gov — Round 70 B4 (G35): park the 2026 over-stamped listing_date
-- batch + canonical gated new-to-market view. Project: government. Applied live.
-- Same root cause/riders as the dia B3 migration (OM promoter discarded
-- deriveListingDate's .source; capture-date fallback stamped today()).
--   RIDER (a): date_unknown_r70b34 is a PARKING TAG; page-markers can upgrade
--     a row with a receipt and the gated count heals (no deploy).
--   RIDER (b): some parked rows likely carry true dates we can't prove (the
--     promoter discarded a real OM signal) — documented cost; no fabrication.
-- gov has no synthetic_from_sale listings. Legacy NULL-source rows (real
-- historical dates) are NOT touched.
--
-- Re-tag (idempotent):
UPDATE available_listings
SET listing_date_source = 'date_unknown_r70b34'
WHERE listing_date_source IS NULL
  AND date_part('year', listing_date) = 2026;

-- Before/after gated new-to-market (annual): 2023 53/53, 2024 42/42,
-- 2025 60/60 (untouched floor), 2026 443(raw)->0(gated) — gov had no
-- real-sourced 2026 listings; all 443 were promoter-stamped NULL-source.
CREATE OR REPLACE VIEW public.cm_gov_new_to_market_q AS
SELECT (date_trunc('quarter', listing_date) + interval '3 mons -1 day')::date AS period_end,
  'all'::text AS subspecialty,
  count(*) FILTER (WHERE COALESCE(listing_date_source,'') NOT IN ('date_unknown_r70b34','capture_date_fallback','date_unknown')) AS new_listings,
  count(*) AS new_listings_raw_incl_unknown
FROM available_listings
WHERE listing_date IS NOT NULL AND listing_date >= '2013-01-01' AND listing_date <= cm_last_completed_quarter_end()
GROUP BY 1 ORDER BY 1;
