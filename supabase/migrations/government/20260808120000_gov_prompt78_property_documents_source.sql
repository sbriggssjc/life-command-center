-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- Prompt 78 (W8 U4 PGRST204 schema-drift): gov.property_documents.source
-- Target: Government domain Supabase (GOV_SUPABASE_URL, scknotsqkcheojiaewwh)
--
-- Same writers as the dia arm (attachEnrichDocument / insertLccDocument), gov
-- side: 3,259 PGRST204 / 30d on the `source`-tagged preferred payload. Adding
-- the column makes the preferred write succeed and lands the channel.
-- Additive, safe to re-run.
-- ============================================================================
ALTER TABLE public.property_documents ADD COLUMN IF NOT EXISTS source TEXT;
COMMENT ON COLUMN public.property_documents.source IS
  'Authoritative capture channel for this doc row (folder_feed_enrich | lcc_generated | folder_feed_properties). Written by intake-promoter.js::attachEnrichDocument and property-doc-writeback.js::insertLccDocument.';
