-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- Migration: drop unused verification views (gov)
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Mirror of the dia migration. Both views were created speculatively in
-- Round 76cx but never wired up to a consumer:
--
--   - v_listings_due_for_verification (Phase 1)
--       Functionally dead. The lcc-auto-scrape-listings cron does its
--       own NULL-aware query against available_listings.
--
--   - v_listing_verification_detail (Phase 2)
--       No property-detail consumer exists. The dia equivalent of this
--       view was also never used.
--
-- Note on the summary view:
--   v_listing_verification_summary exists for gov but no UI panel reads
--   it (dia has the equivalent panel via dialysis.js
--   loadDiaVerificationSummary). The gov variant is kept here for
--   symmetry — wiring a gov panel is a separate change.
--
-- Re-running this migration is safe (DROP VIEW IF EXISTS).
-- ============================================================================

DROP VIEW IF EXISTS public.v_listings_due_for_verification;
DROP VIEW IF EXISTS public.v_listing_verification_detail;
