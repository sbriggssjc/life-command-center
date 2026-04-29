-- v_field_source_priority_unobserved
--
-- Surfaces (target_table, field_name, source) triples in
-- field_source_priority that have never produced a row in
-- field_provenance. A non-empty result for a given (target_table,
-- field_name) means: the rule was registered, but the writer is not
-- calling lcc_merge_field() for it. Until that integration gap is
-- closed, ramping enforce_mode to warn or strict for that field is a
-- no-op.
--
-- See docs/architecture/field_source_priority_ramp_plan.md for the
-- full ramp procedure that consumes this view.

create or replace view public.v_field_source_priority_unobserved as
select
  fsp.target_database,
  fsp.target_table,
  fsp.field_name,
  fsp.source,
  fsp.priority,
  fsp.enforce_mode,
  fsp.created_at as rule_created_at
from public.field_source_priority fsp
where not exists (
  select 1
  from public.field_provenance fp
  where fp.target_database = fsp.target_database
    and fp.target_table   = fsp.target_table
    and fp.field_name     = fsp.field_name
    and fp.source         = fsp.source
);

comment on view public.v_field_source_priority_unobserved is
  'field_source_priority rules that have never been exercised through lcc_merge_field. Non-empty for a given (target_table, field_name) means warn/strict enforcement would be a no-op until the writer is integrated. See docs/architecture/field_source_priority_ramp_plan.md.';
