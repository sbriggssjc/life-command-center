-- Owner-evidence feeders 3 & 4 + orchestrator update. APPLIED LIVE 2026-07-31 via MCP.
-- Feeds bd_opportunities (deal owner, weight 0.9) and touchpoint_cadence (cadence owner,
-- weight 0.5) into the reconciliation engine so active deals + cadence entities are
-- attributed through the same override, and the daily reconcile keeps them fresh.

create or replace function public.lcc_ingest_deal_owner_evidence()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := 0;
begin
  with src as (
    select b.entity_id as ent,
           coalesce((select lu.lcc_user_id from lcc_users lu where lu.lcc_user_id = b.owner_user_id and lu.active is not false),
                    lcc_map_sf_owner(b.metadata->>'owner_sf_user_id')) as cand,
           coalesce(b.updated_at, b.opened_at, now()) as obs
    from bd_opportunities b
    where b.is_open and b.entity_id is not null
  ), agg as (
    select ent, cand, max(obs) last_at, count(*) deals from src where cand is not null group by ent, cand
  ), ins as (
    insert into lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail)
    select ent, cand, 'deal_owner', 0.9, last_at, jsonb_build_object('open_deals', deals) from agg
    on conflict (entity_id, source, candidate_owner) do update
      set observed_at = greatest(lcc_owner_evidence.observed_at, excluded.observed_at),
          detail = excluded.detail, updated_at = now()
    returning 1
  ) select count(*) into v_n from ins;
  return jsonb_build_object('ok',true,'deal_owner_evidence', v_n);
end $function$;

create or replace function public.lcc_ingest_cadence_owner_evidence()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := 0;
begin
  with src as (
    select tc.entity_id as ent, tc.owner_user_id as cand, coalesce(tc.last_touch_at, tc.updated_at, now()) as obs
    from touchpoint_cadence tc
    join lcc_users lu on lu.lcc_user_id = tc.owner_user_id and lu.active is not false
    where tc.entity_id is not null
  ), agg as (select ent, cand, max(obs) last_at, count(*) rows_n from src group by ent, cand),
  ins as (
    insert into lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail)
    select ent, cand, 'cadence_owner', 0.5, last_at, jsonb_build_object('cadence_rows', rows_n) from agg
    on conflict (entity_id, source, candidate_owner) do update
      set observed_at = greatest(lcc_owner_evidence.observed_at, excluded.observed_at),
          detail = excluded.detail, updated_at = now()
    returning 1
  ) select count(*) into v_n from ins;
  return jsonb_build_object('ok',true,'cadence_owner_evidence', v_n);
end $function$;

create or replace function public.lcc_reconcile_owners_run(
  p_min_confidence numeric default 0.55, p_write boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_email jsonb; v_deal jsonb; v_cad jsonb; v_rec jsonb;
begin
  v_email := public.lcc_ingest_email_owner_evidence();
  v_deal  := public.lcc_ingest_deal_owner_evidence();
  v_cad   := public.lcc_ingest_cadence_owner_evidence();
  v_rec   := public.lcc_reconcile_all_owners(p_min_confidence, p_write);
  return jsonb_build_object('ok',true,'email_feed',v_email,'deal_feed',v_deal,'cadence_feed',v_cad,'reconcile',v_rec);
end $function$;
