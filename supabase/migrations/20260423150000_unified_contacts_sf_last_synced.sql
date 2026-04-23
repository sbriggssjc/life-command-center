-- ============================================================================
-- Migration: add sf_last_synced to unified_contacts
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The domain-side tables (gov/dia contacts, true_owners, recorded_owners)
-- all carry sf_last_synced TIMESTAMPTZ. unified_contacts was missing it,
-- so the intake-promoter's SF-backfill PATCH was failing with
-- "column sf_last_synced does not exist". Align the schema.
-- ============================================================================

ALTER TABLE public.unified_contacts
  ADD COLUMN IF NOT EXISTS sf_last_synced TIMESTAMPTZ;

COMMENT ON COLUMN public.unified_contacts.sf_last_synced IS
  'Timestamp of last SF sync for this row. Mirrors gov/dia contacts.sf_last_synced.';
