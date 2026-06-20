-- =====================================================================
-- UW#1 (LCC Opps) — register county_records priority for the dia.properties
-- tax fields written by the dia county digest, so v_field_provenance_unranked
-- stays 0 and future writers rank county data correctly.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-06-20.
--
-- The other dia.properties digest fields (assessed_value, year_built, zoning,
-- building_size, land_area) already had county_records rules; only the tax
-- fields were missing. county_records sits at priority 10 for dia.properties
-- (above the aggregators, below manual_edit/manual_resolution=1). record_only
-- mode (observability; the domain writer performs the UPDATE).
-- =====================================================================
insert into public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('dia.properties','tax_amount','county_records',10,'record_only','UW#1 county digest'),
  ('dia.properties','tax_amount_due','county_records',10,'record_only','UW#1 county digest'),
  ('dia.properties','tax_delinquent_amount','county_records',10,'record_only','UW#1 county digest'),
  ('dia.properties','tax_delinquent','county_records',10,'record_only','UW#1 county digest'),
  ('dia.properties','tax_year','county_records',10,'record_only','UW#1 county digest')
on conflict (target_table, field_name, source) do nothing;
