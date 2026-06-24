-- T4c (2026-06-24): on-market date as a first-class, source-ranked field on
-- gov available_listings — the gov sibling of the dia migration. Same model:
-- `listing_date` keeps its operational value; on_market_date is the TIMING
-- truth, from market-entry evidence only, NEVER the processing clock.
--
-- gov HAS a `listing_source` channel column, so the HELD set is SCOPED to the
-- OM/aggregator channels and EXPLICITLY excludes synthetic_from_sale /
-- master_curated_sale (their sold-anchored / curated listing_date is real and
-- is KEPT). Scott's held predicate (2026-06-24):
--   listing_date_source IN ('capture_date_fallback','date_unknown_r70b34',
--       'date_unknown','om_lease_inference', NULL)
--   AND listing_source IN ('lcc_intake_om','email_om','om_extraction','crexi',
--       'salesforce_ascendix','costar_sidebar')
--   AND listing_source NOT IN ('synthetic_from_sale','master_curated_sale')
--
-- BYTE-IDENTICAL-PUBLISHED constraint (≤ 2026-03-31 unchanged): R70-B3 already
-- excluded capture/unknown from the added/DOM counts → HOLD those at ALL dates.
-- om_lease_inference + NULL-source WERE counted, so only the surge window
-- (≥ 2026-04-01) is HELD; earlier rows keep their date as
-- 'unestablished_historical'. The recovered date arrives later via the
-- email/platform/SF ladder (handed off — not reachable here).
--
-- Additive, reversible (DROP the 3 columns), idempotent (only sets where
-- on_market_date_source IS NULL).
ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS on_market_date            date,
  ADD COLUMN IF NOT EXISTS on_market_date_source     text,
  ADD COLUMN IF NOT EXISTS on_market_date_confidence text;

-- 1. Clock-fallback sources (capture/unknown), scoped to the OM/aggregator
--    channels → HELD at ALL dates. R70 already excluded these → byte-identical.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND listing_date_source IN ('capture_date_fallback','date_unknown','date_unknown_r70b34')
  AND listing_source IN ('lcc_intake_om','email_om','om_extraction','crexi','salesforce_ascendix','costar_sidebar');

-- 2a. Artifact-dated set (om_lease_inference + NULL source), scoped to the
--     OM/aggregator channels (NOT synthetic/master), in the SURGE WINDOW
--     (≥ 2026-04-01) → HELD. De-surges the new, unpublished edge.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND (listing_date_source = 'om_lease_inference' OR listing_date_source IS NULL)
  AND listing_source IN ('lcc_intake_om','email_om','om_extraction','crexi','salesforce_ascendix','costar_sidebar')
  AND listing_date IS NOT NULL
  AND listing_date >= DATE '2026-04-01';

-- 2b. The SAME scoped artifact-dated set BEFORE the surge window → KEEP the
--     date ('unestablished_historical', low) to keep published months
--     ≤ 2026-03-31 byte-identical (R70 counted these).
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = 'unestablished_historical',
  on_market_date_confidence = 'low'
WHERE on_market_date_source IS NULL
  AND (listing_date_source = 'om_lease_inference' OR listing_date_source IS NULL)
  AND listing_source IN ('lcc_intake_om','email_om','om_extraction','crexi','salesforce_ascendix','costar_sidebar')
  AND listing_date IS NOT NULL
  AND listing_date < DATE '2026-04-01';

-- 3. Promote every remaining dated row (the held/clock set was consumed by
--    steps 1/2a/2b). This is where the KEPT channels land: synthetic_from_sale
--    rows carry listing_date_source=NULL (a sold-anchored date), so their
--    provenance tag comes from `listing_source`; master_curated_sale carries
--    listing_date_source='master_curated'. Real-evidence sources
--    (on_market_date / costar_* / days_on_market) keep their own tag.
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = COALESCE(NULLIF(listing_date_source, ''), listing_source, 'unestablished_historical'),
  on_market_date_confidence = CASE COALESCE(NULLIF(listing_date_source, ''), listing_source)
    WHEN 'on_market_date'                              THEN 'high'
    WHEN 'costar_date_on_market'                       THEN 'high'
    WHEN 'costar_days_on_market'                       THEN 'medium'
    WHEN 'days_on_market'                              THEN 'medium'
    WHEN 'master_curated'                              THEN 'medium'
    WHEN 'sale_anchor_est_175'                         THEN 'low'
    WHEN 'synth_sale_minus_median_dom'                 THEN 'low'
    WHEN 'synth_sale_minus_median_dom_clamped_r70d10'  THEN 'low'
    WHEN 'synthetic_from_sale'                         THEN 'low'
    ELSE 'low' END
WHERE on_market_date_source IS NULL
  AND listing_date IS NOT NULL;

-- 4. Anything still unset (no date / no signal) → HELD.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL;

COMMENT ON COLUMN public.available_listings.on_market_date IS
  'T4c: market-entry date for the timing/DOM series. NULL = HELD (no evidence). Never the processing clock.';
COMMENT ON COLUMN public.available_listings.on_market_date_source IS
  'T4c provenance source tag (see dia mirror). synthetic_from_sale / master_curated kept; unestablished = held.';
COMMENT ON COLUMN public.available_listings.on_market_date_confidence IS
  'T4c confidence: high | medium | low | none.';
