-- ============================================================================
-- Phase 2 Slice 2a — field_source_priority rows for 'folder_feed_properties'
-- 2026-06-10 (PROPERTIES enrich-read channel)
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The PROPERTIES enrich channel patches blank fields on an EXISTING property
-- (fill-blanks-only) and records field_provenance for each touched field under
-- source='folder_feed_properties'. Without a priority entry the provenance rows
-- land "unranked" (surfaced by v_field_provenance_unranked as schema drift).
-- This migration registers the source for every property/document field the
-- enrich path can write.
--
-- Priority band: 50 — secondary trusted, parallel to 'om_extraction'. These
-- files ARE our own offering memoranda / flyers (same evidence grade as an OM
-- emailed in), just sourced from the Team Briggs PROPERTIES tree. Below
-- manual_edit (1) / lease_document (10) / county records, above CoStar (60+).
-- All entries default to enforce_mode='record_only' (set on the table) so this
-- is observation-only — the enrich UPDATEs run unchanged.
--
-- Idempotent: ON CONFLICT on the registry's unique (target_table, field_name,
-- source) key. Additive; safe to re-apply.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  -- ── gov.properties (promotePropertyFinancials fill-blanks set) ────────────
  ('gov.properties', 'noi',          'folder_feed_properties', 50, 0.5, 'PROPERTIES enrich channel — OM/flyer from Team Briggs tree.'),
  ('gov.properties', 'gross_rent',   'folder_feed_properties', 50, 0.5, null),
  ('gov.properties', 'year_built',   'folder_feed_properties', 50, 0.5, null),
  ('gov.properties', 'land_acres',   'folder_feed_properties', 50, 0.5, null),
  ('gov.properties', 'rba',          'folder_feed_properties', 50, 0.5, null),

  -- ── dia.properties (promoteDiaPropertyFromOm fill-blanks set) ─────────────
  ('dia.properties', 'tenant',             'folder_feed_properties', 50, 0.5, 'PROPERTIES enrich channel — OM/flyer from Team Briggs tree.'),
  ('dia.properties', 'year_built',         'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'parcel_number',      'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'lot_sf',             'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'building_size',      'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'land_area',          'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'lease_commencement', 'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'anchor_rent',        'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'anchor_rent_date',   'folder_feed_properties', 50, 0.5, null),
  ('dia.properties', 'anchor_rent_source', 'folder_feed_properties', 50, 0.5, null),

  -- ── property_documents (doc attach: file_name / document_type / source_url) ─
  ('gov.property_documents', 'file_name',     'folder_feed_properties', 50, null, 'PROPERTIES enrich channel doc attach.'),
  ('gov.property_documents', 'document_type', 'folder_feed_properties', 50, null, null),
  ('gov.property_documents', 'source_url',    'folder_feed_properties', 50, null, null),
  ('dia.property_documents', 'file_name',     'folder_feed_properties', 50, null, 'PROPERTIES enrich channel doc attach.'),
  ('dia.property_documents', 'document_type', 'folder_feed_properties', 50, null, null),
  ('dia.property_documents', 'source_url',    'folder_feed_properties', 50, null, null)
ON CONFLICT (target_table, field_name, source) DO NOTHING;
