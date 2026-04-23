-- ============================================================================
-- Migration: add intake_artifact_path + intake_artifact_type to available_listings
-- Target:    BOTH government + dialysis domain Supabases
--            (apply via Supabase Studio on each project individually)
--
-- Gives the dashboard a one-click path to the PDF that seeded the listing.
-- intake_artifact_path is a Supabase Storage object path (e.g.
-- "lcc-om-uploads/2026-04-23/UUID-filename.pdf"); the UI calls
-- /api/intake/artifact?storage_path=... to mint a signed download URL.
-- ============================================================================

ALTER TABLE public.available_listings
  ADD COLUMN IF NOT EXISTS intake_artifact_path TEXT,
  ADD COLUMN IF NOT EXISTS intake_artifact_type TEXT;

COMMENT ON COLUMN public.available_listings.intake_artifact_path IS
  'Supabase Storage path to the PDF/document that seeded this listing (OM/flyer/marketing brochure). Use /api/intake/artifact?storage_path=X to mint a signed download URL.';
COMMENT ON COLUMN public.available_listings.intake_artifact_type IS
  'Document type captured during intake: om | flyer | marketing_brochure | comp | lease_abstract';
