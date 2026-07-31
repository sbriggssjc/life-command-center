-- ============================================================================
-- Property-owner subsystem — SEPARATE from the point-person machinery.
-- ----------------------------------------------------------------------------
-- Finding (2026-07-31): the existing "owner reconciliation" (lcc_owner_evidence
-- -> lcc_reconcile_owner -> lcc_entity_owner_override.owner_user_id) actually
-- resolves the POINT PERSON who works a deal (an lcc_user), and My Work scoping
-- reads that column. All 102 override rows are set_by='reconciled' with an
-- lcc_user owner. Property OWNERSHIP (which company owns the building) was never
-- modeled -- hence the operator-as-owner fallback. Feeding owner ENTITIES through
-- the point-person engine would corrupt My Work scoping. So property-owner gets
-- its own evidence table + reconciler + store, touching nothing point-person.
-- See docs/architecture/property-owner-subsystem.md.
-- ============================================================================

create table if not exists public.lcc_property_owner_evidence (
  entity_id              uuid        not null,
  candidate_owner_entity uuid        not null,
  source                 text        not null,
  weight                 numeric     not null default 1.0,
  observed_at            timestamptz,
  detail                 jsonb       not null default '{}'::jsonb,
  updated_at             timestamptz not null default now(),
  primary key (entity_id, candidate_owner_entity, source)
);
create index if not exists idx_lcc_property_owner_evidence_entity
  on public.lcc_property_owner_evidence(entity_id);

create table if not exists public.lcc_property_owner (
  entity_id       uuid        primary key,
  owner_entity_id uuid,
  owner_name      text,
  confidence      numeric,
  margin          numeric,
  source          text,
  resolved_at     timestamptz not null default now(),
  detail          jsonb       not null default '{}'::jsonb
);

create or replace function public.lcc_record_property_owner_evidence(
  p_entity_id uuid, p_candidate uuid, p_source text,
  p_weight numeric default 1.0, p_observed_at timestamptz default now(),
  p_detail jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path to 'public'
as $$
  insert into public.lcc_property_owner_evidence(entity_id, candidate_owner_entity, source, weight, observed_at, detail)
  values (p_entity_id, p_candidate, p_source, coalesce(p_weight,1.0), coalesce(p_observed_at, now()), coalesce(p_detail,'{}'::jsonb))
  on conflict (entity_id, candidate_owner_entity, source) do update
    set weight = excluded.weight, observed_at = excluded.observed_at,
        detail = excluded.detail, updated_at = now();
$$;

create or replace function public.lcc_reconcile_property_owner(
  p_entity_id uuid, p_min_confidence numeric default 0.55, p_write boolean default true
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_top uuid; v_top_score numeric; v_second numeric := 0; v_total numeric;
  v_conf numeric; v_margin numeric; v_name text; v_wrote boolean := false;
begin
  with scored as (
    select candidate_owner_entity,
           sum(weight * greatest(0.25, 1.0 - (current_date - coalesce(observed_at::date, current_date))::numeric / 365.0)) as score
    from public.lcc_property_owner_evidence where entity_id = p_entity_id
    group by candidate_owner_entity
  ), ranked as (
    select candidate_owner_entity, score,
           sum(score) over () as total,
           row_number() over (order by score desc) as rn,
           lead(score) over (order by score desc) as next_score
    from scored
  )
  select candidate_owner_entity, score, total, coalesce(next_score,0)
    into v_top, v_top_score, v_total, v_second
  from ranked where rn = 1;

  if v_top is null or coalesce(v_total,0) = 0 then
    return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',null,'reason','no_evidence');
  end if;

  v_conf   := round(v_top_score / v_total, 3);
  v_margin := case when v_top_score = 0 then 0 else round((v_top_score - v_second) / v_top_score, 3) end;
  select name into v_name from public.entities where id = v_top;

  if p_write and v_conf >= p_min_confidence then
    insert into public.lcc_property_owner(entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
    values (p_entity_id, v_top, v_name, v_conf, v_margin, 'relationship_graph', now(),
            jsonb_build_object('total_score', round(v_total,3)))
    on conflict (entity_id) do update
      set owner_entity_id = excluded.owner_entity_id, owner_name = excluded.owner_name,
          confidence = excluded.confidence, margin = excluded.margin,
          source = excluded.source, resolved_at = now(), detail = excluded.detail;
    v_wrote := true;
  end if;

  return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',v_top,'owner_name',v_name,
    'confidence',v_conf,'margin',v_margin,'wrote',v_wrote);
end $function$;

create or replace function public.lcc_ingest_relationship_property_owner(
  p_limit int default 300, p_entity_id uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_assets int := 0; v_ev int := 0; v_resolved int := 0; r record; rec record;
begin
  for r in
    select distinct er.to_entity_id as asset
    from public.entity_relationships er
    where er.relationship_type in ('purchases','owns')
      and er.to_entity_id is not null
      and (p_entity_id is null or er.to_entity_id = p_entity_id)
      and (p_entity_id is not null
           or not exists (select 1 from public.lcc_property_owner po where po.entity_id = er.to_entity_id))
    limit greatest(1, coalesce(p_limit,300))
  loop
    v_assets := v_assets + 1;
    for rec in
      select er.from_entity_id as cand, er.relationship_type as rt,
             coalesce(er.effective_from, er.created_at::date) as odate
      from public.entity_relationships er
      where er.to_entity_id = r.asset
        and er.relationship_type in ('purchases','owns')
        and er.from_entity_id is not null
        and (er.relationship_type = 'purchases' or er.effective_to is null)
    loop
      perform public.lcc_record_property_owner_evidence(
        r.asset, rec.cand,
        case rec.rt when 'purchases' then 'rel_purchase' else 'rel_owns' end,
        case rec.rt when 'purchases' then 4.0 else 3.0 end,
        rec.odate::timestamptz, jsonb_build_object('rel', rec.rt));
      v_ev := v_ev + 1;
    end loop;
    if (public.lcc_reconcile_property_owner(r.asset) ->> 'wrote')::boolean then
      v_resolved := v_resolved + 1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'assets',v_assets,'evidence_rows',v_ev,'resolved',v_resolved);
end $function$;

grant execute on function public.lcc_record_property_owner_evidence(uuid,uuid,text,numeric,timestamptz,jsonb) to anon, authenticated, service_role;
grant execute on function public.lcc_reconcile_property_owner(uuid,numeric,boolean) to anon, authenticated, service_role;
grant execute on function public.lcc_ingest_relationship_property_owner(int,uuid) to anon, authenticated, service_role;

comment on table public.lcc_property_owner is
'Reconciled PROPERTY owner (which entity owns the building) -- distinct from lcc_entity_owner_override.owner_user_id, which is the POINT PERSON (lcc_user) who works the deal. Read this for the property panel Owner field.';
