-- ===========================================================================
-- SEC1-unit2 Unit 3 — port GOVDUP1-a's sf_property_id pre-link to dia
-- (applied live 2026-09-05 to zqzrriwuavgrquhisnoa).
--
-- Sized first, per the SEC1-unit2 prompt: 65 rows / 64 distinct
-- sf_property_id in pending_updates(field_name='_new_property'), 15 in the
-- last 30 days, newest 2026-09-03 -- one fan-out of 64, live writer, no
-- dedupe key. dia's payload column is new_value->>'sf_property_id', NOT
-- gov's source_context->>'sf_property_id' -- a gov-shaped census would read
-- 0 here and look clean. dia.properties has no status/archived column and
-- no created_at, so the backfill tie-break is earliest property_id only
-- (gov's live-vs-archived preference does not apply here).
--
-- Mechanism ported verbatim from
-- supabase/migrations/government/20260905130000_gov_govdup1a_sf_property_identity_dedupe.sql:
-- a durable identity map, a BEFORE INSERT trigger that pre-links a staging
-- row whose SF identity is already known (so the auto-create writer's own
-- linked_property_id=is.null selection never reaches it again), an AFTER
-- trigger that keeps the map current from either writer, and a belt-and-
-- braces AFTER INSERT on pending_updates that also learns the identity from
-- the advisory row if the staging PATCH itself failed.
--
-- NOT ported: GOVDUP1-a's Unit-c archived-parent retire arm on
-- expire_orphan_pending_updates -- out of scope ("prevention, not cleanup");
-- dia has not (yet) produced the equivalent stale-advisory backlog.
--
-- REVERSAL RUNBOOK:
--   drop trigger if exists trg_dia_sf_staging_identity_dedupe on public.sf_property_staging;
--   drop trigger if exists trg_dia_sf_staging_identity_record on public.sf_property_staging;
--   drop trigger if exists trg_dia_pending_new_property_identity on public.pending_updates;
--   drop function if exists public.dia_sf_staging_identity_dedupe();
--   drop function if exists public.dia_sf_staging_identity_record();
--   drop function if exists public.dia_pending_new_property_identity();
--   drop function if exists public.dia_sf_identity_record(text, integer, text);
--   drop view if exists public.v_dia_sf_property_fanout;
--   drop table if exists public.dia_sf_property_identity;
--
-- Full writeup: docs/audits/SEC1_UNIT2_RESULTS_2026-09-05.md
-- ===========================================================================

create table if not exists public.dia_sf_property_identity (
  sf_property_id text primary key,
  property_id    integer not null references public.properties(property_id) on delete cascade,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  source         text not null default 'sec1_unit2_govdup1a_port'
);

comment on table public.dia_sf_property_identity is
  'SEC1-unit2 Unit 3 (GOVDUP1-a port): sf_property_id -> canonical dia property_id. '
  'The dedupe key for the Salesforce auto-create fan-out. Keyed on the SF identity, '
  'never the address.';

create or replace function public.dia_sf_identity_record(
  p_sf_property_id text,
  p_property_id    integer,
  p_source         text default 'sec1_unit2_govdup1a_port'
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if p_sf_property_id is null or btrim(p_sf_property_id) = '' or p_property_id is null then
    return;
  end if;
  -- FILL-BLANKS: the first identity recorded wins.
  insert into public.dia_sf_property_identity (sf_property_id, property_id, source)
  values (btrim(p_sf_property_id), p_property_id, p_source)
  on conflict (sf_property_id) do update
    set last_seen_at = now()
  where public.dia_sf_property_identity.property_id = excluded.property_id;
exception when others then
  -- fail-soft: an identity bookkeeping failure must never abort an ingest.
  null;
end;
$fn$;

revoke all on function public.dia_sf_identity_record(text, integer, text) from public, anon, authenticated;
grant execute on function public.dia_sf_identity_record(text, integer, text) to service_role;

insert into public.dia_sf_property_identity (sf_property_id, property_id, source)
select sf_id, property_id, 'sec1_unit2_govdup1a_port_backfill'
from (
  select distinct on (pu.new_value->>'sf_property_id')
         pu.new_value->>'sf_property_id' as sf_id,
         pu.property_id
    from public.pending_updates pu
   where pu.field_name = '_new_property'
     and pu.property_id is not null
     and nullif(btrim(coalesce(pu.new_value->>'sf_property_id','')), '') is not null
   order by pu.new_value->>'sf_property_id', pu.property_id asc
) s
on conflict (sf_property_id) do nothing;

create or replace function public.dia_sf_staging_identity_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pid integer;
begin
  if new.linked_property_id is not null then
    return new;
  end if;
  if new.sf_property_id is null or btrim(new.sf_property_id) = '' then
    return new;
  end if;

  select i.property_id into v_pid
    from public.dia_sf_property_identity i
   where i.sf_property_id = btrim(new.sf_property_id);

  if v_pid is null then
    return new;
  end if;

  new.linked_property_id := v_pid;
  new.match_method       := 'sf_identity_dedupe';
  new.match_confidence   := 1.0;
  new.process_status     := 'linked';
  new.processed          := true;
  new.processed_at       := now();
  new.process_notes      := 'SEC1-unit2/GOVDUP1-a port: deduped on sf_property_id -> existing dia property '
                            || v_pid || ' (no new property minted)';
  return new;
end;
$fn$;

revoke all on function public.dia_sf_staging_identity_dedupe() from public, anon, authenticated;

drop trigger if exists trg_dia_sf_staging_identity_dedupe on public.sf_property_staging;
create trigger trg_dia_sf_staging_identity_dedupe
  before insert on public.sf_property_staging
  for each row execute function public.dia_sf_staging_identity_dedupe();

create or replace function public.dia_sf_staging_identity_record()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.linked_property_id is not null then
    perform public.dia_sf_identity_record(new.sf_property_id, new.linked_property_id, 'sf_property_staging');
  end if;
  return null;
end;
$fn$;

revoke all on function public.dia_sf_staging_identity_record() from public, anon, authenticated;

drop trigger if exists trg_dia_sf_staging_identity_record on public.sf_property_staging;
create trigger trg_dia_sf_staging_identity_record
  after insert or update of linked_property_id on public.sf_property_staging
  for each row execute function public.dia_sf_staging_identity_record();

create or replace function public.dia_pending_new_property_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.field_name = '_new_property' and new.property_id is not null then
    perform public.dia_sf_identity_record(
      new.new_value->>'sf_property_id', new.property_id, 'pending_updates');
  end if;
  return null;
end;
$fn$;

revoke all on function public.dia_pending_new_property_identity() from public, anon, authenticated;

drop trigger if exists trg_dia_pending_new_property_identity on public.pending_updates;
create trigger trg_dia_pending_new_property_identity
  after insert on public.pending_updates
  for each row execute function public.dia_pending_new_property_identity();

create or replace view public.v_dia_sf_property_fanout as
select m.sf_property_id,
       count(*)                                                              as dia_rows_minted,
       min(m.property_id)                                                    as first_mint_property_id,
       max(m.property_id)                                                    as last_mint_property_id,
       (select i.property_id from public.dia_sf_property_identity i
         where i.sf_property_id = m.sf_property_id)                          as canonical_property_id
  from (select distinct pu.new_value->>'sf_property_id' as sf_property_id,
                        pu.property_id
          from public.pending_updates pu
         where pu.field_name = '_new_property' and pu.property_id is not null) m
  join public.properties p on p.property_id = m.property_id
 group by m.sf_property_id;

comment on view public.v_dia_sf_property_fanout is
  'SEC1-unit2 Unit 3 verification surface (GOVDUP1-a port). dia_rows_minted growing for a '
  'previously-seen sf_property_id after this migration means the dedupe trigger did not fire.';

-- SEC1-definer-default: ASSERT the revokes, never read them off the REVOKE
-- statement itself. The two trigger functions are `returns trigger` and so
-- are not PostgREST-callable at all -- the revoke is defence in depth.
do $$
declare
  v_fn text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.dia_sf_identity_record(text, integer, text)',
    'public.dia_sf_staging_identity_dedupe()',
    'public.dia_sf_staging_identity_record()',
    'public.dia_pending_new_property_identity()'
  ] loop
    foreach v_role in array array['public','anon','authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception 'SEC1-unit2 Unit 3: % is still EXECUTE-able by %', v_fn, v_role;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role', 'public.dia_sf_identity_record(text, integer, text)', 'EXECUTE') then
    raise exception 'SEC1-unit2 Unit 3: service_role lost EXECUTE on dia_sf_identity_record';
  end if;
end $$;
