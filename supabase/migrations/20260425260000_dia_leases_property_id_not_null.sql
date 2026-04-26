-- ============================================================================
-- Migration: enforce NOT NULL on dia.leases.property_id
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Audit 2026-04-26 found 356 orphan lease rows with property_id IS NULL —
-- placeholder/junk data with rent=0, lease_start=2000-01-01, no source.
-- These rows have no FK target and serve no purpose. Cleaned up via:
--
--   UPDATE leases SET is_active=false WHERE property_id IS NULL;  -- 174 rows
--   DELETE FROM leases WHERE property_id IS NULL;                 -- 356 rows
--
-- Then this migration adds NOT NULL to prevent future orphan inserts.
-- ============================================================================

ALTER TABLE public.leases
  ALTER COLUMN property_id SET NOT NULL;

COMMENT ON COLUMN public.leases.property_id IS
  'FK to properties.property_id. Required (NOT NULL). Orphan leases without
   a property reference are not allowed — every lease must attach to a
   physical property record. 356 such orphans were cleaned up 2026-04-26.';
