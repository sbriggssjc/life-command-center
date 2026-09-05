-- SEC1-merge-family Unit 1 (gov half)
--
-- p31_property_consolidation_apply / p31_same_event_sales_apply are batch
-- consolidation/dedup writers on gov, the same shape as their dia siblings locked in
-- the companion dia migration. Sibling proof: gov_merge_property_apply is already
-- service_role-only on the identical merge code path (SEC1-property / ADDR1b).
-- Verified live: revoke did not break a real dry-run call as service_role
-- (p31_same_event_sales_apply(true,'sec1_probe') returned its normal plan output
-- post-revoke).

revoke execute on function
  public.p31_property_consolidation_apply(boolean, text, integer),
  public.p31_same_event_sales_apply(boolean, text)
from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('p31_property_consolidation_apply(boolean, text, integer)'),
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
