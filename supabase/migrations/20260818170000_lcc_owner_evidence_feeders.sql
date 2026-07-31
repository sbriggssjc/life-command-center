-- Owner-evidence feeders + orchestrator. APPLIED LIVE 2026-07-31 via MCP; mirrored for repo.

-- Feeder 1: outbound email → owner evidence (the team member who SENT mail on a deal).
create or replace function public.lcc_ingest_email_owner_evidence()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := 0;
begin
  with src as (
    select coalesce(
             ae.entity_id,
             case when ae.metadata->>'deal_entity_id'  ~ '^[0-9a-fA-F-]{36}$' then (ae.metadata->>'deal_entity_id')::uuid end,
             case when ae.metadata->>'party_entity_id' ~ '^[0-9a-fA-F-]{36}$' then (ae.metadata->>'party_entity_id')::uuid end
           ) as ent,
           lu.lcc_user_id as cand, ae.occurred_at
    from public.activity_events ae
    join public.lcc_users lu on lower(lu.email) = lower(ae.metadata->>'from')
    where ae.source_type = 'outlook_sent'
  ), agg as (
    select ent, cand, max(occurred_at) as last_at, count(*) as sends
    from src where ent is not null group by ent, cand
  ), ins as (
    insert into public.lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail)
    select ent, cand, 'email_outbound', 0.7, last_at, jsonb_build_object('sends', sends)
    from agg
    on conflict (entity_id, source, candidate_owner) do update
      set observed_at = greatest(public.lcc_owner_evidence.observed_at, excluded.observed_at),
          detail = excluded.detail, updated_at = now()
    returning 1
  )
  select count(*) into v_n from ins;
  return jsonb_build_object('ok',true,'email_outbound_evidence', v_n);
end $function$;

-- Feeder 2: SF Task owner map → evidence (weight 0.8). Same sf_id->entity resolution as
-- lcc_apply_owner_backfill, but records evidence instead of writing the override directly.
create or replace function public.lcc_record_sf_owner_evidence(
  p_map jsonb, p_source text default 'sf_task', p_weight numeric default 0.8)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_written int := 0; v_input int := 0; v_owner_unresolved int := 0;
begin
  if p_map is null or jsonb_typeof(p_map) <> 'array' then
    return jsonb_build_object('ok',false,'reason','p_map must be a JSON array');
  end if;

  create temp table _m on commit drop as
  select left(trim(x->>'sf_id'),15) as sf15,
         coalesce(
           lcc_map_sf_owner(trim(x->>'sf_owner_id')),
           (select lu.lcc_user_id from lcc_users lu where nullif(trim(x->>'owner_name'),'') is not null
              and lower(trim(lu.display_name))=lower(trim(x->>'owner_name')) and lu.active is not false limit 1),
           (select lu.lcc_user_id from lcc_users lu where nullif(trim(x->>'owner_email'),'') is not null
              and lower(trim(lu.email))=lower(trim(x->>'owner_email')) and lu.active is not false limit 1)
         ) as owner_user_id
  from jsonb_array_elements(p_map) x
  where nullif(trim(x->>'sf_id'),'') is not null;

  select count(*) into v_input from _m;
  select count(*) into v_owner_unresolved from _m where owner_user_id is null;

  create temp table _ent on commit drop as
  select distinct entity_id, owner_user_id from (
    select e.id as entity_id, m.owner_user_id from _m m
      join entities e on (
           left(e.metadata->'salesforce'->>'account_id',15)=m.sf15
        or left(e.metadata->>'sf_account',15)=m.sf15
        or left(e.metadata->>'sf_opp_id',15)=m.sf15)
     where m.owner_user_id is not null
    union
    select uc.entity_id, m.owner_user_id from _m m
      join unified_contacts uc on left(uc.sf_account_id,15)=m.sf15
     where m.owner_user_id is not null and uc.entity_id is not null
  ) s;

  with ins as (
    insert into public.lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail)
    select entity_id, owner_user_id, p_source, p_weight, now(), jsonb_build_object('via','sf_task')
    from _ent
    on conflict (entity_id, source, candidate_owner) do update
      set weight=greatest(public.lcc_owner_evidence.weight, excluded.weight), observed_at=now(), updated_at=now()
    returning 1
  )
  select count(*) into v_written from ins;

  return jsonb_build_object('ok',true,'input_ids',v_input,'evidence_written',v_written,'owner_unresolved',v_owner_unresolved);
end $function$;

-- Orchestrator: refresh pure-DB feeders (email) and reconcile everything.
create or replace function public.lcc_reconcile_owners_run(
  p_min_confidence numeric default 0.55, p_write boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_email jsonb; v_rec jsonb;
begin
  v_email := public.lcc_ingest_email_owner_evidence();
  v_rec   := public.lcc_reconcile_all_owners(p_min_confidence, p_write);
  return jsonb_build_object('ok',true,'email_feed',v_email,'reconcile',v_rec);
end $function$;
