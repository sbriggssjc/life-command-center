-- ============================================================================
-- SEC7-PHASE2A (SEC7-views) — LCC Opps: close the writable-definer-view route.
-- LCC Opps (xengecqvemvfknjvbvrq). Owner: life-command-center. Applied live 2026-09-24.
-- Siblings: dia supabase/migrations/dialysis/20261013140000_dia_sec7_phase2a_write_paths.sql,
-- gov government-lease sql/20260924_gov_sec7_phase2a_write_paths.sql.
--
-- A view without security_invoker over one table is auto-updatable, and the
-- write runs as the view OWNER, past the base table's RLS. This project's anon
-- key ships in the SPA, so it is the most reachable of the three. Population
-- (pg_relation_is_updatable(oid, true) > 0, no security_invoker, anon or
-- authenticated holds INSERT/UPDATE/DELETE), measured live before this change: 21
--   v_build_brief_flag_long_dark            v_comms_owner_attribution_review_open
--   v_contact_acquisition_review_open       v_field_provenance_effective_source
--   v_field_source_priority_triage          v_junk_entity_review_open
--   v_lcc_canonical_name_drift              v_lcc_cre_thin_ocr_watch
--   v_lcc_deal_match_run_health             v_lcc_deal_match_stalled_runs
--   v_lcc_move_queue_worklist               v_lcc_ownership_chain_apply_run_health
--   v_lcc_ownership_chain_draft_run_health  v_lcc_ownership_chain_draft_stalled_runs
--   v_lcc_tier0_auto_attach_run_health      v_market_brief_live
--   v_naming_hygiene_review_open            v_operator_notes_stale_open
--   v_reachability_harvest_review_open      v_w8_u2_dup_pair_open
--   v_w8_u3_link_review_open
-- Several sit over review/decision tables (junk_entity_review, naming hygiene,
-- dup-pair, link review), so an anon write could have set a verdict.
--
-- Writers, from edge_logs 2026-09-17..24 (24h windows): the ONLY anon writes on
-- this project are Power Automate calling rpc/lcc_record_flow_failure (a function,
-- untouched here). Zero anon/authenticated POST/PATCH/DELETE to any v_* path or
-- base table. Railway writes as service_role, which keeps its grants.
-- Policies: this project has no client write policy with a literal true check
-- (its policies are has_workspace_role/get_lcc_user_id-gated); the guard still
-- counts one so a future `WITH CHECK (true)` is caught.
-- Fix: revoke INSERT/UPDATE/DELETE/TRUNCATE from public/anon/authenticated; SELECT kept.
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

-- 2. Standing guard (same shape as dia/gov, minus the per-table grant list).
create or replace function public.lcc_sec7_write_path_violations()
returns table(kind text, object_name text, detail text)
language sql stable
set search_path = public, pg_temp
as $$
  select 'writable_definer_view', c.oid::regclass::text, r.rol || ':' || p.priv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['anon', 'authenticated']) r(rol)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) p(priv)
   where c.relkind = 'v' and n.nspname = 'public'
     and pg_relation_is_updatable(c.oid, true) > 0
     and not coalesce(c.reloptions::text, '') ~* 'security_invoker=(on|true|1|yes)'
     and has_table_privilege(r.rol, c.oid, p.priv)
  union all
  select 'client_write_policy', pp.polrelid::regclass::text,
         pp.polname || ' (' || pp.polcmd::text || ')'
    from pg_policy pp join pg_class c on c.oid = pp.polrelid
   where c.relnamespace = 'public'::regnamespace
     and pp.polcmd in ('*', 'a', 'w', 'd')
     and (pp.polroles @> array[0::oid]
          or pp.polroles && array['anon'::regrole::oid, 'authenticated'::regrole::oid])
     and (pg_get_expr(pp.polwithcheck, pp.polrelid) = 'true'
          or (pp.polwithcheck is null and pg_get_expr(pp.polqual, pp.polrelid) = 'true'))
$$;
revoke all on function public.lcc_sec7_write_path_violations() from public, anon, authenticated;
grant execute on function public.lcc_sec7_write_path_violations() to service_role;

-- 3. Assert on the catalog, never on the statements above (SEC1 doctrine).
do $$
declare n int;
begin
  select count(*) into n from public.lcc_sec7_write_path_violations();
  if n > 0 then
    raise exception 'SEC7-PHASE2A: % client write path(s) remain on LCC Opps', n;
  end if;
  if not has_table_privilege('anon', 'public.v_market_brief_live', 'SELECT') then
    raise exception 'SEC7-PHASE2A: a client read was lost';
  end if;
  if has_function_privilege('anon', 'public.lcc_sec7_write_path_violations()', 'EXECUTE') then
    raise exception 'SEC7-PHASE2A: guard function is anon-executable';
  end if;
end $$;

-- REVERSAL: grant insert, update, delete, truncate on <each view above> to anon, authenticated;
