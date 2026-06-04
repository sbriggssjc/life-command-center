-- Migration: dia available_listings — Round 68-A provenance columns
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- Round 68 batch 2 (R68-A) — listing-side data depth. Two new provenance
-- columns on available_listings, required by:
--   * Task 1 (go-forward capture fix): listing_date_source tags WHERE a
--     re-dated listing_date came from. The availability-checker writes
--     'page_marker' when a CREXi/CoStar/LoopNet page exposes a marketing-
--     start marker ("Listed on" / "Time on Market" / "Days on Market") that
--     predates the stored listing_date by > 30 days. The sidebar writes
--     'costar_date_on_market' when CoStar's "Date on Market" field is present
--     at capture time. Existing rows stay NULL (capture date, unknown origin).
--   * Task 2 (synthesis): data_source='synthetic_from_sale' distinguishes the
--     price-less listing rows synthesized from unlinked sold deals so the view
--     layer can INCLUDE them in active-universe/turnover counts while EXCLUDING
--     them from every price/DOM/cap chart. See the companion migration
--     20260605_cm_round68a_synthetic_listing_views.sql and
--     docs/round68a/R68A_VIEW_MATRIX.md.
--
-- DDL only — no row writes. Safe to apply ahead of the synthesis bulk insert
-- (which runs dry-run -> --commit from a workstation, NOT in a migration).

ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS data_source        text,
  ADD COLUMN IF NOT EXISTS listing_date_source text;

COMMENT ON COLUMN public.available_listings.data_source IS
  'Origin tag for the listing row. NULL = legacy/organic capture. '
  '''synthetic_from_sale'' = Round 68-A row synthesized from an unlinked sold '
  'deal (price-less; INCLUDED in count/universe views, EXCLUDED from price/DOM/cap views).';

COMMENT ON COLUMN public.available_listings.listing_date_source IS
  'Provenance of listing_date. NULL = capture/import date (origin unknown). '
  '''page_marker'' = recovered from a CREXi/CoStar/LoopNet marketing-start marker '
  'by the availability-checker. ''costar_date_on_market'' = sidebar capture of '
  'CoStar Date on Market. ''synth_sale_minus_median_dom'' = Task 2 imputation '
  '(sale_date minus the linked-cohort median days-on-market).';

-- Partial index so the synthetic exclude/include guards in the chart views
-- stay cheap. Only the ~1.6k synthetic rows are indexed; legacy rows (NULL)
-- are not, keeping the index tiny.
CREATE INDEX IF NOT EXISTS idx_available_listings_data_source
  ON public.available_listings (data_source)
  WHERE data_source IS NOT NULL;
