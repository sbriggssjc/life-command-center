-- Property-owner accuracy: operators are never owners (Scott's doctrine; the P0.1
-- failure recurring in the ownership graph). A few `owns` edges mis-captured the
-- OPERATOR as owner (e.g. "DaVita HealthCare Prtnrs" x3, "Fresenius Medical Care"
-- x1). Suppress by ENTITY ID (precise — legitimate owner-SPEs whose names contain
-- an operator string, e.g. "CG Davita WI LLC", "CSRE Davita Garfield Park LLC",
-- are NOT affected). Applied live to LCC Opps.
--
-- Effect verified: the 3 DaVita assets → Unresolved (correct per doctrine); the
-- Fresenius asset re-reconciled to a REAL owner candidate ("Platform Ventures",
-- a purchaser) that the operator had been drowning out — surfaced at conf 0.50,
-- just under the 0.55 bar, so left Unresolved honestly.
--
-- Grow lcc_owner_operator_block as more operators surface as owners (US Renal,
-- American Renal, DCI, Satellite, etc.) — always by the operator's entity id.
-- Reversal: DELETE FROM lcc_owner_operator_block WHERE owner_entity_id IN (...);
-- then re-run the relationship feeder to restore prior resolutions.

create table if not exists lcc_owner_operator_block (
  owner_entity_id uuid primary key,
  owner_name text,
  reason text,
  added_at timestamptz not null default now()
);

insert into lcc_owner_operator_block(owner_entity_id, owner_name, reason) values
  ('f931c234-22d4-429c-8a0b-5985496e22d3', 'DaVita HealthCare Prtnrs', 'operator, not owner'),
  ('0a419813-2049-4128-abc3-ba84ac54f233', 'Fresenius Medical Care', 'operator, not owner')
on conflict (owner_entity_id) do nothing;

create or replace function lcc_reconcile_property_owner(p_entity_id uuid, p_min_confidence numeric default 0.55, p_write boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_top uuid; v_top_score numeric; v_second numeric := 0; v_total numeric;
  v_conf numeric; v_margin numeric; v_name text; v_wrote boolean := false; v_source text;
begin
  with scored as (
    select candidate_owner_entity,
           sum(weight * greatest(0.25, 1.0 - (current_date - coalesce(observed_at::date, current_date))::numeric / 365.0)) as score
    from public.lcc_property_owner_evidence
    where entity_id = p_entity_id
      and candidate_owner_entity not in (select owner_entity_id from public.lcc_owner_operator_block)
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
  select string_agg(distinct source, ',') into v_source
    from public.lcc_property_owner_evidence
    where entity_id = p_entity_id and candidate_owner_entity = v_top;

  if p_write and v_conf >= p_min_confidence then
    insert into public.lcc_property_owner(entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
    values (p_entity_id, v_top, v_name, v_conf, v_margin, coalesce(v_source,'relationship_graph'), now(),
            jsonb_build_object('total_score', round(v_total,3)))
    on conflict (entity_id) do update
      set owner_entity_id = excluded.owner_entity_id, owner_name = excluded.owner_name,
          confidence = excluded.confidence, margin = excluded.margin,
          source = excluded.source, resolved_at = now(), detail = excluded.detail;
    v_wrote := true;
  end if;

  return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',v_top,'owner_name',v_name,
    'confidence',v_conf,'margin',v_margin,'source',coalesce(v_source,'relationship_graph'),'wrote',v_wrote);
end $function$;
