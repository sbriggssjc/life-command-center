-- ============================================================================
-- 20260728160000_bd_opportunities_add_property_address.sql   (OPS project xengecqvemvfknjvbvrq)
-- A5b: capture the SF Opportunity property address on the backbone. The name gave only city+state, which
-- left 232 multi-asset-city deals as ambiguous placeholders. Property_Address__c (SF formula field) is the
-- disambiguator — opportunity-sync now maps it, uses addrKey() to resolve the right candidate, and stores it
-- here + on the asset entity. Also unlocks address-based email matching (A5) and entity reconciliation (A1).
-- Applied live 2026-07-28. Requires the PA "SF Deal → LCC Opportunity Sync" Get-records Select Query to
-- include Property_Address__c so the field reaches the engine.
-- ============================================================================
alter table public.bd_opportunities add column if not exists property_address text;
comment on column public.bd_opportunities.property_address is 'SF Opportunity Property_Address__c; written by opportunity-sync (A5b).';
