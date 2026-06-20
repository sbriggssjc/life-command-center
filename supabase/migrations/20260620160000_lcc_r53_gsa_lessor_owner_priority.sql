-- R53 Unit 4 (2026-06-20): register the GSA lessor as a corroborating owner
-- source in the field-source-priority ladder for gov.properties owner fields.
--
-- The GSA lease inventory's lessor_name is the federal tenant's recorded
-- landlord — an independent owner signal alongside recorded_deed / county /
-- the CoStar aggregators. It is NOT as authoritative as the recorded deed
-- grantee (the legal title taker), so it sits at priority 20: BELOW
-- recorded_deed (3) / county_records (10), ABOVE the aggregators (50+). When a
-- future gsa-lessor sync producer pushes the current lessor into recorded_owner
-- via lcc_merge_field (source='gsa_lessor'), it ranks correctly; meanwhile the
-- R53 v_owner_source_corroboration view uses lessor agreement with the deed
-- grantee to RAISE confidence on the R51 deed-wins auto-reconcile set.
--
-- Additive + idempotent (ON CONFLICT DO NOTHING). record_only mode (telemetry,
-- no write blocking). Keeps v_field_provenance_unranked at 0 if a gsa_lessor
-- write ever lands. Mirror of the R51 owner-ladder migration.

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('gov.properties', 'recorded_owner_name', 'gsa_lessor', 20, 'record_only',
   'R53: GSA lease inventory lessor — corroborating owner source, below recorded_deed/county, above aggregators'),
  ('gov.properties', 'recorded_owner_id',   'gsa_lessor', 20, 'record_only',
   'R53: GSA lease inventory lessor — corroborating owner source, below recorded_deed/county, above aggregators')
ON CONFLICT (target_table, field_name, source) DO NOTHING;
