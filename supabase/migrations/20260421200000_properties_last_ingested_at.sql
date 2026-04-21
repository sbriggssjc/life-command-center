-- ============================================================================
-- Migration: properties.last_ingested_at (dialysis domain)
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- Problem:
--   sidebar-pipeline's propagateToDomainDbDirect stamps
--   properties.last_ingested_at = now() at the end of every run so ops
--   can audit when CoStar last refreshed a property. The gov properties
--   table already has this column (sql/20260304_initial_schema.sql:77),
--   but the dialysis table did not. Without the column the PATCH silently
--   fails at PostgREST with a 400 and the pipeline logs a non-fatal error.
-- ============================================================================

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.properties.last_ingested_at IS
    'Wall-clock timestamp of the most recent CoStar sidebar ingest for this property. Stamped by api/_handlers/sidebar-pipeline.js::propagateToDomainDbDirect.';

CREATE INDEX IF NOT EXISTS idx_properties_last_ingested_at
    ON public.properties (last_ingested_at DESC NULLS LAST);
