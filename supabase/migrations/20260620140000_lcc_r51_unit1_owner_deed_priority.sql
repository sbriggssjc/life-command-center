-- R51 Unit 1 (2026-06-20): wire the recorded deed to outrank the aggregator for
-- the OWNER fields on gov.properties (mirror dia), and register the new
-- `recorded_deed` source on BOTH domains' properties owner fields so the Unit-2
-- forward propagation resolves deterministically through lcc_merge_field and
-- v_field_provenance_unranked stays at 0.
--
-- Grounded live 2026-06-20: gov.properties.recorded_owner_name had ONLY
-- costar_sidebar (60); gov.properties.recorded_owner_id had NO rule at all — so
-- a recorded deed grantee could never win the owner conflict and ~630-920 gov
-- properties show a stale / broker-as-owner recorded_owner vs latest_deed_grantee.
-- dia is already wired (county_records=10 beats costar) but lacked the explicit
-- recorded_deed source on the properties owner fields.
--
-- Idempotent (ON CONFLICT DO NOTHING — never lowers/overwrites an existing rule).
-- Lower priority = higher trust. manual_resolution/manual_edit (1) stay top so a
-- human override is never clobbered.

BEGIN;

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  -- ── gov.properties.recorded_owner_name (costar_sidebar=60 already present) ──
  ('gov.properties', 'recorded_owner_name', 'manual_resolution', 1,  'record_only', 'R51: human-resolved value. Equal priority to manual_edit.'),
  ('gov.properties', 'recorded_owner_name', 'manual_edit',       1,  'record_only', 'R51: explicit human override.'),
  ('gov.properties', 'recorded_owner_name', 'recorded_deed',     3,  'record_only', 'R51: recorded deed grantee is the legal source of truth for title.'),
  ('gov.properties', 'recorded_owner_name', 'county_records',    10, 'record_only', 'R51: county deed registrar.'),

  -- ── gov.properties.recorded_owner_id (NO rule existed — mirror dia ladder) ──
  ('gov.properties', 'recorded_owner_id',   'manual_resolution', 1,  'record_only', 'R51: human-resolved value. Equal priority to manual_edit.'),
  ('gov.properties', 'recorded_owner_id',   'manual_edit',       1,  'record_only', 'R51: explicit human override.'),
  ('gov.properties', 'recorded_owner_id',   'recorded_deed',     3,  'record_only', 'R51: recorded deed grantee is the legal source of truth for title.'),
  ('gov.properties', 'recorded_owner_id',   'county_records',    10, 'record_only', 'R51: county deed records.'),
  ('gov.properties', 'recorded_owner_id',   'costar_sidebar',    50, 'record_only', 'R51: CoStar reported owner (mirror dia).'),
  ('gov.properties', 'recorded_owner_id',   'rca_sidebar',       50, 'record_only', 'R51: RCA sidebar capture (mirror dia).'),
  ('gov.properties', 'recorded_owner_id',   'crexi_sidebar',     55, 'record_only', 'R51: CREXi listing capture (mirror dia).'),
  ('gov.properties', 'recorded_owner_id',   'crexi_sidebar_description', 60, 'record_only', 'R51: CREXi marketing-description prose mining (mirror dia).'),

  -- ── dia.properties owner fields: ADD the explicit recorded_deed source ──
  --    (county_records=10 + the aggregator ladder already exist on dia)
  ('dia.properties', 'recorded_owner_name', 'recorded_deed', 3, 'record_only', 'R51: recorded deed grantee is the legal source of truth for title.'),
  ('dia.properties', 'recorded_owner_id',   'recorded_deed', 3, 'record_only', 'R51: recorded deed grantee is the legal source of truth for title.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

COMMIT;
