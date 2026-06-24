-- T4c (2026-06-24): on-market date as a first-class, source-ranked field on
-- dia available_listings. `listing_date` keeps its operational value; the NEW
-- on_market_date columns are the TIMING truth the supply-side / DOM charts
-- read — sourced ONLY from market-entry evidence, NEVER the processing clock.
--
-- The dia "surge" (657 rows dated June 2026 from a mass-forwarded OM mailbox)
-- carries listing_date_source IN ('capture_date_fallback','date_unknown*') —
-- those are the LOAD date, not the real on-market date. They are HELD
-- (on_market_date NULL / 'date_unknown_held') so the added-per-month + DOM
-- series exclude them rather than stamp a fabricated ingest-month date. The
-- genuinely-recovered date arrives later via the email/platform/SF ladder
-- (handed off — Gmail/CoStar/SF not reachable here; the artifact-path date is
-- itself a June ingest cluster, so it is NOT used as a proxy).
--
-- Additive + reversible: listing_date is untouched; DROP the 3 columns to
-- revert. Idempotent: only rows whose on_market_date_source IS NULL are set.
ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS on_market_date            date,
  ADD COLUMN IF NOT EXISTS on_market_date_source     text,
  ADD COLUMN IF NOT EXISTS on_market_date_confidence text;

-- 1. HOLD the processing-clock fallback set (the surge) — exclude from timing.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'date_unknown_held',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND listing_date_source IN ('capture_date_fallback','date_unknown','date_unknown_r70b34');

-- 2. Promote real-evidence sources (the listing_date IS a real market signal).
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

-- 3. Legacy untagged rows (NULL source) carry a real, non-clustered historical
--    listing_date (2001..2025) — keep them in the series at LOW confidence.
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = 'legacy_unverified',
  on_market_date_confidence = 'low'
WHERE on_market_date_source IS NULL
  AND listing_date_source IS NULL
  AND listing_date IS NOT NULL;

-- 4. Anything still unset (no listing_date at all) → HELD.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'date_unknown_held',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL;

COMMENT ON COLUMN public.available_listings.on_market_date IS
  'T4c: market-entry date for the timing/DOM series. NULL = HELD (no evidence; excluded from added-per-month + DOM). Never the processing clock.';
COMMENT ON COLUMN public.available_listings.on_market_date_source IS
  'T4c provenance: on_market_date / costar_date_on_market / costar_days_on_market / days_on_market / om_lease_inference / sale_anchor / email_received / email_earliest / costar|loopnet|rca|salesforce / master_curated / legacy_unverified / date_unknown_held.';
COMMENT ON COLUMN public.available_listings.on_market_date_confidence IS
  'T4c confidence: high | medium | low | none (none == HELD/null).';
