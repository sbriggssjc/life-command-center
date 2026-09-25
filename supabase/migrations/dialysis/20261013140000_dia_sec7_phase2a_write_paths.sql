-- ============================================================================
-- SEC7-PHASE2A (SEC7-views + SEC7-policy-withcheck) — dia: close the two anon
-- write routes SEC7-LEDGERS proved. Dialysis_DB (zqzrriwuavgrquhisnoa).
-- Owner: life-command-center (CLAUDE.md ownership table). Applied live 2026-09-24.
--
-- Route 1 — writable DEFINER views. A view without security_invoker over one
-- table is auto-updatable, and the write runs as the view OWNER, past the base
-- table's RLS. Proven 2026-09-24 (rolled back): anon UPDATE through
-- v_sales_feed_portfolio matched all 5,009 sales_transactions rows. Population
-- (pg_relation_is_updatable(oid, true) > 0, no security_invoker, anon or
-- authenticated holds INSERT/UPDATE/DELETE), measured live before this change:
--   scrub_cache (INSTEAD OF triggers; invoker trigger fns, closed with route 2)
--   v_dia_broker_company_registry_health   v_dia_listing_cap_review_open
--   v_dia_nm_cis_unlinked                  v_dia_operator_orphan_registry_gap
--   v_dia_operator_unresolved_review       v_dia_ownergap2_fabrication_guard_collisions
--   v_dia_place_vocab_state_review         v_sales_feed_portfolio
--   v_sf_link_review_queue
-- Fix: revoke INSERT/UPDATE/DELETE/TRUNCATE from public/anon/authenticated.
-- SELECT is kept on every view (the LCC pg_net anon pulls only read).
--
-- Route 2 — policies that admit an anon write. Two shapes:
--   (a) USING (auth.role() = 'service_role') WITH CHECK (true), TO public:
--       blocks reads and updates, admits every INSERT (INSERT checks WITH CHECK
--       only). Proven: anon inserted run_status='watermark' into ingestion_tracker.
--       ingestion_tracker, cmbs_loans, cmbs_loan_properties.
--   (b) explicit client write policies (USING/WITH CHECK true to anon, authenticated
--       or public): salesforce_accounts, lease_rent_schedule, lease_extensions,
--       lease_options, facility_patient_counts, ingestion_log, bd_execution_log,
--       loopnet_listing_map, marketing_leads, scrub_cache_backing, user_interactions.
-- Fix per table: drop the write policy, add `TO service_role` ALL; where the old
-- policy was the only read path for anon/authenticated, keep an explicit SELECT
-- policy so no reader loses rows; revoke INSERT/UPDATE/DELETE/TRUNCATE grants
-- from anon/authenticated (belt and braces: a future permissive policy still
-- writes nothing).
--
-- Writers, inventoried before the change:
--   edge_logs 2026-09-17..24 (24h windows; 09-19 12:00–00:00 unreadable on gov
--   only): ZERO anon/authenticated POST/PATCH/PUT/DELETE on /rest/v1/* on this
--   project. Every observed writer to the tables above is service_role:
--     python-httpx (Dialysis CMS pipeline / scheduler): facility_patient_counts,
--       cmbs_loans, cmbs_loan_properties, ingestion_tracker, scrub_cache (the view),
--       user_interactions — keys via config.get_supabase_client (service role).
--     Deno edge fns on this project (salesforce-enrichment, lead-ingest):
--       salesforce_accounts; marketing_leads (lead-ingest, last write 2026-08-31,
--       key prefix sb_secret_ = service role; its DIA_SUPABASE_KEY is NOT anon).
--     Railway (LCC detail.js proxy writes: lease_options etc.) service_role.
--   bd_execution_log, loopnet_listing_map, lease_rent_schedule, lease_extensions:
--     0 rows, no write in the window.
--   postgres and service_role have rolbypassrls; service_role keeps all grants.
-- No legitimate writer used anon, so no writer was re-routed.
-- ============================================================================

-- 1. Writable definer views: revoke the client write privileges, keep SELECT.
do $$
declare v record;
begin
  for v in
    select c.oid::regclass as rel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'v'
       and n.nspname = 'public'
       and pg_relation_is_updatable(c.oid, true) > 0
       and not coalesce(c.reloptions::text, '') ~* 'security_invoker=(on|true|1|yes)'
  loop
    execute format('revoke insert, update, delete, truncate on %s from public, anon, authenticated', v.rel);
  end loop;
end $$;

-- 2. Policies. Helper: replace every write-capable client policy on a table.
do $$
declare
  t text;
  p record;
  read_roles text;
begin
  foreach t in array array[
    'ingestion_tracker', 'cmbs_loans', 'cmbs_loan_properties', 'salesforce_accounts',
    'lease_rent_schedule', 'lease_extensions', 'lease_options', 'facility_patient_counts',
    'ingestion_log', 'bd_execution_log', 'loopnet_listing_map', 'marketing_leads',
    'scrub_cache_backing', 'user_interactions']
  loop
    -- Which client roles could READ through a write policy we are about to drop?
    -- (A USING (true) policy covering SELECT, for public/anon/authenticated.)
    select string_agg(distinct case when r = 0 then 'public' else r::regrole::text end, ', ')
      into read_roles
      from pg_policy pp cross join unnest(pp.polroles) r
     where pp.polrelid = ('public.' || t)::regclass
       and pp.polcmd = '*'
       and pg_get_expr(pp.polqual, pp.polrelid) = 'true'
       and (r = 0 or r in ('anon'::regrole::oid, 'authenticated'::regrole::oid));

    for p in
      select pp.polname from pg_policy pp
       where pp.polrelid = ('public.' || t)::regclass
         and pp.polcmd in ('*', 'a', 'w', 'd')
         and (pp.polroles @> array[0::oid]
              or pp.polroles && array['anon'::regrole::oid, 'authenticated'::regrole::oid])
    loop
      execute format('drop policy %I on public.%I', p.polname, t);
    end loop;

    execute format('drop policy if exists %I on public.%I', 'sec7_service_role_all_' || t, t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)',
                   'sec7_service_role_all_' || t, t);

    -- Keep the read surface exactly: the same roles keep a SELECT policy.
    if read_roles is not null then
      execute format('drop policy if exists %I on public.%I', 'sec7_client_read_' || t, t);
      execute format('create policy %I on public.%I for select to %s using (true)',
                     'sec7_client_read_' || t, t, read_roles);
    end if;

    execute format('revoke insert, update, delete, truncate on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 3. Standing guard: every client write path of the two phase-2a classes that
-- should not exist. Invoker rights; pg_relation_is_updatable and
-- has_table_privilege need no grant to answer.
create or replace function public.dia_sec7_write_path_violations()
returns table(kind text, object_name text, detail text)
language sql stable
set search_path = public, pg_temp
as $$
  -- (1) a writable definer view a client role can write through
  select 'writable_definer_view', c.oid::regclass::text, r.rol || ':' || p.priv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['anon', 'authenticated']) r(rol)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) p(priv)
   where c.relkind = 'v' and n.nspname = 'public'
     and pg_relation_is_updatable(c.oid, true) > 0
     and not coalesce(c.reloptions::text, '') ~* 'security_invoker=(on|true|1|yes)'
     and has_table_privilege(r.rol, c.oid, p.priv)
  union all
  -- (2) a policy that admits a client write unconditionally (WITH CHECK true,
  -- or no WITH CHECK and USING true), on any public table
  select 'client_write_policy', pp.polrelid::regclass::text,
         pp.polname || ' (' || pp.polcmd::text || ')'
    from pg_policy pp join pg_class c on c.oid = pp.polrelid
   where c.relnamespace = 'public'::regnamespace
     and pp.polcmd in ('*', 'a', 'w', 'd')
     and (pp.polroles @> array[0::oid]
          or pp.polroles && array['anon'::regrole::oid, 'authenticated'::regrole::oid])
     and (pg_get_expr(pp.polwithcheck, pp.polrelid) = 'true'
          or (pp.polwithcheck is null and pg_get_expr(pp.polqual, pp.polrelid) = 'true'))
  union all
  -- (3) a client write grant on one of the phase-2a tables
  select 'client_write_grant', ('public.' || t)::regclass::text, r.rol || ':' || p.priv
    from unnest(array[
      'ingestion_tracker', 'cmbs_loans', 'cmbs_loan_properties', 'salesforce_accounts',
      'lease_rent_schedule', 'lease_extensions', 'lease_options', 'facility_patient_counts',
      'ingestion_log', 'bd_execution_log', 'loopnet_listing_map', 'marketing_leads',
      'scrub_cache_backing', 'user_interactions']) t
   cross join unnest(array['anon', 'authenticated']) r(rol)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
   where has_table_privilege(r.rol, ('public.' || t)::regclass, p.priv)
$$;
revoke all on function public.dia_sec7_write_path_violations() from public, anon, authenticated;
grant execute on function public.dia_sec7_write_path_violations() to service_role;

-- 4. Assert on the catalog, never on the statements above (SEC1 doctrine).
do $$
declare n int;
begin
  select count(*) into n from public.dia_sec7_write_path_violations();
  if n > 0 then
    raise exception 'SEC7-PHASE2A: % client write path(s) remain on dia', n;
  end if;
  if not has_table_privilege('anon', 'public.v_sales_feed_portfolio', 'SELECT')
     or not has_table_privilege('anon', 'public.ingestion_tracker', 'SELECT') then
    raise exception 'SEC7-PHASE2A: a client read was lost';
  end if;
  if not has_table_privilege('service_role', 'public.ingestion_tracker', 'INSERT')
     or not has_table_privilege('service_role', 'public.scrub_cache', 'INSERT') then
    raise exception 'SEC7-PHASE2A: service_role lost a write the pipeline needs';
  end if;
  if has_function_privilege('anon', 'public.dia_sec7_write_path_violations()', 'EXECUTE') then
    raise exception 'SEC7-PHASE2A: guard function is anon-executable';
  end if;
end $$;

-- REVERSAL (restores the pre-phase-2a client writes; do not run without a reason):
--   grant insert, update, delete, truncate on <each view/table above> to anon, authenticated;
--   drop policy sec7_service_role_all_<t> / sec7_client_read_<t>, and recreate the
--   dropped policies from the list in the header (definitions in
--   docs/audits/SEC7_PHASE2A_2026-09-24.md §1).
