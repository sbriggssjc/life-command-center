-- ============================================================================
-- 20260729160000_pin_function_search_path_ops.sql   (OPS xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. Clears WARN function_search_path_mutable for all public functions we
-- own (84 on OPS). Pins search_path = 'public, extensions, pg_temp' — a superset of what functions
-- currently resolve, so it can't break unqualified references, while making search_path non-mutable
-- (closes the SECURITY DEFINER search-path-injection surface). Skips extension-owned functions
-- (can't/shouldn't alter) and any already pinned. Reversible per-function: ALTER FUNCTION … RESET search_path.
-- Verified after: 0 of our functions left unpinned; engine smoke test green (helper/threshold/addr_key/
-- reconcile sweep all OK); get_pipeline_health full.
-- ============================================================================
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace
    where nm.nspname='public' and p.prokind='f'
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
    n := n + 1;
  end loop;
  raise notice 'pinned search_path on % functions', n;
end $$;
