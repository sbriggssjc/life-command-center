-- ============================================================================
-- Migration: add parcel_number column to dialysis.properties
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Why: OMs reliably state the county tax assessor's parcel number (APN),
--      and that number is the canonical join key into county tax records,
--      mortgage data, and ownership reconciliation. Until now there was
--      nowhere to store it on dialysis.properties, so the intake-promoter's
--      promoteDiaPropertyFromOm helper dropped the field on the floor
--      (audit 2026-04-25). Adding the column closes that gap; the
--      promoter then fills it on next OM ingest, and downstream readers
--      (tax_records, county_mortgage joins) can use it as the join key.
--
-- Distinct from:
--   - medicare_id (CMS facility identifier — clinical/quality data)
--   - assessed_owner (recorded title-holder name)
--   - property_id (LCC surrogate primary key)
--
-- Index is partial (only NOT NULL rows) since most rows will be NULL
-- until backfilled and per-county lookups are exact-match.
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS parcel_number text;

CREATE INDEX IF NOT EXISTS idx_properties_parcel_number
  ON public.properties (parcel_number)
  WHERE parcel_number IS NOT NULL;

COMMENT ON COLUMN public.properties.parcel_number IS
  'County tax assessor parcel number (APN). Populated from OM intake or
   assessor-record reconciliation. Distinct from medicare_id (CMS
   facility), assessed_owner (recorded title-holder), and property_id
   (LCC surrogate).';
