-- ============================================================================
-- Prompt 78 (W8 U4 PGRST204 schema-drift): dia.lease_escalations CoStar band
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL, zqzrriwuavgrquhisnoa)
--
-- upsertLeaseEscalations (sidebar-pipeline.js) captures a CoStar ESTIMATED rent
-- BAND (low/high/mid PSF + expense structure + source) but lease_escalations had
-- NONE of those columns, so every write 400'd on the first missing one reported
-- by PostgREST (data_source; dia 121 / 30d). These fields SHOULD exist for the
-- CoStar-estimate feature. Additive, safe to re-run.
-- ============================================================================
ALTER TABLE public.lease_escalations
  ADD COLUMN IF NOT EXISTS rent_low_psf      NUMERIC,
  ADD COLUMN IF NOT EXISTS rent_high_psf     NUMERIC,
  ADD COLUMN IF NOT EXISTS rent_estimate_psf NUMERIC,
  ADD COLUMN IF NOT EXISTS expense_structure TEXT,
  ADD COLUMN IF NOT EXISTS escalation_source TEXT,
  ADD COLUMN IF NOT EXISTS data_source       TEXT;
COMMENT ON COLUMN public.lease_escalations.data_source IS
  'Ingestion channel for CoStar rent-band estimate rows (costar_sidebar). See sidebar-pipeline.js::upsertLeaseEscalations.';
