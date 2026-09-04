-- SEC1-property (2026-10-15) — gov_merge_property_reversible / gov_unmerge_property
-- (shipped live by ADDR1b-merge, 2026-09-04) were SECURITY DEFINER and
-- anon+authenticated EXECUTABLE — the PUBLIC grant Postgres adds at CREATE
-- time, plus Supabase's ALTER DEFAULT PRIVILEGES explicit anon/authenticated
-- grants. Mirrors the dia lockdown in the same round and the ENTC precedent
-- (lcc_p195_unmerge / lcc_unmerge_entity / lcc_a2a_unmerge, 2026-09-03).
--
-- gov_merge_property_reversible mutates every FK to properties the same way
-- its dia sibling does. Censused: neither function has a single caller yet in
-- life-command-center or government-lease (grepped both repos for the exact
-- names — zero hits outside migrations/docs). gov_merge_property_apply, the
-- non-reversible sibling, was already locked to service_role-only in Cowork
-- the same day this rename shipped — this closes the reversible pair to match.
--
-- Revoke from public AND anon AND authenticated — REVOKE ... FROM public does
-- NOT remove the explicit anon/authenticated grants Supabase's default
-- privileges add at CREATE time, and REVOKE ... FROM anon, authenticated does
-- NOT remove the PUBLIC grant (the leading =X in proacl). Iterate every
-- overload by proname rather than a hand-written signature.

do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as sig
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('gov_merge_property_reversible', 'gov_unmerge_property')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
