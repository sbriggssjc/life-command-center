-- T4c (2026-06-24): on-market date as a first-class, source-ranked field on
-- gov available_listings — the gov sibling of the dia migration. Same model:
-- `listing_date` keeps its operational value; on_market_date is the TIMING
-- truth, from market-entry evidence only, NEVER the processing clock. The gov
-- fake-dated set (901 rows: capture_date_fallback 468 + date_unknown_r70b34
-- 433) is HELD; real-evidence + legacy rows are promoted. Additive, reversible
-- (DROP the 3 columns), idempotent (only sets where on_market_date_source NULL).
ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS on_market_date            date,
  ADD COLUMN IF NOT EXISTS on_market_date_source     text,
  ADD COLUMN IF NOT EXISTS on_market_date_confidence text;

-- 1. HOLD the processing-clock fallback set (the surge).
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'date_unknown_held',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND listing_date_source IN ('capture_date_fallback','date_unknown','date_unknown_r70b34');

-- 2. Promote real-evidence sources.
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = listing_date_source,
  on_market_date_confidence = CASE listing_date_source
    WHEN 'on_market_date'                              THEN 'high'
    WHEN 'costar_date_on_market'                       THEN 'high'
    WHEN 'costar_days_on_market'                       THEN 'medium'
    WHEN 'days_on_market'                              THEN 'medium'
    WHEN 'om_lease_inference'                          THEN 'medium'
    WHEN 'master_curated'                              THEN 'medium'
    WHEN 'sale_anchor_est_175'                         THEN 'low'
    WHEN 'synth_sale_minus_median_dom'                 THEN 'low'
    WHEN 'synth_sale_minus_median_dom_clamped_r70d10'  THEN 'low'
    ELSE 'low' END
WHERE on_market_date_source IS NULL
  AND listing_date_source IS NOT NULL
  AND listing_date_source NOT IN ('capture_date_fallback','date_unknown','date_unknown_r70b34')
  AND listing_date IS NOT NULL;

-- 3. Legacy untagged rows (NULL source) — real historical date, LOW confidence.
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = 'legacy_unverified',
  on_market_date_confidence = 'low'
WHERE on_market_date_source IS NULL
  AND listing_date_source IS NULL
  AND listing_date IS NOT NULL;

-- 4. Anything still unset → HELD.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'date_unknown_held',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL;

COMMENT ON COLUMN public.available_listings.on_market_date IS
  'T4c: market-entry date for the timing/DOM series. NULL = HELD (no evidence). Never the processing clock.';
COMMENT ON COLUMN public.available_listings.on_market_date_source IS
  'T4c provenance source tag (see dia mirror).';
COMMENT ON COLUMN public.available_listings.on_market_date_confidence IS
  'T4c confidence: high | medium | low | none.';
