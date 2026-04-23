-- ============================================================================
-- Migration: collapse duplicate rows in dia.available_listings + add a partial
--            unique index.
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Context (2026-04-23): dia.available_listings has NO unique constraint beyond
-- the PK. Every re-ingestion (CoStar sidebar, Salesforce Ascendix importer,
-- Crexi scraper) writes a fresh row. Dry-run reports 128 dupe groups / 248
-- rows out of 2,986 (~8%). Property 22084 has 10 "Sold" rows for the same
-- date; property 13900 has 8 null-status rows.
--
-- Note: dia.available_listings has no `listing_source` column (unlike gov).
-- The dedup key is (property_id, status, listing_date, sold_date).
-- ============================================================================

-- 1. Collapse existing dupes. Keep highest listing_id (most recent insert
--    since it's auto-incrementing) per (property_id, status, listing_date,
--    sold_date) group. Defaults fill NULLs so grouping works deterministically.
WITH ranked AS (
  SELECT listing_id,
         row_number() OVER (
           PARTITION BY property_id,
                        COALESCE(status, ''),
                        COALESCE(listing_date, DATE '1900-01-01'),
                        COALESCE(sold_date,    DATE '1900-01-01')
           ORDER BY created_at DESC NULLS LAST, listing_id DESC
         ) AS rn
  FROM public.available_listings
  WHERE property_id IS NOT NULL
)
DELETE FROM public.available_listings
 WHERE listing_id IN (SELECT listing_id FROM ranked WHERE rn > 1);

-- 2. Partial unique index matching the cleanup key. NULL-coalesce via COALESCE
--    expressions so rows missing status/listing_date still dedup at the same
--    "empty" slot instead of bypassing the constraint.
DROP INDEX IF EXISTS public.available_listings_property_status_dates_uniq;
CREATE UNIQUE INDEX available_listings_property_status_dates_uniq
  ON public.available_listings (
       property_id,
       (COALESCE(status, '')),
       (COALESCE(listing_date, DATE '1900-01-01')),
       (COALESCE(sold_date,    DATE '1900-01-01'))
     )
  WHERE property_id IS NOT NULL;

COMMENT ON INDEX public.available_listings_property_status_dates_uniq IS
  'Dedup key for dia listing writes. Callers should upsert via on_conflict=property_id,status,listing_date,sold_date (or, via PostgREST, reach this via a trigger-style check-then-update — expression-based upserts are PostgREST-unsafe). Added 2026-04-23.';
