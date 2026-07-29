-- ============================================================================
-- 20260728180000_deal_address_observations_engine.sql   (OPS project xengecqvemvfknjvbvrq)
-- Phase 1 of deal-address resolution (see docs/os/architecture/deal-address-resolution-design.md).
-- Mirrors the Owner Reconcile Engine: an address-observation table + a scored reconcile sweep that resolves
-- flagged deals via the shared lcc_normalize_address + lcc_reconcile_match_threshold, combining address
-- observations (Phase 2 feeds) with the tenant signal from lcc_property_attributes and a geo prior.
-- Applied live 2026-07-28. Dry-run at ship: DCi auto-resolves (tenant match, score 70); the other 5 flagged
-- deals correctly queue for review pending an address feed.
-- ============================================================================

create table if not exists public.lcc_deal_address_observations (
  id                  bigint generated always as identity primary key,
  deal_entity_id      uuid not null,
  sf_opp_id           text,
  deal_name           text,
  candidate_entity_id uuid,
  source_surface      text not null,
  address_raw         text,
  addr_norm           text,
  city                text,
  state               text,
  authority           numeric default 50,
  confidence          numeric default 50,
  matchable           boolean default true,
  source_url          text,
  source_context      jsonb,
  captured_at         timestamptz default now()
);
create index if not exists idx_deal_addr_obs_deal on public.lcc_deal_address_observations(deal_entity_id);
alter table public.lcc_deal_address_observations enable row level security;

create or replace function public.lcc_record_deal_address_observation(
  p_deal_entity_id uuid, p_sf_opp_id text, p_deal_name text, p_candidate_entity_id uuid,
  p_source_surface text, p_address text, p_city text, p_state text,
  p_authority numeric default 50, p_confidence numeric default 50,
  p_source_url text default null, p_source_context jsonb default null
) returns bigint language plpgsql security definer set search_path to 'public'
as $$
declare v_id bigint;
begin
  insert into public.lcc_deal_address_observations
    (deal_entity_id, sf_opp_id, deal_name, candidate_entity_id, source_surface, address_raw, addr_norm,
     city, state, authority, confidence, source_url, source_context)
  values
    (p_deal_entity_id, p_sf_opp_id, p_deal_name, p_candidate_entity_id, p_source_surface, p_address,
     public.lcc_normalize_address(p_address), p_city, p_state, p_authority, p_confidence, p_source_url, p_source_context)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.reconcile_deal_addresses_sweep(p_tb_only boolean default true, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  v_threshold numeric := public.lcc_reconcile_match_threshold();
  v_tenant text; v_tword text;
  v_best_cid uuid; v_best_score numeric; v_ties int; v_second numeric;
  v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_linked int := 0; v_queued int := 0;
begin
  for r in
    select e.id as placeholder, e.name as deal, e.city as deal_city, e.state as deal_state,
           o.sf_opp_id, e.metadata->'ambiguous_resolution' as cands
    from public.bd_opportunities o join public.entities e on e.id=o.entity_id
    where o.workspace_id='a0000000-0000-0000-0000-000000000001' and o.is_open
      and (e.metadata->'ambiguous_resolution') is not null
      and (not p_tb_only or o.owner_user_id in (select lcc_user_id from public.lcc_users where active))
  loop
    v_tenant := btrim(split_part(regexp_replace(r.deal, '\(.*\)', '', 'g'), ' - ', 1));
    v_tword  := lower(split_part(v_tenant, ' ', 1));
    if length(v_tword) < 4 then v_tword := null; end if;

    with cc as (
      select (c->>'id')::uuid as cid, ce.address as caddr, ce.metadata->>'domain_property_id' as dpid
      from jsonb_array_elements(r.cands) c
      join public.entities ce on ce.id = (c->>'id')::uuid
    ),
    scored as (
      select cc.cid,
        least(100,
          10
          + (case when v_tword is not null and exists (
               select 1 from public.lcc_property_attributes pa
                where pa.source_property_id = cc.dpid
                  and (pa.tenant_short ilike '%'||v_tword||'%' or pa.tenant_label ilike '%'||v_tword||'%')
             ) then 60 else 0 end)
          + (case when exists (
               select 1 from public.lcc_deal_address_observations ob
                where ob.deal_entity_id = r.placeholder and ob.addr_norm is not null and cc.caddr is not null
                  and public.lcc_normalize_address(cc.caddr) = ob.addr_norm
             ) then 55 else 0 end)
        ) as score
      from cc
    )
    select (select cid from scored order by score desc, cid limit 1),
           (select max(score) from scored),
           (select count(*) from scored where score = (select max(score) from scored)),
           coalesce((select score from scored order by score desc offset 1 limit 1), 0)
      into v_best_cid, v_best_score, v_ties, v_second;

    if v_best_score >= v_threshold and v_ties = 1 then
      if p_dry_run then
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
          'outcome','would_link','canonical',v_best_cid,'score',v_best_score,'runner_up',v_second);
      else
        v_res := public.reconcile_entity(r.placeholder, v_best_cid, false);
        v_linked := v_linked + 1;
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
          'outcome','linked','canonical',v_best_cid,'score',v_best_score,'result',v_res);
      end if;
    else
      v_queued := v_queued + 1;
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
        'outcome','review','best_score',v_best_score,'ties',v_ties,
        'reason', case when v_best_score < v_threshold then 'below_threshold_no_signal' else 'tie_needs_address' end);
    end if;
  end loop;
  return jsonb_build_object('ok',true,'dry_run',p_dry_run,'threshold',v_threshold,
    'summary',jsonb_build_object('linked',v_linked,'review',v_queued),'deals',v_results);
end;
$$;
