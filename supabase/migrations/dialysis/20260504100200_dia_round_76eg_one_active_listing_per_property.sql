-- ============================================================================
-- Round 76eg — Partial unique index: one active listing per property.
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Today's index (Round 76aj, 20260423210000) keys on
-- (property_id, status, listing_date, sold_date). That permits multiple
-- ACTIVE rows per property as long as their listing_date differs by even
-- one day — exactly the failure mode that produced four rows on Fresenius
-- New Iberia.
--
-- A property can have at most one active listing at a time in the real
-- world. Add a partial unique index that enforces this. Pre-cleanup
-- collapses any straggling multi-active rows that survived prior dedup
-- migrations (the consolidation function in 20260504100100 already
-- handles the post-sale case; this catches "two active rows, no sale yet"
-- which the consolidation function does not).
-- ============================================================================

-- Drop the legacy index first. It keys on (property_id, status,
-- listing_date, sold_date) and was meant to enforce dedup, but in
-- practice it permits multiple Active rows per property whenever
-- listing_date differs even by one day, AND it actively blocks
-- consolidation by raising 23505 when two rows would converge to the
-- same Sold key. The new partial unique index below replaces it for the
-- only invariant that actually holds: at most one active row per
-- property.
DROP INDEX IF EXISTS public.available_listings_property_status_dates_uniq;

-- Pre-cleanup: collapse any property with >1 active listing. Keep the row
-- with the earliest listing_date + most-complete data; supersede the rest.
DO $$
DECLARE
    n_collapsed integer := 0;
BEGIN
    WITH multi_active AS (
        SELECT property_id
          FROM public.available_listings
         WHERE COALESCE(is_active, FALSE) = TRUE
           AND property_id IS NOT NULL
         GROUP BY property_id
        HAVING count(*) > 1
    ),
    ranked AS (
        SELECT al.listing_id,
               al.property_id,
               ROW_NUMBER() OVER (
                   PARTITION BY al.property_id
                   ORDER BY
                       -- richer rows first
                       ((al.intake_artifact_path IS NOT NULL)::int * 4
                      + (al.listing_broker IS NOT NULL)::int * 2
                      + (al.last_price IS NOT NULL)::int
                      + (al.current_cap_rate IS NOT NULL)::int) DESC,
                       -- then earliest listing_date
                       al.listing_date ASC NULLS LAST,
                       al.listing_id ASC
               ) AS rn
          FROM public.available_listings al
          JOIN multi_active ma USING (property_id)
         WHERE COALESCE(al.is_active, FALSE) = TRUE
    )
    UPDATE public.available_listings al
       SET is_active                   = FALSE,
           status                      = 'Superseded',
           notes                       = COALESCE(NULLIF(notes,'') || E'\n','') ||
                                         '[Round 76eg one-active-pre-cleanup ' || CURRENT_DATE ||
                                         '] superseded: another active row exists for property_id=' ||
                                         al.property_id
      FROM ranked r
     WHERE al.listing_id = r.listing_id
       AND r.rn > 1;
    GET DIAGNOSTICS n_collapsed = ROW_COUNT;
    RAISE NOTICE 'Round 76eg one-active pre-cleanup: % rows superseded', n_collapsed;
END $$;

-- Partial unique index: at most one active listing per property
DROP INDEX IF EXISTS public.available_listings_one_active_per_property;
CREATE UNIQUE INDEX available_listings_one_active_per_property
    ON public.available_listings (property_id)
    WHERE is_active IS TRUE AND property_id IS NOT NULL;

COMMENT ON INDEX public.available_listings_one_active_per_property IS
    'Round 76eg: enforces one active listing per property in dia. Forces all ingestion paths (sidebar verify, OM intake, scraper) to upsert into the existing row. Added 2026-05-04.';
