-- Phase 2.1 OM-promoter coverage gap follow-up (2026-04-29).
--
-- Two corrections to field_source_priority for dia.properties:
--
-- 1. Typo: dia.properties has column `land_area`, not `land_acres`.
--    Five rules registered against 'dia.properties.land_acres' could
--    never observe a write because no writer touches that column on
--    dia (gov.properties.land_acres is correct and stays put).
--    Rename the field_name to land_area. UNIQUE constraint on
--    (target_table, field_name, source) means a straight UPDATE is
--    safe — there are no land_area rules to collide with.
--
-- 2. Missing column: promoteDiaPropertyFromOm sets
--    anchor_rent_source='om_confirmed' alongside anchor_rent /
--    anchor_rent_date when the OM lease post-dates the property's
--    recorded anchor (CLAUDE.md "Dialysis v_sales_comps rent
--    semantics"). It's a metadata column for which source set the
--    anchor; tracking provenance for it is meta but consistent.
--    Register rules for the three writers that touch it:
--    manual_edit (1), lease_document (25), om_extraction (50).
--
-- All new entries are enforce_mode='record_only' — observation only,
-- consistent with the FU6 ramp plan.

-- 1. Rename land_acres -> land_area on dia.properties
update public.field_source_priority
   set field_name = 'land_area',
       updated_at = now()
 where target_table = 'dia.properties'
   and field_name  = 'land_acres';

-- 2. Register dia.properties.anchor_rent_source for the three writers
insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('dia.properties', 'anchor_rent_source', 'manual_edit',    1,  'record_only', 'Explicit human override of which source set the anchor.'),
  ('dia.properties', 'anchor_rent_source', 'lease_document', 25, 'record_only', 'Lease ingestion sets ''lease_confirmed''.'),
  ('dia.properties', 'anchor_rent_source', 'om_extraction',  50, 'record_only', 'OM promoter sets ''om_confirmed'' when OM lease post-dates anchor_rent_date.')
on conflict (target_table, field_name, source) do nothing;
