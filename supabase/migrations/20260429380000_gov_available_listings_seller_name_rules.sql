-- gov.available_listings.seller_name rules (2026-04-29).
--
-- Followup to PR #498 (gov listing schema fix). The provenance loop
-- in sidebar-pipeline.js + intake-promoter.js writes seller_name for
-- both domains, but only dia.available_listings.seller_name had rules
-- registered. Adds the gov rules at the same priority spread used for
-- dia.

insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('gov.available_listings', 'seller_name', 'manual_edit',    1,  'record_only', null),
  ('gov.available_listings', 'seller_name', 'om_extraction',  30, 'record_only', 'OM-extracted seller / vendor name.'),
  ('gov.available_listings', 'seller_name', 'costar_sidebar', 60, 'record_only', 'CoStar Owner of Record at sale.')
on conflict (target_table, field_name, source) do nothing;
