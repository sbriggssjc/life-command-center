-- ============================================================================
-- 20260729130000_deal_address_sweep_v3_closed_and_dedup.sql   (OPS xengecqvemvfknjvbvrq)
-- Deal-address sweep v3. Applied live 2026-07-29. Two changes over v2
-- (20260728181000_deal_address_sweep_v2_enrich.sql):
--
--   (1) p_include_closed: the sweep previously only touched OPEN deals (WHERE o.is_open),
--       leaving the CLOSED flagged backlog (won/lost deals still on a placeholder entity)
--       permanently unreconciled. v3 adds p_include_closed (default false — existing 2-arg
--       callers are unaffected). When true, closed deals are eligible too. A closed won deal
--       linked to its real property becomes a proper comp; a closed-lost is market history.
--
--   (2) addr_key dedup tie-break: when the top-scored candidates are all duplicate rows of a
--       SINGLE property (identical non-null addr_key), the "tie" is spurious — link to that
--       property. Guarded hard: applies ONLY when every max-score candidate shares ONE non-null
--       addr_key (no null addr_keys in the set). Genuinely distinct properties (different
--       addr_keys) still fall through to enrich/review untouched. No fabrication.
--
-- Confidence bar is unchanged from v2: a link still requires score >= threshold (a unique
-- tenant+geo match = 70). We are NOT lowering the bar for closed deals — only widening scope
-- and de-duplicating spurious ties.
--
-- Signature changes (2->3 args) so we DROP the old 2-arg function first; 2-arg calls
-- (the /api/pipeline route + crons) rebind to this 3-arg version via the defaults.
-- ============================================================================
drop function if exists public.reconcile_deal_addresses_sweep(boolean, boolean);

