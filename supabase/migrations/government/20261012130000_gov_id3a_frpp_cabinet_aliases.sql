-- ID3a, second curated batch: the FRPP reporting-agency vocabulary.
-- Project: government (scknotsqkcheojiaewwh).  Date: 2026-09-12.  Applied live.
-- Audit: docs/audits/ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md §2c
--
-- `property_agencies.agency_code` carries a DIFFERENT vocabulary from `properties.agency`: bare
-- CABINET DEPARTMENT names, on 132,243 rows, every one with data_source='frpp_records' and
-- government_type='Federal' (verified live across all 13 distinct values before writing anything).
-- Without these seven aliases the bridge wires 53,285 rows; with them, 119,201 (90.1% of the table).
--
-- ⚠️ ONLY the seven cabinet labels that have a `government_agencies` row are aliased.
--   LABOR (1,850 rows), COMMERCE (1,317), SMITHSONIAN (693) and TENNESSEE VALLEY AUTHORITY (441)
--   have NO registry row and stay in the review lane as `no_registry_row` — adding a registry row
--   is a curation decision for a human, not something a migration invents (backlog ID3a-registry-gaps).
--   INDEPENDENT GOVERNMENT OFFICES (504) is a BUCKET LABEL, not an agency, and stays in review.
--
-- ⚠️ NOTE FOR WHOEVER READS THIS NEXT: `VETERANS AFFAIRS` (48,537 rows — the single largest value
--   in the table) was ALREADY resolving before this batch, via the properties-oriented curated alias
--   'Veterans Affairs' from the base migration. That cross-population hit is CORRECT here (the FRPP
--   cabinet department IS the federal VA) but it was ACCIDENTAL, not designed. It is recorded rather
--   than relied on: if the base alias list is ever narrowed, 48,537 bridge rows silently stop
--   resolving and nothing errors.
--
-- REVERSAL: delete from gov_agency_aliases where source = 'id3a_frpp_cabinet';
--   (then re-run the ID3a reversal runbook for any rows those aliases wired)

insert into gov_agency_aliases (alias_raw, alias_key, agency_id, source, note)
select v.raw, gov_agency_alias_key(v.raw), g.agency_id, 'id3a_frpp_cabinet', v.note
  from (values
    ('AGRICULTURE','USDA','FRPP cabinet label; 32,952 bridge rows, all federal frpp_records'),
    ('HOMELAND SECURITY','DHS','FRPP cabinet label'),
    ('TRANSPORTATION','DOT','FRPP cabinet label'),
    ('INTERIOR','DOI','FRPP cabinet label'),
    ('HEALTH AND HUMAN SERVICES','HHS','FRPP cabinet label; federal HHS, not a state commission'),
    ('ENERGY','DOE','FRPP cabinet label'),
    ('JUSTICE','DOJ','FRPP cabinet label')
  ) as v(raw, code, note)
  join government_agencies g on g.code = v.code
on conflict (alias_key) do nothing;
