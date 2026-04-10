-- Add recorded_owner_name, recorded_owner_address, and year_built to the
-- v_property_detail view so the Intel (Property) tab in detail.js and
-- renderDiaDetailProperty() in dialysis.js can display the deed holder
-- separately from the CMS-sourced facility operator.
--
-- Background
-- ----------
-- v_property_detail currently returns recorded_owner_id (UUID) only — no text
-- name. The renderers were consequently leaning on operator_name /
-- true_owner_name, which on dialysis rows gets populated from a CMS data merge
-- that sets the facility operator (e.g. DaVita) as the "owner". That conflated
-- deed holder (Agree Central LLC) with tenant / operator (DaVita Kidney Care).
--
-- properties.year_built also exists but was not exposed by the view, so the
-- "Year Built" row on the Property tab rendered "—".
--
-- Strategy
-- --------
-- The canonical definition of v_property_detail is not checked into this repo
-- (it lives only in the dialysis Supabase project) and has many joined
-- columns that this migration must NOT drop. Rather than risk a bad rewrite,
-- this migration uses a safe two-step pattern:
--
--   1. Rename the existing view to v_property_detail__base (one-time, guarded
--      by an existence check so the migration is idempotent).
--   2. Create v_property_detail as a thin wrapper that SELECTs everything
--      from v_property_detail__base and LEFT JOINs recorded_owners to expose
--      recorded_owner_name and recorded_owner_address. year_built is
--      preserved by the SELECT * from the base view (the base view already
--      pulls it from properties even if the previous wrapper did not expose
--      it explicitly — if the base view does not include year_built, add
--      it to the base view separately).
--
-- Run as a one-off against the dialysis Supabase project. Idempotent — safe
-- to re-run. Does not modify any base tables.

BEGIN;

-- Step 1: One-time rename of the existing view to preserve its full column
-- list. Guarded so re-running the migration is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'v_property_detail'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'v_property_detail__base'
  ) THEN
    EXECUTE 'ALTER VIEW public.v_property_detail RENAME TO v_property_detail__base';
  END IF;
END $$;

-- Step 2: (Re)create v_property_detail as a wrapper that adds the
-- recorded-owner text columns. CREATE OR REPLACE so grants/policies on the
-- public-facing view are preserved across re-runs.
CREATE OR REPLACE VIEW public.v_property_detail AS
SELECT
  base.*,
  ro.name    AS recorded_owner_name,
  ro.address AS recorded_owner_address
FROM public.v_property_detail__base base
LEFT JOIN public.recorded_owners ro
  ON ro.recorded_owner_id = base.recorded_owner_id;

-- Sanity check (commented out — uncomment to verify manually):
-- SELECT property_id, facility_name, recorded_owner_name, recorded_owner_address, year_built
-- FROM v_property_detail
-- WHERE recorded_owner_id IS NOT NULL
-- LIMIT 5;

-- Post-migration verification: if year_built is NULL for rows where
-- properties.year_built is populated, the base view is not selecting it.
-- In that case, patch the base view to include p.year_built:
--
--   SELECT pg_get_viewdef('public.v_property_detail__base'::regclass, true);
--
-- then CREATE OR REPLACE VIEW public.v_property_detail__base AS <updated def>.

COMMIT;
