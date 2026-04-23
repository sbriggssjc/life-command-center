-- ============================================================================
-- Migration: collapse duplicate rows in gov.available_listings + prevent future
--            dupes by adding a compound partial unique index.
--
-- Target:    government Supabase (GOV_SUPABASE_URL)
--
-- Context (2026-04-23): the CoStar sidebar write path (sidebar-pipeline.js
-- upsertGovListings) auto-closes its own row to "Sold" when a recent sale is
-- found, then the NEXT sidebar hit for the same property sees no Active row
-- and falls through to an INSERT. Repeating this per user click produces N
-- identical Sold rows for one property (e.g. 6800 Burleson Rd has 3, 181
-- Dozier St has 3). source_listing_ref is NULL for sidebar writes so the
-- existing UNIQUE(source_listing_ref, listing_source) doesn't catch it.
--
-- This migration:
--   1. Collapses existing dupe groups — keeps the newest first_seen_at per
--      (property_id, listing_source, listing_status, listing_date) tuple,
--      deletes older siblings.
--   2. Adds a partial unique index on the same tuple so future writes are
--      forced into upsert territory (caller must use on_conflict).
-- ============================================================================

-- 1. Dry-run sanity: the dup-group dry-run earlier reported 5 groups / 8 rows.
--    If that count changed drastically since the dry-run, re-check before
--    running this migration in production.

-- 2. Collapse existing dupes. For each group, keep the latest first_seen_at;
--    delete the rest. Uses row_number() for deterministic selection.
WITH ranked AS (
  SELECT listing_id,
         row_number() OVER (
           PARTITION BY property_id, listing_source, listing_status, listing_date
           ORDER BY first_seen_at DESC NULLS LAST, created_at DESC NULLS LAST, listing_id DESC
         ) AS rn
  FROM public.available_listings
  WHERE property_id IS NOT NULL
    AND listing_source IS NOT NULL
    AND listing_status IS NOT NULL
    AND listing_date IS NOT NULL
)
DELETE FROM public.available_listings
 WHERE listing_id IN (SELECT listing_id FROM ranked WHERE rn > 1);

-- 3. Prevent future dupes. The partial index targets the exact same key used
--    by the cleanup delete. NULL rows are excluded from the unique constraint
--    so legacy/edge-case inserts that lack one of these fields don't error.
--    PostgREST can now upsert via on_conflict=property_id,listing_source,
--    listing_status,listing_date.
DROP INDEX IF EXISTS public.available_listings_property_source_status_date_uniq;
CREATE UNIQUE INDEX available_listings_property_source_status_date_uniq
  ON public.available_listings (property_id, listing_source, listing_status, listing_date)
  WHERE property_id IS NOT NULL
    AND listing_source IS NOT NULL
    AND listing_status IS NOT NULL
    AND listing_date IS NOT NULL;

COMMENT ON INDEX public.available_listings_property_source_status_date_uniq IS
  'Dedup key for listing writes that lack a source_listing_ref (e.g. CoStar sidebar). Callers should upsert via on_conflict=property_id,listing_source,listing_status,listing_date. Added 2026-04-23.';
