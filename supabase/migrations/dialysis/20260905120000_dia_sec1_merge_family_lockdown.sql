-- SEC1-merge-family Unit 1 (dia half)
--
-- SEC1-property (2026-09-04) locked dia_merge_property_reversible / dia_unmerge_property.
-- MERGE1-sec (2026-09-05) locked the four fold helpers. Both enumerated BY NAME, which
-- structurally cannot find a sibling that does the same thing under a different name.
--
-- Live census 2026-09-05 found dia_consolidate_property_reviewed(p_keep_id, p_drop_id, ...)
-- is a keep/drop property merge -- the exact capability SEC1-property already locked --
-- and it was anon-executable, along with its reversal and the batch consolidation/dedup
-- writers p31_property_consolidation_apply / p31_same_event_sales_apply.
--
-- Sibling proof (SEC1-property's own method): dia_merge_property_reversible /
-- dia_unmerge_property are already service_role-only and called successfully by the
-- property_twin Decision Center lane via domainQuery (service key). Same code path,
-- same constraint. Verified live: revoke did not break a real dry-run call as
-- service_role (dia_consolidate_property_reviewed(30746,29713,'sec1_probe',true,'probe')
-- returned its normal plan output post-revoke).
--
-- A p_dry_run default is not a mitigation -- an anon caller passes false.

revoke execute on function
  public.dia_consolidate_property_reviewed(bigint, bigint, text, boolean, text),
  public.dia_reverse_property_consolidation(bigint, text),
  public.dia_merge_twins(boolean, text, integer, numeric, numeric),
  public.p31_property_consolidation_apply(boolean, text),
  public.p31_same_event_sales_apply(boolean, text)
from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('dia_consolidate_property_reviewed(bigint, bigint, text, boolean, text)'),
      ('dia_reverse_property_consolidation(bigint, text)'),
      ('dia_merge_twins(boolean, text, integer, numeric, numeric)'),
      ('p31_property_consolidation_apply(boolean, text)'),
      ('p31_same_event_sales_apply(boolean, text)')
    ) as t(sig)
  loop
    if has_function_privilege('anon', ('public.'||r.sig)::regprocedure, 'execute') then
      raise exception 'SEC1-merge-family: % is still anon-executable', r.sig;
    end if;
    if has_function_privilege('authenticated', ('public.'||r.sig)::regprocedure, 'execute') then
      raise exception 'SEC1-merge-family: % is still authenticated-executable', r.sig;
    end if;
    if not has_function_privilege('service_role', ('public.'||r.sig)::regprocedure, 'execute') then
      raise exception 'SEC1-merge-family: % lost service_role execute -- this would break the live caller', r.sig;
    end if;
  end loop;
end $$;
