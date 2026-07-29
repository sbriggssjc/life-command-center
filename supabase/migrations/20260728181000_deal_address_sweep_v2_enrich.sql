-- ============================================================================
-- 20260728181000_deal_address_sweep_v2_enrich.sql   (OPS project xengecqvemvfknjvbvrq)
-- Deal-address sweep v2. Applied live 2026-07-28. Two changes over v1:
--   (1) address match uses addr_key (street-level: house number + first 2 non-directional words) so a real
--       address matches a candidate despite zip/suffix/unit noise (full lcc_normalize_address equality was
--       too strict). lcc_normalize_address stays the canonical STORAGE form on the observation (addr_norm).
--   (2) link-or-ENRICH: when an authoritative address observation exists but matches NO candidate (the deal's
--       true property isn't in the candidate set — common), enrich the placeholder entity with the observed
--       address and clear the flag (keep_new). So ANY authoritative address observation resolves the deal.
-- Superseded body of reconcile_deal_addresses_sweep from 20260728180000_*.
-- ============================================================================
create or replace function public.reconcile_deal_addresses_sweep(p_tb_only boolean default true, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  v_threshold numeric := public.lcc_reconcile_match_threshold();
  v_tenant text; v_tword text;
  v_best_cid uuid; v_best_score numeric; v_ties int; v_second numeric;
  v_obs_addr text; v_obs_city text; v_obs_state text;
  v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_linked int := 0; v_enriched int := 0; v_queued int := 0;
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
                where ob.deal_entity_id = r.placeholder and ob.matchable and ob.address_raw is not null
                  and cc.caddr is not null and public.addr_key(cc.caddr) is not null
                  and public.addr_key(cc.caddr) = public.addr_key(ob.address_raw)
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
      select address_raw, city, state into v_obs_addr, v_obs_city, v_obs_state
      from public.lcc_deal_address_observations
      where deal_entity_id = r.placeholder and matchable and address_raw is not null
      order by authority desc nulls last, confidence desc nulls last, captured_at desc
      limit 1;

      if v_obs_addr is not null then
        if p_dry_run then
          v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
            'outcome','would_keep_enriched','address',v_obs_addr);
        else
          update public.entities
             set address = v_obs_addr,
                 city  = coalesce(nullif(btrim(coalesce(city,'')),''),  v_obs_city),
                 state = coalesce(nullif(btrim(coalesce(state,'')),''), v_obs_state)
           where id = r.placeholder;
          v_res := public.reconcile_entity(r.placeholder, null, true);
          v_enriched := v_enriched + 1;
          v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
            'outcome','kept_enriched','address',v_obs_addr,'result',v_res);
        end if;
      else
        v_queued := v_queued + 1;
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,
          'outcome','review','best_score',v_best_score,'ties',v_ties,
          'reason', case when v_best_score < v_threshold then 'awaiting_address_observation' else 'tie_needs_address' end);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'dry_run',p_dry_run,'threshold',v_threshold,
    'summary',jsonb_build_object('linked',v_linked,'enriched',v_enriched,'review',v_queued),'deals',v_results);
end;
$$;
