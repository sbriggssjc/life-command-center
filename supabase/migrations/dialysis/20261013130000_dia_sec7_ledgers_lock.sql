-- ============================================================================
-- SEC7-LEDGERS (phase 1 of SEC7) — dia: lock the merge ledgers the app trusts
-- Dialysis_DB (zqzrriwuavgrquhisnoa). Owner: life-command-center (CLAUDE.md
-- ownership table). Applied live 2026-09-24.
--
-- Before: RLS off, anon + authenticated held arwdDxt on
--   dia_property_redirects      dia_resolve_property_id() and the LCC merge-log
--                               reconcile follow it, so one row moves LCC entities
--   dia_property_merge_backup   the undo store for reversible merges
-- and on v_dia_property_redirect_resolved, a definer view (security_invoker
-- unset) over ONE table, so Postgres makes it auto-updatable
-- (information_schema: is_updatable = YES, is_insertable_into = YES). A write
-- through it runs as the view owner, so revoking the base table alone would
-- have left anon a second write path. The view is locked in the same change.
--
-- Writers, enumerated from the live catalog + 7 days of edge_logs:
--   SQL (all SECURITY DEFINER, owner postgres, service_role-only EXECUTE):
--     dia_merge_property, dia_merge_property_reversible, dia_unmerge_property,
--     dia_consolidate_property_reviewed, merge_dialysis_dup_property
--   cron (runs as postgres): 16 dia_auto_merge_property_duplicates -> dia_merge_property
--   REST (edge_logs 2026-09-17..24): only Railway (UA node) as service_role —
--     PATCH dia_property_redirects (reconciled_lcc_* stamps, merge-log-reconcile.js),
--     PATCH/GET dia_property_merge_backup (stamps + sidebar-pipeline.js read),
--     GET v_dia_property_redirect_resolved. ZERO anon/authenticated requests.
--   CLI: Dialysis src/merge_property_twins.py calls the definer RPCs above,
--     which are already service_role-only, so it cannot be running as anon.
--   No triggers on either table; no edge function references them.
-- postgres and service_role both have rolbypassrls = true and postgres owns the
-- tables, so every writer above is unaffected by RLS.
--
-- Reads kept: service_role only. No named anon/authenticated reader exists.
-- ============================================================================

-- 1. Tables: revoke everything from the client roles, keep service_role.
revoke all on table public.dia_property_redirects    from public, anon, authenticated;
revoke all on table public.dia_property_merge_backup from public, anon, authenticated;
grant  all on table public.dia_property_redirects    to service_role;
grant  all on table public.dia_property_merge_backup to service_role;

-- 2. The auto-updatable definer view: the second write path.
revoke all on table public.v_dia_property_redirect_resolved from public, anon, authenticated;
grant  select on table public.v_dia_property_redirect_resolved to service_role;

-- 3. Their sequences (an INSERT needs USAGE; tidy even with INSERT revoked).
do $$
declare s text;
begin
  foreach s in array array[
    pg_get_serial_sequence('public.dia_property_redirects', 'redirect_id'),
    pg_get_serial_sequence('public.dia_property_merge_backup', 'backup_id')]
  loop
    if s is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', s);
      execute format('grant usage, select on sequence %s to service_role', s);
    end if;
  end loop;
end $$;

-- 4. RLS on, service-role policy (the government_agencies pattern). With no
-- anon/authenticated policy, a future accidental GRANT still reads/writes zero rows.
alter table public.dia_property_redirects    enable row level security;
alter table public.dia_property_merge_backup enable row level security;

drop policy if exists service_role_all_dia_property_redirects on public.dia_property_redirects;
create policy service_role_all_dia_property_redirects on public.dia_property_redirects
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_dia_property_merge_backup on public.dia_property_merge_backup;
create policy service_role_all_dia_property_merge_backup on public.dia_property_merge_backup
  for all to service_role using (true) with check (true);

-- 5. Standing guard: returns one row per (object, role, privilege) that should
-- not exist. Invoker rights; has_table_privilege needs no grant to answer.
create or replace function public.dia_sec7_ledger_privilege_violations()
returns table(object_name text, role_name text, privilege text)
language sql stable
set search_path = public, pg_temp
as $$
  select o.obj, r.rol, p.priv
    from unnest(array['public.dia_property_redirects',
                      'public.dia_property_merge_backup',
                      'public.v_dia_property_redirect_resolved']) o(obj)
   cross join unnest(array['anon', 'authenticated']) r(rol)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
   where has_table_privilege(r.rol, o.obj, p.priv)
  union all
  select c.oid::regclass::text, 'rls', 'disabled'
    from pg_class c
   where c.oid in ('public.dia_property_redirects'::regclass, 'public.dia_property_merge_backup'::regclass)
     and not c.relrowsecurity
$$;
revoke all on function public.dia_sec7_ledger_privilege_violations() from public, anon, authenticated;
grant execute on function public.dia_sec7_ledger_privilege_violations() to service_role;

-- 6. Assert on the catalog, never on the REVOKE above (SEC1 doctrine).
do $$
declare n int;
begin
  select count(*) into n from public.dia_sec7_ledger_privilege_violations();
  if n > 0 then
    raise exception 'SEC7-LEDGERS: % privilege violation(s) remain on the dia merge ledgers', n;
  end if;
  if not has_table_privilege('service_role', 'public.dia_property_redirects', 'UPDATE')
     or not has_table_privilege('service_role', 'public.dia_property_merge_backup', 'UPDATE')
     or not has_table_privilege('service_role', 'public.v_dia_property_redirect_resolved', 'SELECT') then
    raise exception 'SEC7-LEDGERS: service_role lost access the LCC reconcile needs';
  end if;
  if has_function_privilege('anon', 'public.dia_sec7_ledger_privilege_violations()', 'EXECUTE') then
    raise exception 'SEC7-LEDGERS: guard function is anon-executable';
  end if;
end $$;

-- REVERSAL (restores the pre-SEC7 state; do not run without a reason):
--   alter table public.dia_property_redirects    disable row level security;
--   alter table public.dia_property_merge_backup disable row level security;
--   grant all on public.dia_property_redirects, public.dia_property_merge_backup,
--                public.v_dia_property_redirect_resolved to anon, authenticated;
