-- Owner Reconciliation Engine — source-agnostic, evidence-weighted, provenance-tagged.
-- APPLIED LIVE 2026-07-31 via MCP; mirrored here for repo history.
-- Every signal (SF Task, SF Opportunity, SF Campaign, outbound email, call, research,
-- manual) writes a weighted, timestamped vote; the reconciler scores candidates with
-- recency decay and writes the best answer to lcc_entity_owner_override with a confidence
-- score — never clobbering a human/manual override.

create table if not exists public.lcc_owner_evidence (
  entity_id       uuid not null,
  candidate_owner uuid not null,
  source          text not null,
  weight          numeric not null default 0.5,
  observed_at     timestamptz,
  detail          jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  primary key (entity_id, source, candidate_owner)
);
create index if not exists lcc_owner_evidence_entity_idx on public.lcc_owner_evidence(entity_id);

create or replace function public.lcc_record_owner_evidence(
  p_entity_id uuid, p_candidate uuid, p_source text,
  p_weight numeric default 0.5, p_observed_at timestamptz default now(), p_detail jsonb default '{}'::jsonb)
 returns void language sql security definer set search_path to 'public' as $function$
  insert into public.lcc_owner_evidence(entity_id, candidate_owner, source, weight, observed_at, detail)
  values (p_entity_id, p_candidate, p_source, coalesce(p_weight,0.5), coalesce(p_observed_at, now()), coalesce(p_detail,'{}'::jsonb))
  on conflict (entity_id, source, candidate_owner) do update
    set weight      = greatest(public.lcc_owner_evidence.weight, excluded.weight),
        observed_at = greatest(public.lcc_owner_evidence.observed_at, excluded.observed_at),
        detail      = excluded.detail,
        updated_at  = now();
$function$;

create or replace function public.lcc_reconcile_owner(
  p_entity_id uuid, p_min_confidence numeric default 0.55, p_write boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_top uuid; v_top_score numeric; v_second numeric := 0; v_total numeric;
  v_conf numeric; v_margin numeric; v_breakdown jsonb; v_wrote boolean := false; v_existing text;
begin
  with scored as (
    select candidate_owner,
           sum(weight * greatest(0.25, 1.0 - (current_date - coalesce(observed_at::date, current_date))::numeric / 365.0)) as score
    from public.lcc_owner_evidence where entity_id = p_entity_id
    group by candidate_owner
  ), ranked as (
    select candidate_owner, score,
           sum(score) over () as total,
           row_number() over (order by score desc) as rn,
           lead(score) over (order by score desc) as next_score
    from scored
  )
  select candidate_owner, score, total, coalesce(next_score,0)
    into v_top, v_top_score, v_total, v_second
  from ranked where rn = 1;

  if v_top is null or coalesce(v_total,0) = 0 then
    return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',null,'reason','no_evidence');
  end if;

  v_conf   := round(v_top_score / v_total, 3);
  v_margin := case when v_top_score = 0 then 0 else round((v_top_score - v_second) / v_top_score, 3) end;

  select jsonb_agg(jsonb_build_object('owner',candidate_owner,'score',round(score,3),
           'sources',(select jsonb_agg(distinct e.source) from public.lcc_owner_evidence e
                       where e.entity_id=p_entity_id and e.candidate_owner=s.candidate_owner))
           order by score desc)
    into v_breakdown
  from (select candidate_owner,
          sum(weight * greatest(0.25, 1.0 - (current_date - coalesce(observed_at::date, current_date))::numeric/365.0)) as score
        from public.lcc_owner_evidence where entity_id=p_entity_id group by candidate_owner) s;

  if p_write and v_conf >= p_min_confidence then
    select set_by into v_existing from public.lcc_entity_owner_override where entity_id = p_entity_id;
    if v_existing is null or v_existing like 'sf_owner%' or v_existing = 'reconciled' then
      insert into public.lcc_entity_owner_override(entity_id, owner_user_id, set_by, note)
      values (p_entity_id, v_top, 'reconciled',
              'conf='||v_conf||' margin='||v_margin||' '||left(coalesce(v_breakdown::text,''),400))
      on conflict (entity_id) do update
        set owner_user_id = excluded.owner_user_id, set_by = 'reconciled', note = excluded.note, set_at = now();
      v_wrote := true;
    end if;
  end if;

  return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',v_top,'confidence',v_conf,
    'margin',v_margin,'total_score',round(v_total,3),'wrote',v_wrote,'candidates',v_breakdown);
end $function$;

create or replace function public.lcc_reconcile_all_owners(
  p_min_confidence numeric default 0.55, p_write boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_e uuid; v_r jsonb; v_seen int := 0; v_wrote int := 0; v_lowconf int := 0;
begin
  for v_e in select distinct entity_id from public.lcc_owner_evidence loop
    v_r := public.lcc_reconcile_owner(v_e, p_min_confidence, p_write);
    v_seen := v_seen + 1;
    if (v_r->>'wrote')::boolean then v_wrote := v_wrote + 1;
    elsif (v_r->>'owner') is not null and (v_r->>'confidence')::numeric < p_min_confidence then v_lowconf := v_lowconf + 1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'entities_scored',v_seen,'overrides_written',v_wrote,'low_confidence',v_lowconf);
end $function$;
