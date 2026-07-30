-- SF OwnerId capture → lcc_entity_owner_override (owner-scoped My Day; "SF default + LCC override").
-- APPLIED LIVE 2026-07-30 via MCP; this mirrors it into the repo migration history.
--
-- Why: lcc_my_day scopes a to-do to its effective owner via lcc_entity_owner_override
-- FIRST (then assigned_to/owner_id, but those FK the empty `users` auth table so they
-- can't hold Scott/Kelly). Populating the override per deal from its Salesforce owner is
-- the FK-safe way to separate each rep's work. Auto-created to-dos then inherit the deal's
-- owner automatically — no change to lcc_advance_todos needed.
--
-- Feed the sink a JSON array of {sf_id, <owner ref>} where sf_id is an Account or
-- Opportunity 15/18-char Id already stamped on entities/unified_contacts, and the owner is
-- given by sf_owner_id (005… User Id), owner_name (lcc_users.display_name), or owner_email.
-- Source can be a Salesforce report export or a live PA-flow op. Manual LCC overrides
-- (set_by not starting 'sf_owner') are never clobbered.

create or replace function public.lcc_apply_owner_backfill(p_map jsonb, p_set_by text default 'sf_owner_backfill')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_written int := 0; v_input int := 0; v_owner_unresolved int := 0; v_no_entity int := 0;
begin
  if p_map is null or jsonb_typeof(p_map) <> 'array' then
    return jsonb_build_object('ok',false,'reason','p_map must be a JSON array of {sf_id, sf_owner_id|owner_name|owner_email}');
  end if;

  create temp table _m on commit drop as
  select left(trim(x->>'sf_id'),15) as sf15,
         coalesce(
           lcc_map_sf_owner(trim(x->>'sf_owner_id')),
           (select lu.lcc_user_id from lcc_users lu
             where nullif(trim(x->>'owner_name'),'') is not null
               and lower(trim(lu.display_name)) = lower(trim(x->>'owner_name'))
               and lu.active is not false limit 1),
           (select lu.lcc_user_id from lcc_users lu
             where nullif(trim(x->>'owner_email'),'') is not null
               and lower(trim(lu.email)) = lower(trim(x->>'owner_email'))
               and lu.active is not false limit 1)
         ) as owner_user_id
  from jsonb_array_elements(p_map) x
  where nullif(trim(x->>'sf_id'),'') is not null;

  select count(*) into v_input from _m;
  select count(*) into v_owner_unresolved from _m where owner_user_id is null;

  create temp table _ent on commit drop as
  select distinct entity_id, owner_user_id, sf15 from (
    select e.id as entity_id, m.owner_user_id, m.sf15
      from _m m
      join entities e on (
           left(e.metadata->'salesforce'->>'account_id',15) = m.sf15
        or left(e.metadata->>'sf_account',15)                = m.sf15
        or left(e.metadata->>'sf_opp_id',15)                 = m.sf15)
     where m.owner_user_id is not null
    union
    select uc.entity_id, m.owner_user_id, m.sf15
      from _m m
      join unified_contacts uc on left(uc.sf_account_id,15) = m.sf15
     where m.owner_user_id is not null and uc.entity_id is not null
  ) s;

  select count(*) into v_no_entity
    from _m m
   where m.owner_user_id is not null
     and not exists (select 1 from _ent e where e.sf15 = m.sf15);

  with ins as (
    insert into lcc_entity_owner_override (entity_id, owner_user_id, set_by, note)
    select entity_id, owner_user_id, p_set_by, 'sf:'||sf15 from _ent
    on conflict (entity_id) do update
      set owner_user_id = excluded.owner_user_id, set_at = now(), note = excluded.note, set_by = excluded.set_by
      where coalesce(lcc_entity_owner_override.set_by,'') like 'sf_owner%'  -- preserve manual LCC overrides
         or lcc_entity_owner_override.set_by is null
    returning 1
  )
  select count(*) into v_written from ins;

  return jsonb_build_object('ok',true,'input_ids',v_input,'entities_written',v_written,
    'owner_unresolved',v_owner_unresolved,'resolved_no_entity_match',v_no_entity);
end $function$;

-- Single-entity live hook (keep-fresh when a deal links/relinks to a Salesforce record).
create or replace function public.lcc_set_entity_owner_from_sf(p_entity_id uuid, p_sf_owner_id text, p_set_by text default 'sf_owner_live')
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_owner uuid;
begin
  if p_entity_id is null then return false; end if;
  v_owner := lcc_map_sf_owner(p_sf_owner_id);
  if v_owner is null then return false; end if;
  insert into lcc_entity_owner_override (entity_id, owner_user_id, set_by, note)
  values (p_entity_id, v_owner, p_set_by, 'sf_owner:'||coalesce(p_sf_owner_id,''))
  on conflict (entity_id) do update
    set owner_user_id = excluded.owner_user_id, set_at = now(), note = excluded.note, set_by = excluded.set_by
    where coalesce(lcc_entity_owner_override.set_by,'') like 'sf_owner%'
       or lcc_entity_owner_override.set_by is null;
  return true;
end $function$;