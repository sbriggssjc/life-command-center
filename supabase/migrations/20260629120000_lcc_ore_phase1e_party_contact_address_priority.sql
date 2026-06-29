-- ORE Phase 1 Unit E — party-contact address provenance (2026-06-29)
--
-- The OM promoter now writes seller/buyer/owner PARTY contacts to
-- <domain>.contacts (intake-promoter.js promoteOmPartyContacts), filling the
-- party's mailing/notice ADDRESS (the address dimension owner cross-match keys
-- on) where the document states it. dia.contacts already carries om_extraction
-- field_source_priority rows for address/city/state (auto-seeded Round 76an at
-- priority 45). gov.contacts does NOT — only the costar/rca/crexi aggregator
-- sources had address/city/state rows there. Without an om_extraction row the
-- promoter's provenance write to gov.contacts.address would surface in
-- v_field_provenance_unranked (schema-drift detector).
--
-- Add gov.contacts.{address,city,state} for source='om_extraction' at priority
-- 45 (PARITY with dia.contacts — om_extraction sits above the aggregators 50-70,
-- below county_records=5 / manual=1). record_only (observe-only). Idempotent.
-- Additive; reversible (DELETE the three rows).

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('gov.contacts', 'address', 'om_extraction', 45, 'record_only', 'ORE Phase 1 Unit E: OM party-contact mailing address (parity with dia.contacts)'),
  ('gov.contacts', 'city',    'om_extraction', 45, 'record_only', 'ORE Phase 1 Unit E: OM party-contact city (parity with dia.contacts)'),
  ('gov.contacts', 'state',   'om_extraction', 45, 'record_only', 'ORE Phase 1 Unit E: OM party-contact state (parity with dia.contacts)')
ON CONFLICT (target_table, field_name, source) DO NOTHING;
