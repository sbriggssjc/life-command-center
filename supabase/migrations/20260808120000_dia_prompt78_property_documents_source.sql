-- ============================================================================
-- Prompt 78 (W8 U4 PGRST204 schema-drift): dia.property_documents.source
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL, zqzrriwuavgrquhisnoa)
--
-- attachEnrichDocument (intake-promoter.js) + insertLccDocument
-- (property-doc-writeback.js) send `source` (the authoritative capture channel:
-- folder_feed_enrich | lcc_generated | folder_feed_properties) as their
-- PREFERRED payload, then gracefully degrade to a source-less payload. The
-- degrade lands the doc but logs a PGRST204 on EVERY attach (dia 3,500 / 30d).
-- Adding the column makes the preferred write succeed and lands the channel.
-- Additive, safe to re-run.
-- ============================================================================
ALTER TABLE public.property_documents ADD COLUMN IF NOT EXISTS source TEXT;
COMMENT ON COLUMN public.property_documents.source IS
  'Authoritative capture channel for this doc row (folder_feed_enrich | lcc_generated | folder_feed_properties). Written by intake-promoter.js::attachEnrichDocument and property-doc-writeback.js::insertLccDocument.';
