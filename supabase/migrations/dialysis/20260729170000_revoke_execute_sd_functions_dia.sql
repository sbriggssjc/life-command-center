-- ============================================================================
-- 20260729170000_revoke_execute_sd_functions_dia.sql   (DIA zqzrriwuavgrquhisnoa)
-- Applied live 2026-07-29. Revoke EXECUTE on public SECURITY DEFINER functions from
-- PUBLIC/anon/authenticated (clears authenticated_security_definer_function_executable).
-- postgres + service_role keep their explicit grants, so the engine is unaffected. Safe because DIA
-- has no anon key + no frontend (backend warehouse). Lock-safe (PG15 live CMS ingestion); skips extension-owned.
-- Verified: 0 SD functions left exposed to anon/authenticated; 63 retain service_role; engine green.
-- ============================================================================
do $$
declare r record; n int := 0; skipped int := 0;
begin
  perform set_config('lock_timeout','3s', true);
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace
    where nm.nspname='public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    begin
      execute format('revoke execute on routine %s from public, anon, authenticated', r.sig);
      n := n + 1;
    exception when others then skipped := skipped + 1;
    end;
  end loop;
  raise notice 'dia: revoked execute on % SD functions, skipped %', n, skipped;
end $$;
