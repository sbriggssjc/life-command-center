-- ORE Phase A1 (LCC Opps): register the county_records provenance rank for the gov owner
-- mailing address that the gov-side promote (gov_promote_parcel_mailing_to_owner) writes.
--
-- WHY: gov.recorded_owners.mailing_address already carried manual_edit/manual_resolution@1
-- and recorded_deed@3, but NO county_records rank. The assessor/county mailing address
-- promoted from parcel_records is county_records grade — it must rank ABOVE the aggregators
-- and BELOW recorded_deed + manual (the field_source_priority convention: lower = higher
-- trust). Without this row a future LCC-side merge of the county mailing would be unranked
-- (v_field_provenance_unranked would flag it). dia.recorded_owners.address/city/state already
-- carry county_records@5, so only the gov owner-mailing field needs registering.
--
-- Additive, idempotent, reversible (DELETE the row). record_only enforce mode.

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES ('gov.recorded_owners', 'mailing_address', 'county_records', 5, 'record_only',
        'ORE Phase A1: assessor/county owner mailing address promoted from parcel_records (gov_promote_parcel_mailing_to_owner). Above aggregators, below recorded_deed(3)/manual(1).')
ON CONFLICT (target_table, field_name, source) DO NOTHING;
