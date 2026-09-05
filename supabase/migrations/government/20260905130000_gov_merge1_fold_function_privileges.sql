-- MERGE1-sec (2026-09-05) — narrow the two new fold helpers to service_role.
--
-- WHY: MERGE1 shipped `_gov_merge_fold_one_row` and `gov_merge_fold_table` as SECURITY DEFINER,
-- and Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on a new function to `anon` and
-- `authenticated` EXPLICITLY at CREATE time, on top of the implicit PUBLIC grant Postgres adds.
-- Measured immediately after the MERGE1 migration:
--     proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--               service_role=X/postgres}
--     has_function_privilege('anon', oid, 'EXECUTE') = TRUE
--
-- These are DESTRUCTIVE and take a TABLE NAME as a parameter — `gov_merge_fold_table` runs
-- dynamic UPDATE/DELETE against whatever table the caller names — so an anon-executable definer
-- version is a strictly worse hole than the one SEC1-property closed on
-- `gov_merge_property_reversible` three days earlier. `gov_merge_property_apply`, their only caller,
-- was already locked; the helpers it gained were not.
--
-- ⚠️ REVOKE FROM `public` ALONE IS A NO-OP FOR THE TWO ROLES THAT MATTER (CLAUDE.md, OCR2/B6d):
-- the roles hold EXPLICIT grants, not PUBLIC ones. Revoke from all three, then ASSERT with
-- has_function_privilege() — never read the privilege off the REVOKE you just wrote.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_gov_merge_fold_one_row', 'gov_merge_fold_table')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- Positive-controlled assertion: fail loudly if either role can still reach either function,
-- and fail if service_role cannot (which would break the merge path silently).
do $$
declare v_bad int; v_svc int;
begin
  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('_gov_merge_fold_one_row', 'gov_merge_fold_table')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then
    raise exception 'MERGE1-sec: % gov fold function(s) still reachable by anon/authenticated', v_bad;
  end if;

  select count(*) into v_svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('_gov_merge_fold_one_row', 'gov_merge_fold_table')
    and has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v_svc <> 2 then
    raise exception 'MERGE1-sec: expected 2 gov fold functions executable by service_role, found %', v_svc;
  end if;
end $$;
