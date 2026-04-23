-- ============================================================================
-- Migration: RPC helper so the Vercel service-role key can REFRESH the gov
--            v_available_listings materialized view via PostgREST.
--
-- Target:    government Supabase (GOV_SUPABASE_URL)
--
-- Why: REFRESH MATERIALIZED VIEW cannot be called via raw PostgREST
-- (materialized view ops aren't part of the exposed SQL surface). Exposing
-- a SECURITY DEFINER function gives callers with the anon/service role a
-- safe, scoped way to trigger the refresh.
--
-- Concurrency: the view has a unique index on listing_id (added 2026-04-23),
-- so REFRESH MATERIALIZED VIEW CONCURRENTLY works — it doesn't block reads
-- against the dashboard while refreshing. If for some reason CONCURRENTLY
-- isn't eligible (index missing, view empty, etc), we fall back to a
-- blocking REFRESH so the call still succeeds.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_refresh_available_listings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_available_listings;
  EXCEPTION
    WHEN OTHERS THEN
      -- CONCURRENTLY can error out if the view has never been populated
      -- with a unique index available. Fall back to the blocking form so
      -- callers (intake-promoter) don't surface a refresh error.
      REFRESH MATERIALIZED VIEW public.v_available_listings;
  END;
END;
$$;

-- Grant to the roles PostgREST uses so the intake-promoter service role
-- can call it. anon is included for symmetry with other LCC RPCs.
GRANT EXECUTE ON FUNCTION public.lcc_refresh_available_listings() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.lcc_refresh_available_listings IS
  'Refresh v_available_listings materialized view. Called by the LCC intake-promoter after an OM is promoted so the gov dashboard Sales/Available tab reflects freshly enriched property/lease/listing data without waiting for the nightly cron.';
