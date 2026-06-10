-- ============================================================================
-- Phase 2 Slice 2b — field_source_priority rows for 'lcc_generated'
-- 2026-06-10 (LCC deliverable write-back → property folders)
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The property-doc write-back channel writes an LCC-authored deliverable (BOV /
-- OM / client memo / master sheet) into the matched property's SharePoint
-- folder and links it via a <domain>.property_documents row, recording
-- field_provenance for the attach under source='lcc_generated'. Without a
-- priority entry those provenance rows land "unranked" (surfaced by
-- v_field_provenance_unranked as schema drift). This registers the source for
-- every property_documents field the write-back path writes.
--
-- Priority band: 1 — TOP of the ladder. These files ARE our own authoritative
-- work product (we generated them), so they outrank every captured/extracted
-- source (manual_edit=1 peer; om_extraction=30; folder_feed_properties=50;
-- CoStar=60+). enforce_mode defaults to 'record_only' (table default) so this is
-- observation-only — the write-back INSERTs run unchanged.
--
-- Idempotent: ON CONFLICT on the registry's unique (target_table, field_name,
-- source) key. Additive; safe to re-apply.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('gov.property_documents', 'file_name',     'lcc_generated', 1, null, 'LCC deliverable write-back — our own authoritative work product.'),
  ('gov.property_documents', 'document_type', 'lcc_generated', 1, null, null),
  ('gov.property_documents', 'source_url',    'lcc_generated', 1, null, null),
  ('dia.property_documents', 'file_name',     'lcc_generated', 1, null, 'LCC deliverable write-back — our own authoritative work product.'),
  ('dia.property_documents', 'document_type', 'lcc_generated', 1, null, null),
  ('dia.property_documents', 'source_url',    'lcc_generated', 1, null, null)
ON CONFLICT (target_table, field_name, source) DO NOTHING;
