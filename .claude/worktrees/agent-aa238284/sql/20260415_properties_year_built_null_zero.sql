-- Normalize properties.year_built: zero / non-positive values become NULL.
--
-- Problem
-- -------
-- The CoStar ingestion pipeline (extension/content/costar.js ->
-- api/_handlers/sidebar-pipeline.js) was storing 0 in properties.year_built
-- when CoStar's page omitted the Year Built field or rendered it as blank/"—".
-- parseIntSafe('0') returned 0 (not NULL), and stripNulls() only filters
-- null/undefined, so the zero was persisted. Downstream the Property sidebar
-- showed "YEAR BUILT: 0" (see 15002 Amargosa Rd, Victorville, CA — DaVita
-- Vista Del Sol Dialysis).
--
-- Strategy
-- --------
-- 1. Backfill: rewrite any existing 0 / negative year_built rows to NULL.
-- 2. Add a CHECK constraint that forbids non-positive values going forward.
--    We allow NULL (unknown) and reject 0 / negatives, so application code
--    must map blank/zero inputs to NULL before INSERT/UPDATE.
--
-- Idempotent — safe to re-run. Run against the LCC dialysis Supabase project
-- (and the government project if its `properties` table uses the same column).

BEGIN;

-- Step 1 — Backfill existing rows.
UPDATE public.properties
SET year_built = NULL
WHERE year_built IS NOT NULL
  AND year_built <= 0;

-- Step 2 — Defensive CHECK constraint. Rejects 0, negatives, and absurd
-- future years while permitting NULL (unknown). Guarded so the migration is
-- idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'properties_year_built_positive_chk'
      AND conrelid = 'public.properties'::regclass
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_year_built_positive_chk
      CHECK (year_built IS NULL OR (year_built BETWEEN 1600 AND 2100));
  END IF;
END $$;

-- Verification (commented out — uncomment to spot-check):
-- SELECT property_id, address, year_built
-- FROM public.properties
-- WHERE year_built IS NULL
--    OR year_built < 1800
-- ORDER BY updated_at DESC NULLS LAST
-- LIMIT 20;

COMMIT;
