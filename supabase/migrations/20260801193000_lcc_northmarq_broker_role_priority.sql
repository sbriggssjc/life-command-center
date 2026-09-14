-- Prompt 03 — Northmarq broker role authority.
-- Register the SF/SJC roster source used to reconcile Northmarq sell-side
-- listing_broker attribution over third-party feeds such as costar_sidebar.

begin;

insert into public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
select v.target_table, v.field_name, v.source, v.priority, v.min_confidence, v.enforce_mode, v.notes
from (values
  ('dia.sales_transactions', 'listing_broker', 'northmarq_sf_roster', 20, 0.90, 'record_only',
   'Prompt 03: authoritative Team Briggs/Northmarq sell-side broker from SF/SJC roster. Third-party feed value is retained as as-reported.'),
  ('gov.sales_transactions', 'listing_broker', 'northmarq_sf_roster', 20, 0.90, 'record_only',
   'Prompt 03: authoritative Team Briggs/Northmarq sell-side broker from SF/SJC roster. Third-party feed value is retained as as-reported.')
) as v(target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
where not exists (
  select 1
  from public.field_source_priority f
  where f.target_table = v.target_table
    and f.field_name = v.field_name
    and f.source = v.source
);

commit;