create or replace function public.reconcile_deal_addresses_sweep(
  p_tb_only boolean default true,
  p_dry_run boolean default true,
  p_include_closed boolean default false
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  v_threshold numeric := public.lcc_reconcile_match_threshold();
  v_tenant text; v_tword text;
  v_best_cid uuid; v_best_score numeric;
  v_top_raw int; v_top_distinct_ak int; v_top_null_ak int;
  v_unique boolean; v_link_reason text;
  v_obs_addr text; v_obs_city text; v_obs_state text;
  v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_linked int := 0; v_enriched int := 0; v_queued int := 0;
begin
  for r in
    select e.id as placeholder, e.name as deal, e.city as deal_city, e.state as deal_state,
           o.sf_opp_id, o.is_open, e.metadata->'ambiguous_resolution' as cands
    from public.bd_opportunities o join public.entities e on e.id=o.entity_id
    where o.workspace_id='a0000000-0000-0000-0000-000000000001'
      and (p_include_closed or o.is_open)
      and (e.metadata->'ambiguous_resolution') is not null
      and (not p_tb_only or o.owner_user_id in (select lcc_user_id from public.lcc_users where active))
  loop
    v_tenant := btrim(split_part(regexp_replace(r.deal, '\(.*\)', '', 'g'), ' - ', 1));
    v_tword  := lower(split_part(v_tenant, ' ', 1));
    if length(v_tword) < 4 then v_tword := null; end if;

    -- Score each candidate (identical scoring to v2), carrying addr_key for the dedup tie-break.
    with cc as (
      select (c->>'id')::uuid as cid, ce.address as caddr,
             ce.metadata->>'domain_property_id' as dpid,
             public.addr_key(ce.address) as ak
      from jsonb_array_elements(r.cands) c
      join public.entities ce on ce.id = (c->>'id')::uuid
    ),
    scored as (
      select cc.cid, cc.caddr, cc.ak,
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
    select (select max(score) from scored),
           (select count(*) from scored where score = (select max(score) from scored)),
           (select count(distinct ak) from scored where score = (select max(score) from scored) and ak is not null),
           (select count(*) from scored where score = (select max(score) from scored) and ak is null)
      into v_best_score, v_top_raw, v_top_distinct_ak, v_top_null_ak;

    -- Winner selection:
    --   (a) exactly one candidate at the max score            -> unique winner
    --   (b) all max-score candidates share ONE non-null addr_key -> spurious duplicate tie, collapse
    if v_top_raw = 1 then
      v_best_cid := (select cid from (
                       with cc as (
                         select (c->>'id')::uuid as cid, ce.address as caddr,
                                ce.metadata->>'domain_property_id' as dpid, public.addr_key(ce.address) as ak
                         from jsonb_array_elements(r.cands) c join public.entities ce on ce.id=(c->>'id')::uuid),
                       scored as (
                         select cc.cid, cc.caddr, cc.ak,
                           least(100, 10
                             + (case when v_tword is not null and exists (select 1 from public.lcc_property_attributes pa
                                  where pa.source_property_id=cc.dpid and (pa.tenant_short ilike '%'||v_tword||'%' or pa.tenant_label ilike '%'||v_tword||'%')) then 60 else 0 end)
                             + (case when exists (select 1 from public.lcc_deal_address_observations ob
                                  where ob.deal_entity_id=r.placeholder and ob.matchable and ob.address_raw is not null
                                    and cc.caddr is not null and public.addr_key(cc.caddr) is not null
                                    and public.addr_key(cc.caddr)=public.addr_key(ob.address_raw)) then 55 else 0 end)
                           ) as score
                         from cc)
                       select cid from scored order by score desc, cid limit 1) w);
      v_unique := true; v_link_reason := 'unique_winner';
    elsif v_best_score >= v_threshold and v_top_distinct_ak = 1 and v_top_null_ak = 0 then
      -- collapse: pick the most-complete representative of the single shared addr_key
      v_best_cid := (select cid from (
                       with cc as (
                         select (c->>'id')::uuid as cid, ce.address as caddr,
                                ce.metadata->>'domain_property_id' as dpid, public.addr_key(ce.address) as ak
                         from jsonb_array_elements(r.cands) c join public.entities ce on ce.id=(c->>'id')::uuid),
                       scored as (
                         select cc.cid, cc.caddr, cc.ak,
                           least(100, 10
                             + (case when v_tword is not null and exists (select 1 from public.lcc_property_attributes pa
                                  where pa.source_property_id=cc.dpid and (pa.tenant_short ilike '%'||v_tword||'%' or pa.tenant_label ilike '%'||v_tword||'%')) then 60 else 0 end)
                             + (case when exists (select 1 from public.lcc_deal_address_observations ob
                                  where ob.deal_entity_id=r.placeholder and ob.matchable and ob.address_raw is not null
                                    and cc.caddr is not null and public.addr_key(cc.caddr) is not null
                                    and public.addr_key(cc.caddr)=public.addr_key(ob.address_raw)) then 55 else 0 end)
                           ) as score
                         from cc)
                       select cid from scored where score = v_best_score and ak is not null
                        order by length(coalesce(caddr,'')) desc, cid limit 1) w);
      v_unique := true; v_link_reason := 'dup_addrkey_collapse';
    else
      v_best_cid := null; v_unique := false; v_link_reason := null;
    end if;

    if v_best_score >= v_threshold and v_unique then
      if p_dry_run then
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'is_open',r.is_open,
          'outcome','would_link','reason',v_link_reason,'canonical',v_best_cid,'score',v_best_score);
      else
        v_res := public.reconcile_entity(r.placeholder, v_best_cid, false);
        v_linked := v_linked + 1;
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'is_open',r.is_open,
          'outcome','linked','reason',v_link_reason,'canonical',v_best_cid,'score',v_best_score,'result',v_res);
      end if;
    else
      select address_raw, city, state into v_obs_addr, v_obs_city, v_obs_state
      from public.lcc_deal_address_observations
      where deal_entity_id = r.placeholder and matchable and address_raw is not null
      order by authority desc nulls last, confidence desc nulls last, captured_at desc
      limit 1;

      if v_obs_addr is not null then
        if p_dry_run then
          v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'is_open',r.is_open,
            'outcome','would_keep_enriched','address',v_obs_addr);
        else
          update public.entities
             set address = v_obs_addr,
                 city  = coalesce(nullif(btrim(coalesce(city,'')),''),  v_obs_city),
                 state = coalesce(nullif(btrim(coalesce(state,'')),''), v_obs_state)
           where id = r.placeholder;
          v_res := public.reconcile_entity(r.placeholder, null, true);
          v_enriched := v_enriched + 1;
          v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'is_open',r.is_open,
            'outcome','kept_enriched','address',v_obs_addr,'result',v_res);
        end if;
      else
        v_queued := v_queued + 1;
        v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'is_open',r.is_open,
          'outcome','review','best_score',v_best_score,'top_candidates',v_top_raw,'distinct_properties',v_top_distinct_ak,
          'reason', case when v_best_score < v_threshold then 'awaiting_address_observation' else 'tie_needs_address' end);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'dry_run',p_dry_run,'include_closed',p_include_closed,'threshold',v_threshold,
    'summary',jsonb_build_object('linked',v_linked,'enriched',v_enriched,'review',v_queued),'deals',v_results);
end;
$$;
