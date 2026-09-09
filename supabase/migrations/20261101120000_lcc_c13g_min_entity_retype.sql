-- C13g-min — a single-row entity_type retype behind a human verdict.
--
-- NOT C13g. C13g is the capture-path fix at the transaction vendors (RCA/CoStar
-- file a company in a deal's "contact" slot and it is minted person-typed).
-- This is the minimum that unblocks the OWN-T0e merges the type guard is
-- correctly refusing today: ONE human verdict that retypes ONE entity,
-- reversibly, with the reason on a ledger. Nothing bulk, nothing lexical,
-- nothing automatic.
--
-- Measured 2026-09-09 (LCC Opps): live person-typed entities holding >=2
-- current lcc_entity_portfolio_facts rows = 18 / $69.4M current rent. 0 of 18
-- carry an org marker; 7 of 18 fail lcc_looks_like_person -- both instruments
-- are useless here (owner-role-classification.md sec 9b), which is why this
-- is a human verdict and not a rule. Two OWN-T0e cards are blocked on it today
-- (Gardner-Tanenbaum, MassMutual Life) -- see the retype-candidates view for
-- the honest, live-re-derivable population.

-- ---------------------------------------------------------------------------
-- 1. Reversible ledger. Mirrors the P149 shape (metadata.<key>_prior_entity_type
--    stamped on the entity itself, so a reversal predicate covers both this
--    ledger and any later bulk sweep that also stamps that key).
-- ---------------------------------------------------------------------------
create table if not exists lcc_entity_retype_log (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  from_type text not null,
  to_type text not null,
  decision_id uuid,
  reason text,
  retyped_at timestamptz not null default now(),
  retyped_by text,
  reverted_at timestamptz
);
create index if not exists idx_lcc_entity_retype_log_entity on lcc_entity_retype_log(entity_id);

revoke all on lcc_entity_retype_log from public, anon, authenticated;
grant select, insert, update on lcc_entity_retype_log to service_role;

-- ---------------------------------------------------------------------------
-- 2. The write. SECURITY DEFINER (called via PostgREST rpc/ with the service
--    key), so it carries the mandatory revoke + has_function_privilege stanza
--    (SEC1-definer-default). p_to is a closed, narrow allowlist -- a
--    person-or-asset destination is refused by name, not silently coerced.
-- ---------------------------------------------------------------------------
create or replace function lcc_retype_entity(
  p_entity uuid,
  p_to text,
  p_decision_id uuid default null,
  p_reason text default null,
  p_actor text default null
) returns table(
  ok boolean,
  entity_id uuid,
  from_type text,
  to_type text,
  log_id uuid,
  error text
) language plpgsql security definer set search_path = public as $$
declare
  v_row entities%rowtype;
  v_log_id uuid;
begin
  if p_to is distinct from 'organization' then
    return query select false, p_entity, null::text, p_to, null::uuid,
      'entity_type_review: p_to must be organization';
    return;
  end if;

  select * into v_row from entities where id = p_entity for update;
  if not found then
    return query select false, p_entity, null::text, p_to, null::uuid,
      'entity_type_review: entity not found';
    return;
  end if;
  if v_row.merged_into_entity_id is not null then
    return query select false, p_entity, v_row.entity_type::text, p_to, null::uuid,
      'entity_type_review: entity is a tombstone';
    return;
  end if;
  if v_row.entity_type::text is distinct from 'person' then
    return query select false, p_entity, v_row.entity_type::text, p_to, null::uuid,
      'entity_type_review: recorded entity_type is not person';
    return;
  end if;

  update entities
     set entity_type = p_to::entity_type,
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object('c13g_prior_entity_type', v_row.entity_type::text)
   where id = p_entity;

  insert into lcc_entity_retype_log(entity_id, from_type, to_type, decision_id, reason, retyped_by)
  values (p_entity, v_row.entity_type::text, p_to, p_decision_id, p_reason, p_actor)
  returning id into v_log_id;

  return query select true, p_entity, v_row.entity_type::text, p_to, v_log_id, null::text;
end;
$$;

revoke all on function lcc_retype_entity(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function lcc_retype_entity(uuid, text, uuid, text, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'lcc_retype_entity(uuid, text, uuid, text, text)', 'EXECUTE') then
    raise exception 'lcc_retype_entity must not be anon-executable';
  end if;
  if has_function_privilege('authenticated', 'lcc_retype_entity(uuid, text, uuid, text, text)', 'EXECUTE') then
    raise exception 'lcc_retype_entity must not be authenticated-executable';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The reversal. Restores from the ledger row (which is the reversal's
--    only source of truth -- never re-derive "what it was" any other way).
-- ---------------------------------------------------------------------------
create or replace function lcc_unretype_entity(p_entity uuid)
returns table(ok boolean, entity_id uuid, restored_type text, log_id uuid, error text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_log lcc_entity_retype_log%rowtype;
begin
  select * into v_log
    from lcc_entity_retype_log l
   where l.entity_id = p_entity and l.reverted_at is null
   order by l.retyped_at desc
   limit 1;
  if not found then
    return query select false, p_entity, null::text, null::uuid,
      'entity_type_review: no open retype log row for this entity';
    return;
  end if;

  update entities
     set entity_type = v_log.from_type::entity_type,
         metadata = (coalesce(metadata, '{}'::jsonb) - 'c13g_prior_entity_type')
   where id = p_entity;

  update lcc_entity_retype_log set reverted_at = now() where id = v_log.id;

  return query select true, p_entity, v_log.from_type, v_log.id, null::text;
end;
$$;

revoke all on function lcc_unretype_entity(uuid) from public, anon, authenticated;
grant execute on function lcc_unretype_entity(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'lcc_unretype_entity(uuid)', 'EXECUTE') then
    raise exception 'lcc_unretype_entity must not be anon-executable';
  end if;
  if has_function_privilege('authenticated', 'lcc_unretype_entity(uuid)', 'EXECUTE') then
    raise exception 'lcc_unretype_entity must not be authenticated-executable';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The lane source. Live person-typed entities with >=2 current facts,
--    UNION any person-typed member of an OWN-T0e spe_props_max>=2 group whose
--    sponsor is an organization (so a blocked card surfaces here even at 1
--    fact). Every recorded corroboration is a COLUMN, never a filter -- no
--    lexical guard decides membership or order here (owner-role-
--    classification.md sec 9b: the name-shape instruments are useless on
--    this population).
-- ---------------------------------------------------------------------------
create or replace view v_lcc_entity_retype_candidates as
with fact_pop as (
  select e.id as entity_id, e.name, e.entity_type,
         count(*) filter (where f.is_current) as current_facts,
         coalesce(sum(f.annual_rent) filter (where f.is_current), 0) as current_rent
    from entities e
    join lcc_entity_portfolio_facts f on f.entity_id = e.id
   where e.entity_type = 'person'
     and e.merged_into_entity_id is null
   group by e.id, e.name, e.entity_type
  having count(*) filter (where f.is_current) >= 2
),
own_t0e_blocked as (
  select distinct dup.id as entity_id, p.sponsor_id, p.sponsor_token
    from v_lcc_ownt0e_sponsor_family_proposals p
    cross join lateral unnest(p.spe_ids) as spe_id
    join entities dup on dup.id = spe_id
    join entities spo on spo.id = p.sponsor_id
   where p.spe_props_max >= 2
     and dup.entity_type = 'person'
     and dup.merged_into_entity_id is null
     and spo.entity_type = 'organization'
),
population as (
  select fp.entity_id, fp.name, fp.current_facts, fp.current_rent
    from fact_pop fp
  union
  select b.entity_id, e.name, coalesce(fp.current_facts, 0), coalesce(fp.current_rent, 0)
    from own_t0e_blocked b
    join entities e on e.id = b.entity_id
    left join fact_pop fp on fp.entity_id = b.entity_id
   where fp.entity_id is null
)
select
  p.entity_id,
  p.name,
  p.current_facts,
  p.current_rent,
  exists (
    select 1 from external_identities xi
     where xi.entity_id = p.entity_id and xi.source_system = 'salesforce' and xi.source_type = 'Contact'
  ) as has_salesforce_contact,
  exists (
    select 1 from external_identities xi
     where xi.entity_id = p.entity_id and xi.source_system = 'salesforce' and xi.source_type = 'Account'
  ) as has_salesforce_account,
  (select count(*) from external_identities xi
    where xi.entity_id = p.entity_id and xi.source_system = 'rca' and xi.source_type = 'contact') as n_rca_contact_ids,
  (select count(*) from external_identities xi
    where xi.entity_id = p.entity_id and xi.source_system = 'costar' and xi.source_type = 'contact') as n_costar_contact_ids,
  lcc_looks_like_person(p.name) as looks_like_person_warning,
  lcc_owner_name_has_org_marker(p.name) as has_org_marker,
  (select count(*) from entity_relationships er
    where er.from_entity_id = p.entity_id or er.to_entity_id = p.entity_id) as relationship_count,
  (select count(*) from lcc_property_owner po where po.owner_entity_id = p.entity_id) as resolved_owner_of,
  ob.sponsor_id as blocks_own_t0e_sponsor_id,
  ob.sponsor_token as blocks_own_t0e_token
from population p
left join lateral (
  select p2.sponsor_id, p2.sponsor_token
    from v_lcc_ownt0e_sponsor_family_proposals p2
   where p.entity_id = any(p2.spe_ids) and p2.spe_props_max >= 2
   order by p2.spe_props_max desc
   limit 1
) ob on true
order by (ob.sponsor_id is not null) desc, p.current_rent desc nulls last;

grant select on v_lcc_entity_retype_candidates to service_role;
