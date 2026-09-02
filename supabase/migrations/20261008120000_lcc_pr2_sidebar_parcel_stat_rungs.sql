-- ============================================================================
-- PR2 — register the field_source_priority rungs the sidebar parcel/tax writer
--       is about to start using.
--
-- WHY THIS SHIPS FIRST
-- -------------------
-- `upsertPublicRecords` (api/_handlers/sidebar-pipeline.js) has always been
-- handed building SF / year built / lot size / zoning by the CoStar capture and
-- has never written any of them: the parcel INSERT carried
-- apn/county/state/assessed_value/raw_payload only, and `tax_amount` was stashed
-- in the parcel raw_payload instead of the `tax_records.tax_amount` column.
--
-- Measured live 2026-09-02, dia (zqzrriwuavgrquhisnoa) parcel_records split by
-- raw_payload->>'source':
--
--   costar_sidebar   932 rows, 931 real APNs, assessed on 286,
--                    building_sf 0 · lot_sf 0 · year_built 0 · land_use 0 ·
--                    zoning 0 · owner_name 0
--   (null, gpt-4o)   672 rows, 671 with a NULL APN
--
-- gov (scknotsqkcheojiaewwh) is the same defect and a bigger population:
-- 1,527 costar_sidebar parcel rows, 0 building_sf / land_area_sf /
-- land_area_acres / year_built / zoning / property_class.
--
-- `lcc_merge_field` writes the caller's source name verbatim (the
-- `domain_trigger` relabel PR8 replaced lives in the ASYNC
-- lcc_flush_provenance_events drain, not on this path) -- but
-- `v_field_provenance_unranked` flags any (target_table, field_name, source)
-- with no registry row, so writing these fields unregistered grows the drift
-- detector. Registering first is what keeps that detector meaningful.
--
-- RUNGS CHOSEN, and why they are not invented
-- -------------------------------------------
-- Each new rung mirrors the rung `costar_sidebar` ALREADY holds for its
-- siblings on the SAME (table, source):
--   dia.parcel_records  assessed_value / county / apn -> costar_sidebar @55
--   dia.tax_records     assessed_value / tax_year     -> costar_sidebar @55
--   gov.parcel_records  land_value / improvement_value / total_assessed_value
--                                                     -> costar_sidebar @55
-- so every field added here is @55 as well. `enforce_mode` is the registry
-- default `record_only`: this change registers the writer, it does not start
-- blocking anything. (dia's existing sibling rungs sit at `warn`; a new rung
-- arriving in `warn` would start emitting console warnings for a path that has
-- never written before, which is noise, not a gate.)
--
-- ⚠️ NO `county_records` RUNG IS ADDED. That source is registered on 93 field
-- rungs at priority 5-15 and its producer asks gpt-4o to recall parcel facts
-- (PR1); PR8 refuses it its own identity via `v_never_first_class`. Adding
-- rungs for it here would arm a lane this repo deliberately disarmed. See
-- docs/architecture/public-records-source-lane.md §2a.
--
-- REVERSAL
--   delete from public.field_source_priority
--    where notes = 'pr2_sidebar_parcel_stats_20260902';
-- ============================================================================

insert into public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
values
  -- dia.parcel_records — the columns the capture already carries.
  ('dia.parcel_records', 'building_sf',     'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'lot_sf',          'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'year_built',      'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'year_renovated',  'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'zoning',          'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'land_use',        'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('dia.parcel_records', 'owner_name',      'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  -- dia.tax_records — the column the capture's tax figure belongs in.
  ('dia.tax_records',    'tax_amount',      'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  -- gov.parcel_records — same writer, same capture, different column names.
  ('gov.parcel_records', 'building_sf',      'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'land_area_sf',     'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'land_area_acres',  'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'year_built',       'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'zoning',           'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'property_class',   'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.parcel_records', 'owner_name',       'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902'),
  ('gov.tax_records',    'tax_amount',       'costar_sidebar', 55, 0.000, 'record_only', 'pr2_sidebar_parcel_stats_20260902')
on conflict (target_table, field_name, source) do nothing;
