-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- B8 (2026-05-27): mirror of the dia migration. Per-status SF-link queue
-- count for the Domain Health Summary tile.
CREATE OR REPLACE VIEW public.v_sf_link_queue_summary AS
SELECT status, count(*)::int AS n
FROM public.sf_link_research_queue
GROUP BY status;
