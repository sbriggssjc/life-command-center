-- Phase 4 follow-up: register field_source_priority rules for the
-- dialysis auto-linker writers to dia.properties.medicare_id and
-- dia.medicare_clinics.property_id.
--
-- These writes happen today in dialysis.public via SQL functions
-- (apply_property_link_outcome, auto_link_*, auto_stub_*) that
-- don't route through lcc_merge_field. Without rules, they appeared
-- in v_field_provenance_unranked as schema drift. Registering the
-- rules documents the source taxonomy now so:
--   * v_field_provenance_unranked stays clean
--   * future ramp to warn/strict mode has the priorities pre-set
--
-- enforce_mode stays 'record_only' to match the rest of Phase 1/2.
-- Nothing changes about runtime behavior — the dialysis-side functions
-- still write directly. When enforce_mode flips to warn/strict for
-- these fields, those functions will need to either:
--   (a) cross-database RPC call to lcc_merge_field
--   (b) ingest from research_queue_outcomes via a periodic LCC-side job
-- Decision deferred until enforcement actually starts.
--
-- Priority bands (lower = higher trust):
--   20 — manual_verify (user explicit confirmation in LCC review queue)
--   30 — auto_link_exact_singleton, auto_link_orphan_property,
--        auto_relink_misrouted_lease (single exact address match,
--        no ambiguity)
--   50 — sidebar_inline_match (CoStar sidebar inline auto-link)
--   60 — auto_link_high_confidence (fuzzy >= 0.90 with >= 0.10 gap)
--   90 — auto_stub_from_clinic (synthetic stub created from clinic
--        data when no property existed; lowest trust because we made
--        it up)

insert into public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
values
  ('dia.properties', 'medicare_id', 'manual_verify', 20, 0.95, 'record_only',
   'User explicit Confirm Link in LCC property review queue'),
  ('dia.properties', 'medicare_id', 'auto_link_exact_singleton', 30, 0.95, 'record_only',
   'Single exact-address match across medicare_clinics; no ambiguity'),
  ('dia.properties', 'medicare_id', 'auto_link_orphan_property', 30, 0.95, 'record_only',
   'Inverse direction: orphan property matched to single unlinked clinic'),
  ('dia.properties', 'medicare_id', 'auto_link_high_confidence', 60, 0.85, 'record_only',
   'Fuzzy address match >= 0.90 with >= 0.10 gap to second candidate'),
  ('dia.properties', 'medicare_id', 'auto_stub_from_clinic', 90, 0.50, 'record_only',
   'Synthetic property stub created from clinic record when no real property existed'),
  ('dia.properties', 'medicare_id', 'sidebar_inline_match', 50, 0.85, 'record_only',
   'CoStar sidebar inline auto-link via dia_find_clinic_by_address'),

  ('dia.medicare_clinics', 'property_id', 'manual_verify', 20, 0.95, 'record_only',
   'User explicit Confirm Link in LCC property review queue'),
  ('dia.medicare_clinics', 'property_id', 'auto_link_exact_singleton', 30, 0.95, 'record_only', NULL),
  ('dia.medicare_clinics', 'property_id', 'auto_link_orphan_property', 30, 0.95, 'record_only', NULL),
  ('dia.medicare_clinics', 'property_id', 'auto_link_high_confidence', 60, 0.85, 'record_only', NULL),
  ('dia.medicare_clinics', 'property_id', 'auto_stub_from_clinic', 90, 0.50, 'record_only', NULL),
  ('dia.medicare_clinics', 'property_id', 'sidebar_inline_match', 50, 0.85, 'record_only', NULL),

  ('dia.leases', 'property_id', 'auto_relink_misrouted_lease', 30, 0.95, 'record_only',
   'Lease moved from duplicate property row to canonical property after dupe-pair merge')
on conflict (target_table, field_name, source) do nothing;
