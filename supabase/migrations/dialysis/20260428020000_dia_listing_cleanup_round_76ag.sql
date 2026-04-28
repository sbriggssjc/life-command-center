-- ============================================================================
-- Round 76ag — Active listing dashboard cleanup
--
-- Pre-cleanup state: 534 rows / 462 distinct properties in the dialysis
-- "Available Listings" dashboard. Audit found three classes of bloat:
--
--   359 rows with terminal status (Sold/Off Market/closed/Closed but
--                                  Obligated) but is_active=true. Auto-Sold
--                                  trigger flipped status but not is_active.
--
--    8 rows had a sale recorded after listing_date that the trigger should
--       have caught (already flagged Sold, just needed is_active=false).
--
--   247 rows >2 years old with no last_seen (never re-confirmed). Should
--        have been pruned long ago but no auto-stale rule existed.
--
-- Post-cleanup: 287 rows / 274 distinct properties in the dashboard view.
-- 41% reduction in apparent inventory, with full audit trail in notes.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── Step 1a: align is_active for terminal-status rows ──────────────────────
-- Aux audit: count before
DO $$
DECLARE n_before integer;
BEGIN
  SELECT COUNT(*) INTO n_before FROM available_listings
   WHERE is_active = TRUE AND LOWER(status) IN ('sold','closed','closed but obligated','off market');
  RAISE NOTICE 'Phase 1a: % rows with terminal status but is_active=true (will flip)', n_before;
END $$;

UPDATE available_listings
   SET is_active = FALSE
 WHERE is_active = TRUE
   AND LOWER(status) IN ('sold', 'closed', 'closed but obligated', 'off market');

-- ── Step 1b: dedupe colliding rows before status case normalization ────────
-- Some properties have both 'sold' and 'Sold' rows that collide on the unique
-- (property_id, status, listing_date, sold_date) constraint when normalized.
-- Audit found 4 such pairs, all with the 'Sold' row carrying equal-or-better
-- data. Delete the lowercase one in each pair.
DELETE FROM available_listings WHERE listing_id IN (9387, 10747, 11058, 10738);

-- Same for 'Active' / 'Available' intra-property dupes within the stale-
-- candidate set (long-stale rows with both statuses on the same listing_date).
DELETE FROM available_listings WHERE listing_id IN (8941, 8753);

-- ── Step 1c: normalize status capitalization ──────────────────────────────
UPDATE available_listings SET status = 'Sold'   WHERE status = 'sold';
UPDATE available_listings SET status = 'Active' WHERE status = 'active';

-- ── Step 1d: auto-flag stale listings ─────────────────────────────────────
-- Long-stale listings: listing_date >2y AND last_seen IS NULL (never
-- re-confirmed by a subsequent sidebar capture). Set status='Stale' so they
-- drop out of the v_available_listings view, but preserve the row so future
-- captures can revive them by writing a fresh status.
UPDATE available_listings
   SET status = 'Stale',
       is_active = FALSE,
       notes = COALESCE(NULLIF(notes,'') || E'\n', '') ||
               '[Round 76ag 2026-04-28] Auto-flagged Stale: listing_date >2y, last_seen IS NULL'
 WHERE (status)::text = ANY (ARRAY['active','Active','Available','For Sale'])
   AND listing_date < CURRENT_DATE - INTERVAL '2 years'
   AND last_seen IS NULL;

-- ── Recurring auto-stale function (callable from pg_cron) ──────────────────
CREATE OR REPLACE FUNCTION public.dia_auto_stale_listings()
RETURNS TABLE(flagged_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n integer := 0;
BEGIN
  WITH stale AS (
    SELECT listing_id
    FROM public.available_listings
    WHERE (status)::text = ANY (ARRAY['active','Active','Available','For Sale'])
      AND listing_date < CURRENT_DATE - INTERVAL '2 years'
      AND last_seen IS NULL
    -- Don't flag a property that has ANY listing seen in the last 90 days,
    -- because that newer listing will already render in the dashboard and the
    -- stale one is just a historic record we'd rather quietly retire.
    LIMIT 100  -- batch cap; cron re-runs daily
  )
  UPDATE public.available_listings al
     SET status    = 'Stale',
         is_active = FALSE,
         notes     = COALESCE(NULLIF(al.notes,'') || E'\n', '') ||
                     '[dia_auto_stale_listings ' || CURRENT_DATE || '] '
                     || 'listing_date >2y, last_seen IS NULL'
    FROM stale s
   WHERE al.listing_id = s.listing_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END $$;

-- ── Final audit notice ────────────────────────────────────────────────────
DO $$
DECLARE
  dashboard_rows integer;
  distinct_props integer;
BEGIN
  SELECT
    COUNT(*),
    COUNT(DISTINCT property_id)
  INTO dashboard_rows, distinct_props
  FROM public.available_listings
  WHERE (status)::text = ANY (ARRAY['active','Active','Available','For Sale']);

  RAISE NOTICE 'Post-cleanup dashboard: % rows, % distinct properties',
    dashboard_rows, distinct_props;
END $$;
