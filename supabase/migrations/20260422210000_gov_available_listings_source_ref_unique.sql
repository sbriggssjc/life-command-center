-- ============================================================================
-- Migration: unique index on available_listings.source_listing_ref
-- Target:    Government domain Supabase (GOV_SUPABASE_URL)
--
-- Enables PostgREST upsert via on_conflict=source_listing_ref. Used by
-- /api/_handlers/intake-promoter.js when promoting matched OM intakes
-- into gov.available_listings — re-extracts of the same intake should
-- update the same listing row instead of creating duplicates.
--
-- IMPORTANT: full (non-partial) unique index. Partial indexes with a
-- WHERE predicate cannot be used as ON CONFLICT targets when PostgREST
-- specifies columns via on_conflict=source_listing_ref. Standard SQL
-- treats multiple NULL values as distinct, so legacy rows with NULL
-- source_listing_ref (from costar_sidebar / excel_master / manual paths)
-- coexist without conflict.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_available_listings_source_ref
    ON public.available_listings (source_listing_ref);
