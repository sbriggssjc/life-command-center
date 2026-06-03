-- ===========================================================================
-- Round: void the mis-anchored DaVita marketing lead (dia property 26502)
-- DB: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date: 2026-06-03
--
-- Companion to the LCC Opps cleanup (20260603140000_lcc_create_lead_idempotence
-- _and_davita_cleanup.sql). The live BD-loop test created a marketing_leads row
-- for dia property 26502 (4145 Cass Ave) anchored to the OPERATOR — lead_name
-- "DaVita Inc." — when BD outreach targets the LANDLORD (Palestra Properties,
-- which create_lead correctly captured into lead_company).
--
-- Disposition: void the row (rather than rename it in place) and let the fixed
-- property flow re-create a clean landlord-anchored lead. Voiding avoids a
-- duplicate Palestra lead later — the create_lead idempotence guard dedupes BD
-- opportunities per entity, but not marketing_leads rows, so a left-behind
-- renamed row plus a fresh re-created one would double up. With the row voided,
-- one click through the fixed flow produces exactly one correct lead +
-- opportunity + cadence.
--
-- Idempotent: the status <> 'void' guard makes a re-run a no-op.
-- ===========================================================================

UPDATE public.marketing_leads
SET status = 'void',
    notes  = COALESCE(notes || E'\n', '')
             || 'voided 2026-06-03 (Bug a): mis-anchored to operator DaVita instead of '
             || 'landlord Palestra Properties; re-create via the fixed property flow.'
WHERE source           = 'property_flow'
  AND lead_name        = 'DaVita Inc.'
  AND lead_company     = 'Palestra Properties'
  AND property_address = '4145 Cass Ave'
  AND status <> 'void';
