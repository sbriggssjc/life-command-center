-- ORE Phase 1 Unit C — field_source_priority for the OWNER mailing address the
-- deed-grantee propagation fills, so lcc_merge_field ranks recorded_deed above the
-- aggregators (per R51) and v_field_provenance_unranked stays at 0.
--
-- The deed parser (api/_handlers/deed-parser.js → propagateDeedToBd Unit C →
-- sidebar-pipeline.js writeOwnerMailingAddress) writes the grantee mailing address
-- onto recorded_owners fill-blanks and records provenance via shouldWriteField:
--   gov: a single new mailing_address column.
--   dia: the existing address/city/state owner columns.
--
-- Lower priority = higher trust. manual_resolution/manual_edit (1) stay top so a
-- human override is never clobbered; recorded_deed (3) is the legal owner address.
-- dia.recorded_owners.address/city/state already carry the manual/county/aggregator
-- ladder (county=5, rca=50, costar=60, …) — this ADDS the recorded_deed source.
-- Idempotent (ON CONFLICT DO NOTHING — never lowers an existing rule).

BEGIN;

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  -- ── gov.recorded_owners.mailing_address (new dedicated column) ──
  ('gov.recorded_owners', 'mailing_address', 'manual_resolution', 1, 'record_only', 'ORE Unit C: human-resolved owner mailing address.'),
  ('gov.recorded_owners', 'mailing_address', 'manual_edit',       1, 'record_only', 'ORE Unit C: explicit human override.'),
  ('gov.recorded_owners', 'mailing_address', 'recorded_deed',     3, 'record_only', 'ORE Unit C: deed grantee mailing address — legal source of the owner address.'),

  -- ── dia.recorded_owners.address/city/state (existing ladder + recorded_deed) ──
  ('dia.recorded_owners', 'address', 'recorded_deed', 3, 'record_only', 'ORE Unit C: deed grantee mailing address (street).'),
  ('dia.recorded_owners', 'city',    'recorded_deed', 3, 'record_only', 'ORE Unit C: deed grantee mailing city.'),
  ('dia.recorded_owners', 'state',   'recorded_deed', 3, 'record_only', 'ORE Unit C: deed grantee mailing state.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

COMMIT;
