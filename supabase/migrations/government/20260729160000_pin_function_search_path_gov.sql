-- ============================================================================
-- 20260729160000_pin_function_search_path_gov.sql   (GOV scknotsqkcheojiaewwh)
-- Applied live 2026-07-29. Same as the OPS pass, lock-safe (short lock_timeout + per-function
-- exception skip so a busy/edge-case function can't abort the sweep). Verified: 0 of our functions
-- left unpinned; smoke query green. Skips extension-owned + already-pinned.
-- ============================================================================
do $$
declare r record; n int := 0; skipped int := 0;
begin
  perform set_config('lock_timeout','3s', true);
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace
    where nm.nspname='public' and p.prokind='f'
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    begin
      execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
      n := n + 1;
    exception when others then
      skipped := skipped + 1;
    end;
  end loop;
  raise notice 'gov: pinned % functions, skipped %', n, skipped;
end $$;
