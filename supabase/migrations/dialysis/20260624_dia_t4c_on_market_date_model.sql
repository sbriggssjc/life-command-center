-- T4c (2026-06-24): on-market date as a first-class, source-ranked field on
-- dia available_listings. `listing_date` keeps its operational value; the NEW
-- on_market_date columns are the TIMING truth the supply-side / DOM charts
-- read — sourced ONLY from market-entry evidence, NEVER the processing clock.
--
-- The dia "surge" (657 rows dated June 2026 from a mass-forwarded OM mailbox)
-- carries listing_date_source IN ('capture_date_fallback','date_unknown*') —
-- those are the LOAD date, not the real on-market date. They are HELD
-- (on_market_date NULL / 'unestablished') so the added-per-month + DOM series
-- exclude them rather than stamp a fabricated ingest-month date.
--
-- BYTE-IDENTICAL-PUBLISHED constraint: the timing series must not change for
-- completed history (≤ 2026-03-31). R70-B3 already EXCLUDED capture/unknown
-- from the added/DOM counts, so HOLDing those at ALL dates is byte-identical.
-- But om_lease_inference + NULL-source rows WERE counted by R70, so HOLDing
-- them pre-2026-04 would empty published months → those keep their date as
-- 'unestablished_historical' (low); only the surge window (≥ 2026-04-01) is
-- HELD. The genuinely-recovered date arrives later via the email/platform/SF
-- ladder (handed off — Gmail/CoStar/SF not reachable here; the artifact-path
-- date is itself a June ingest cluster, so it is NOT used as a proxy).
--
-- Additive + reversible: listing_date is untouched; DROP the 3 columns to
-- revert. Idempotent: only rows whose on_market_date_source IS NULL are set.
-- dia has NO listing_source column — the held set is keyed purely on
-- listing_date_source (dia synthetic rows carry 'synth_*' tags, which are
-- real-evidence and promoted, never held).
ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS on_market_date            date,
  ADD COLUMN IF NOT EXISTS on_market_date_source     text,
  ADD COLUMN IF NOT EXISTS on_market_date_confidence text;

-- 1. Clock-fallback sources (capture/unknown) → HELD at ALL dates.
--    R70 already excluded these from the timing series, so this is byte-identical.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND listing_date_source IN ('capture_date_fallback','date_unknown','date_unknown_r70b34');

-- 2a. Artifact-dated set (om_lease_inference + NULL source) in the SURGE WINDOW
--     (≥ 2026-04-01) → HELD. This de-surges the new, unpublished edge.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL
  AND (listing_date_source = 'om_lease_inference' OR listing_date_source IS NULL)
  AND listing_date IS NOT NULL
  AND listing_date >= DATE '2026-04-01';

-- 2b. The SAME artifact-dated set BEFORE the surge window → KEEP the date
--     ('unestablished_historical', low) so published months ≤ 2026-03-31 are
--     byte-identical (R70 counted these).
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = 'unestablished_historical',
  on_market_date_confidence = 'low'
WHERE on_market_date_source IS NULL
  AND (listing_date_source = 'om_lease_inference' OR listing_date_source IS NULL)
  AND listing_date IS NOT NULL
  AND listing_date < DATE '2026-04-01';

-- 3. Promote real-evidence sources (the listing_date IS a real market signal).
--    Includes dia synthetic sale-anchored tags (kept at low confidence) and
--    master_curated (kept) — none of these are the held/clock set.
UPDATE public.available_listings SET
  on_market_date            = listing_date,
  on_market_date_source     = listing_date_source,
  on_market_date_confidence = CASE listing_date_source
    WHEN 'on_market_date'                              THEN 'high'
    WHEN 'costar_date_on_market'                       THEN 'high'
    WHEN 'costar_days_on_market'                       THEN 'medium'
    WHEN 'days_on_market'                              THEN 'medium'
    WHEN 'master_curated'                              THEN 'medium'
    WHEN 'sale_anchor_est_175'                         THEN 'low'
    WHEN 'synth_sale_minus_median_dom'                 THEN 'low'
    WHEN 'synth_sale_minus_median_dom_clamped_r70d10'  THEN 'low'
    ELSE 'low' END
WHERE on_market_date_source IS NULL
  AND listing_date_source IS NOT NULL
  AND listing_date_source NOT IN ('capture_date_fallback','date_unknown','date_unknown_r70b34','om_lease_inference')
  AND listing_date IS NOT NULL;

-- 4. Anything still unset (no date / no signal) → HELD.
UPDATE public.available_listings SET
  on_market_date            = NULL,
  on_market_date_source     = 'unestablished',
  on_market_date_confidence = 'none'
WHERE on_market_date_source IS NULL;

COMMENT ON COLUMN public.available_listings.on_market_date IS
  'T4c: market-entry date for the timing/DOM series. NULL = HELD (no evidence; excluded from added-per-month + DOM). Never the processing clock.';
COMMENT ON COLUMN public.available_listings.on_market_date_source IS
  'T4c provenance: on_market_date / costar_date_on_market / costar_days_on_market / days_on_market / sale_anchor / synth_* / master_curated / unestablished_historical / unestablished (held).';
COMMENT ON COLUMN public.available_listings.on_market_date_confidence IS
  'T4c confidence: high | medium | low | none (none == HELD/null).';
