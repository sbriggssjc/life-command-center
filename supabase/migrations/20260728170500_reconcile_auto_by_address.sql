-- ============================================================================
-- 20260728170500_reconcile_auto_by_address.sql   (OPS project xengecqvemvfknjvbvrq)
-- A1 auto-reconcile. Applied live 2026-07-28. addr_key() is the SQL twin of opportunity-sync.js addrKey()
-- (leading street number + first 2 non-directional words); reconcile_auto_by_address() matches each flagged
-- open deal's property_address to exactly one candidate asset and (unless dry_run) calls reconcile_entity.
-- ============================================================================

create or replace function public.addr_key(a text)
returns text language plpgsql immutable as $$
declare
  s text; num text; rest text; w text; kept text[] := '{}';
  dir text[] := array['n','s','e','w','north','south','east','west','ne','nw','se','sw'];
begin
  s := trim(regexp_replace(lower(coalesce(a,'')), '[^a-z0-9]+', ' ', 'g'));
  if s !~ '^[0-9]+ .+' then return null; end if;
  num := (regexp_match(s, '^([0-9]+) '))[1];
  rest := trim(regexp_replace(s, '^[0-9]+ +', ''));
  foreach w in array string_to_array(rest, ' ') loop
    if w <> '' and not (w = any(dir)) then
      kept := array_append(kept, w);
      exit when array_length(kept,1) >= 2;
    end if;
  end loop;
  if array_length(kept,1) is null then return null; end if;
  return num || ' ' || array_to_string(kept, ' ');
end;
$$;

create or replace function public.reconcile_auto_by_address(p_tb_only boolean default true, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  r record; v_key text; v_matches uuid[]; v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_merged int := 0; v_ambiguous int := 0; v_noaddr int := 0; v_nomatch int := 0;
begin
  for r in
    select e.id as placeholder, e.name as deal, o.property_address as deal_addr,
           e.metadata->'ambiguous_resolution' as cands
    from public.bd_opportunities o join public.entities e on e.id=o.entity_id
    where o.workspace_id='a0000000-0000-0000-0000-000000000001' and o.is_open
      and (e.metadata->'ambiguous_resolution') is not null
      and (not p_tb_only or o.owner_user_id in (select lcc_user_id from public.lcc_users where active))
  loop
    v_key := public.addr_key(r.deal_addr);
    if v_key is null then
      v_noaddr := v_noaddr + 1;
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'outcome','no_deal_address');
      continue;
    end if;
    select array_agg(cand_id) into v_matches from (
      select (c->>'id')::uuid as cand_id
      from jsonb_array_elements(r.cands) c
      join public.entities ce on ce.id = (c->>'id')::uuid
      where public.addr_key(ce.address) = v_key
    ) z;
    if v_matches is null then
      v_nomatch := v_nomatch + 1;
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'deal_key',v_key,'outcome','no_candidate_match');
    elsif array_length(v_matches,1) <> 1 then
      v_ambiguous := v_ambiguous + 1;
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'deal_key',v_key,'outcome','multi_candidate_match','n',array_length(v_matches,1));
    elsif p_dry_run then
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'outcome','would_merge','canonical',v_matches[1]);
    else
      v_res := public.reconcile_entity(r.placeholder, v_matches[1], false);
      v_merged := v_merged + 1;
      v_results := v_results || jsonb_build_object('deal',r.deal,'placeholder',r.placeholder,'outcome','merged','canonical',v_matches[1],'result',v_res);
    end if;
  end loop;
  return jsonb_build_object('ok',true,'dry_run',p_dry_run,
    'summary',jsonb_build_object('merged',v_merged,'ambiguous',v_ambiguous,'no_address',v_noaddr,'no_match',v_nomatch),
    'deals',v_results);
end;
$$;
