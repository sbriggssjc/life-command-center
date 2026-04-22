-- ============================================================================
-- Migration: unique index on available_listings.source_listing_ref
-- Target:    Government domain Supabase (GOV_SUPABASE_URL)
--
-- Enables PostgREST upsert via on_conflict=source_listing_ref. Used by
-- /api/_handlers/intake-promoter.js when promoting matched OM intakes
-- into gov.available_listings — re-extracts of the same intake should
-- update the same listing row instead of creating duplicates.
--
-- Partial index so legacy rows (source_listing_ref IS NULL from
-- costar_sidebar / excel_master / manual paths) don't conflict with the
-- intake-driven entries.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_available_listings_source_ref
    ON public.available_listings (source_listing_ref)
    WHERE source_listing_ref IS NOT NULL;
