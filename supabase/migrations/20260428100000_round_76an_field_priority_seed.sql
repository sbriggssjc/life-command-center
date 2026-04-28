-- ============================================================================
-- Round 76an — auto-seed priority rules for unranked field/source combos
--
-- v_field_provenance_unranked surfaced 15 (target_table, field_name, source)
-- combos where data was actively being written to field_provenance but no
-- priority rule existed in field_source_priority — meaning the registry
-- couldn't enforce write-vs-skip for those fields.
--
-- Top offenders: dia.contacts.contact_phone (287 writes / 30d),
-- dia.tax_records.apn (68), dia.contacts.{address,city,state} (~64 each),
-- dia.ownership_history.{property_id,recorded_owner_id,sale_id} (~49 each),
-- gov.{properties,contacts}.{state,city,name} (~21 each).
--
-- Seed the standard ladder for every unranked (table, field):
--   manual_edit (1), county_records (5), om_extraction (45),
--   rca_sidebar (50), costar_sidebar (60). All record_only enforce mode.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

WITH unranked_combos AS (
  SELECT DISTINCT target_table, field_name FROM public.v_field_provenance_unranked
)
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT u.target_table, u.field_name, src, pri, 'record_only',
       'Round 76an: auto-seeded for previously-unranked source/field combo'
FROM unranked_combos u
CROSS JOIN (VALUES
  ('manual_edit',    1),
  ('county_records', 5),
  ('om_extraction', 45),
  ('rca_sidebar',   50),
  ('costar_sidebar',60)
) AS s(src, pri)
ON CONFLICT (target_table, field_name, source) DO NOTHING;
