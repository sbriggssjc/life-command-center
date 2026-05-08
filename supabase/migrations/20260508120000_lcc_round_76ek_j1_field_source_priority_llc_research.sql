-- Round 76ek.j Phase 1a — field_source_priority entries for LLC research
-- enrichment sources.
--
-- New sources at priority 15 (between county_records=10 and
-- costar_cmbs_loan=20). Priority 15 reflects:
--   - More authoritative than CMBS aggregator data (filings are primary)
--   - Less authoritative than county records (county is the actual deed
--     source-of-truth; SOS data is structurally adjacent)
--
-- Sources:
--   mi_lara         — Michigan LARA Corporations Online Filing System (free)
--   opencorporates  — OpenCorporates aggregator (paid, broad coverage)
--   manual          — analyst-entered via the LCC UI

BEGIN;

WITH new_rules(target_table, field_name) AS (
  VALUES
    -- gov.recorded_owners
    ('gov.recorded_owners','manager_name'),
    ('gov.recorded_owners','manager_role'),
    ('gov.recorded_owners','registered_agent_name'),
    ('gov.recorded_owners','registered_agent_address'),
    ('gov.recorded_owners','filing_state'),
    ('gov.recorded_owners','filing_id'),
    ('gov.recorded_owners','filing_date'),
    ('gov.recorded_owners','filing_status'),

    -- dia.recorded_owners
    ('dia.recorded_owners','manager_name'),
    ('dia.recorded_owners','manager_role'),
    ('dia.recorded_owners','registered_agent_name'),
    ('dia.recorded_owners','registered_agent_address'),
    ('dia.recorded_owners','state_of_incorporation'),
    ('dia.recorded_owners','filing_id'),
    ('dia.recorded_owners','filing_date'),
    ('dia.recorded_owners','filing_status')
)
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT target_table, field_name, src.source, 15, 'record_only',
       'Round 76ek.j Phase 1a: LLC research enrichment ('|| src.source ||') sits between county_records=10 and costar_cmbs_loan=20.'
FROM new_rules
CROSS JOIN (VALUES ('mi_lara'), ('opencorporates')) AS src(source)
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- manual_edit already has priority 1 across the registry; no need to re-register.

COMMIT;
