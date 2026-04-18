-- ============================================================================
-- Migration: property_intel table (pipeline-stage tracker)
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- detail.js tracks broker pipeline stage per property via:
--   _udHydratePipelineStage() — reads property_intel.pipeline_stage
--   _udAdvancePipelineStage() — upserts property_intel with pipeline_stage
--                               and pipeline_stage_updated_at
-- The table never existed; the query returned 403 because property_intel is
-- not in the edge-function allowlist (and the table itself was missing).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.property_intel (
    property_id                INTEGER PRIMARY KEY,
    pipeline_stage             TEXT,
    pipeline_stage_updated_at  TIMESTAMPTZ,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_intel_stage
    ON public.property_intel (pipeline_stage);

ALTER TABLE public.property_intel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read property_intel" ON public.property_intel;
CREATE POLICY "Allow anon read property_intel" ON public.property_intel
    FOR SELECT TO anon USING (true);

GRANT SELECT ON public.property_intel TO anon;
