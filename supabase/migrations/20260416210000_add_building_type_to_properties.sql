-- ============================================================================
-- Migration: properties.building_type column
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- Problem:
--   api/_handlers/sidebar-pipeline.js writes building_type via
--   classifyBuildingType(), detail.js renders it via _rowEditable, and
--   dialysis.js::loadDiaSalesCompsFromTxns embeds it in the
--   sales_transactions PostgREST query. The column was never added to
--   properties, so the embed failed and Sales Comps showed 0 rows.
-- ============================================================================

ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS building_type TEXT;

COMMENT ON COLUMN public.properties.building_type IS
    'Classified building type (e.g. "Medical Office - Dialysis Clinic"). Populated by classifyBuildingType() in api/_handlers/sidebar-pipeline.js.';
