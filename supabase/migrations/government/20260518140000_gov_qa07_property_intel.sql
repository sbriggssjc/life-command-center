-- ============================================================================
-- QA-07 (2026-05-18): Mirror property_intel to the government domain.
--
-- The frontend's pipeline-stage feature in detail.js was written to work on
-- BOTH dia and gov properties — _udRenderPipelinePill, _udHydratePipelineStage,
-- and _udAdvancePipelineStage all dispatch by _udCache.db. But the original
-- property_intel migration (2026-04-16) only created the table on dia
-- (DIA_SUPABASE_URL). Calling govQuery('property_intel', …) on a gov property
-- returned 403 "Read access denied for table: property_intel" — the table is
-- not in GOV_READ_TABLES because it didn't exist on the gov database.
--
-- Effect today: clicking a pipeline-stage chip on a gov property silently
-- no-op'd the persist step. The in-memory pill update + SF opportunity
-- upsert still happened, but the stage was lost on the next page load.
--
-- Fix: create property_intel on gov mirroring the dia schema, with the same
-- RLS + anon read grant. Allowlist entries added in the same patch via
-- the Edge Function redeploy (v15).
--
-- Already applied to gov (scknotsqkcheojiaewwh) at 2026-05-18 via Supabase
-- MCP. This file commits the migration to the repo as the historical record.
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
GRANT SELECT, INSERT, UPDATE ON public.property_intel TO authenticated, service_role;
