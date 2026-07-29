-- ============================================================================
-- 20260729170000_revoke_execute_sd_functions_ops.sql   (OPS xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. Clears WARN *_security_definer_function_executable: revoke EXECUTE on
-- public SECURITY DEFINER functions from PUBLIC/anon/authenticated. postgres + service_role keep
-- their EXPLICIT grants (revoke names only PUBLIC/anon/authenticated), so the engine (service_role)
-- is unaffected. Safe because the frontend/extension never call functions directly (no .rpc()/.from();
-- the anon key is used only for Supabase Auth). Skips extension-owned. Reversible: GRANT EXECUTE … TO authenticated.
-- Verified: 0 SD functions left exposed to anon/authenticated; service_role retained; engine smoke green.
-- ============================================================================
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace
    where nm.nspname='public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    execute format('revoke execute on routine %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'ops: revoked execute on % SD functions', n;
end $$;
