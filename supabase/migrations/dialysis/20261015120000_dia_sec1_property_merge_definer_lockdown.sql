-- SEC1-property (2026-10-15) — dia_merge_property_reversible / dia_unmerge_property
-- were SECURITY DEFINER and anon+authenticated EXECUTABLE (the PUBLIC grant Postgres
-- adds at CREATE time, plus Supabase's ALTER DEFAULT PRIVILEGES explicit anon/
-- authenticated grants — neither half removed by the other's REVOKE, per the
-- documented trap in CLAUDE.md "the provenance ladder" and the ENTC precedent
-- (lcc_p195_unmerge / lcc_unmerge_entity / lcc_a2a_unmerge, 2026-09-03).
--
-- dia_merge_property_reversible mutates every FK to properties (sales, leases,
-- deeds, listings, documents) via dia_merge_property under the hood; a caller
-- with only the anon key could invoke it directly against PostgREST and merge
-- or un-merge arbitrary properties. The only live caller is the Decision Center
-- property_twin lane in life-command-center's api/admin.js, which reaches dia
-- via domainQuery('dia', ...) — server-mediated with the domain's service-role
-- credential (proven by the sibling dia_merge_property RPC, already locked to
-- service_role-only, being called through the identical domainQuery path in
-- the live property_merge lane). Revoking anon/authenticated here does not
-- touch that caller.
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
      and proname in ('dia_merge_property_reversible', 'dia_unmerge_property')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
