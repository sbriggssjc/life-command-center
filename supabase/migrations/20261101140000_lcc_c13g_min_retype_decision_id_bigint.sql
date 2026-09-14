-- ============================================================================
-- C13g-min-lane-fix-2 (2026-09-09): the retype verdict 502'd "retype_failed" --
-- lcc_retype_entity took p_decision_id UUID while lcc_decisions.id is BIGINT.
-- ----------------------------------------------------------------------------
-- Measured live on the first real verdict (decision 3879817, Gardner-Tanenbaum):
--   effects.error = 22P02 invalid input syntax for type uuid: "3879817"
-- The handler (api/admin.js entity_type_review verdict branch) passes the
-- lcc_decisions row id -- a bigint, as on every other lane -- and the RPC
-- declared uuid. The DB-side positive control never caught it because it
-- passed p_decision_id := null: a control that nulls the one argument the
-- caller always supplies does not exercise the contract.
--
-- Fix, DB-only (no JS change; the handler already sends the right value):
--   * lcc_entity_retype_log.decision_id uuid -> bigint (0 rows; safe)
--   * DROP the uuid-signature function FIRST (N15d/B1: a defaulted overload
--     left standing makes every call 42725 "function is not unique"), then
--     recreate with p_decision_id bigint; SEC1 revoke + has_function_privilege
--     stanza repeated on the NEW signature (ADDR1b: a port carries its logic,
--     not its privileges).
--   * assert at apply time that the parameter type equals lcc_decisions.id's,
--     so a future id-type change fails here instead of on the first verdict.
-- ============================================================================

alter table lcc_entity_retype_log alter column decision_id type bigint using null;

drop function if exists lcc_retype_entity(uuid, text, uuid, text, text);

create or replace function lcc_retype_entity(
  p_entity uuid,
  p_to text,
  p_decision_id bigint default null,
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

revoke all on function lcc_retype_entity(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function lcc_retype_entity(uuid, text, bigint, text, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'lcc_retype_entity(uuid, text, bigint, text, text)', 'EXECUTE') then
    raise exception 'lcc_retype_entity must not be anon-executable';
  end if;
  if has_function_privilege('authenticated', 'lcc_retype_entity(uuid, text, bigint, text, text)', 'EXECUTE') then
    raise exception 'lcc_retype_entity must not be authenticated-executable';
  end if;
end $$;

do $$
declare v_dec text; v_par text;
begin
  select data_type into v_dec from information_schema.columns where table_name='lcc_decisions' and column_name='id';
  select format_type(p.proargtypes[2], null) into v_par from pg_proc p where p.proname='lcc_retype_entity';
  if v_dec is distinct from v_par then
    raise exception 'lcc_retype_entity p_decision_id (%) must match lcc_decisions.id (%)', v_par, v_dec;
  end if;
end $$;

notify pgrst, 'reload schema';
