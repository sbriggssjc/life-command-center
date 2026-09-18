-- RECON2-b — Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live via Supabase MCP.
--
-- Fixes dia_recon2_classify_expired_leases' cms_closure evidence class. Measured
-- 2026-09-17: cms_closure fired for 1,489 of 1,494 expired_confirmed proposals,
-- keyed on ANY medicare_clinics row on the property carrying status IN
-- (removed, closed, relocated). medicare_clinics.status='removed' is 90% of the
-- table (7,690/8,547) and is an import/list-membership state, NOT a closure —
-- and 1,481 of the 1,489 sit on a property whose clinic row reads
-- is_operating=true. Run as built, dia_recon2_confirm_lease_expired against this
-- classifier's output would have deactivated ~1,480 leases on operating clinics.
-- Nothing was ever written by the classifier itself (it is read-only); this
-- migration fixes the evidence BEFORE any fleet confirmation pass exists.
--
-- Scott's rule (unchanged, restated from the prior migration): "Let's only
-- allow leases to go inactive once we have confirmation that the lease
-- expired."
--
-- REVERSAL RUNBOOK:
--   -- classifier is a pure function replacement; to revert to the pre-fix
--   -- version, re-apply the CREATE OR REPLACE FUNCTION body from
--   -- 20260917220000_dia_recon2_lease_expiration_confirmation_model.sql section 6.
--   alter table leases drop constraint if exists chk_leases_expiration_state;
--   alter table leases add constraint chk_leases_expiration_state
--     check (expiration_state is null or expiration_state in (
--       'in_term', 'expired_unconfirmed', 'expired_confirmed',
--       'holdover_confirmed', 'renewed_confirmed'
--     ));
--   -- (drops the expiration_unknown state; re-run the guard-function CREATE OR
--   --  REPLACE from the RECON2 migration to stop emitting it, then backfill
--   --  expiration_unknown rows back to in_term if desired.)

-- ── 1. New state: a lease with NO lease_expiration on file is UNKNOWN, not
--       in_term. 3,801 rows (2,334 active) currently read in_term purely
--       because NULL < current_date is false in SQL — "we don't know" was
--       being reported as "confirmed current." ─────────────────────────────
alter table leases drop constraint if exists chk_leases_expiration_state;
alter table leases add constraint chk_leases_expiration_state
  check (expiration_state is null or expiration_state in (
    'in_term', 'expired_unconfirmed', 'expired_confirmed',
    'holdover_confirmed', 'renewed_confirmed', 'expiration_unknown'
  ));

comment on column leases.expiration_state is
  'RECON2/RECON2-b: confirmation state for expiration. in_term = has a '
  'lease_expiration on file and it is not past. expiration_unknown = NO '
  'lease_expiration on file — unknown is NOT in-term (RECON2-b; the guard '
  'previously mapped a NULL expiration to in_term, which reported "we do not '
  'know" as "confirmed current"). expired_unconfirmed = lease_expiration is in '
  'the past and NO confirming evidence exists yet — is_active is left '
  'UNCHANGED in this state; it is not an automatic inactivation. '
  'expired_confirmed = evidence exists (see expiration_evidence) and '
  'is_active has been set false. holdover_confirmed / renewed_confirmed = '
  'evidence of continued occupancy (holdover) or a recorded renewal keeps '
  'the lease active past its original expiration. Written only by '
  'dia_recon2_lease_expiration_state_guard() (unconfirmed/unknown default) and '
  'dia_recon2_confirm_lease_expired() (confirmed transitions, evidence-gated).';

create or replace function dia_recon2_lease_expiration_state_guard()
returns trigger
language plpgsql
as $$
begin
  if new.expiration_state in ('expired_confirmed', 'holdover_confirmed', 'renewed_confirmed') then
    return new;
  end if;

  if new.lease_expiration is null then
    if new.expiration_state is distinct from 'expiration_unknown' then
      new.expiration_state := 'expiration_unknown';
      new.expiration_state_at := now();
    end if;
  elsif new.lease_expiration < current_date then
    if new.expiration_state is distinct from 'expired_unconfirmed' then
      new.expiration_state := 'expired_unconfirmed';
      new.expiration_state_at := now();
    end if;
  else
    if new.expiration_state is distinct from 'in_term' then
      new.expiration_state := 'in_term';
      new.expiration_state_at := now();
    end if;
  end if;
  return new;
end;
$$;

comment on function dia_recon2_lease_expiration_state_guard() is
  'RECON2/RECON2-b: sets expiration_state=expired_unconfirmed on any past-due '
  'lease with no confirming evidence yet, expiration_unknown when there is no '
  'lease_expiration on file at all (RECON2-b), and in_term otherwise. NEVER '
  'writes is_active.';

-- Backfill: 3,801 pre-existing NULL-expiration rows read in_term from the
-- RECON2 backfill; correct them (read/derive only — no is_active write).
update leases
   set expiration_state = 'expiration_unknown',
       expiration_state_at = now()
 where lease_expiration is null
   and expiration_state = 'in_term';

-- ── 2. cms_closure evidence, redefined. Requires, for EVERY medicare_clinics
--       row on the property: is_operating IS NOT TRUE AND status IN
--       ('closed','relocated') — status='removed' NEVER qualifies (it is an
--       import/list state, 90% of the table). Any operating clinic on the
--       property disqualifies cms_closure outright and is surfaced as its own
--       evidence_detail so the residue is legible, not silently absent. ──────
create or replace function dia_recon2_classify_expired_leases(p_limit int default null)
returns table (
  lease_id            integer,
  property_id         integer,
  tenant              text,
  lease_expiration    date,
  annual_rent         numeric,
  proposed_state      text,
  evidence_type        text,
  evidence_detail      text
)
language sql
stable
as $$
  with candidates as (
    select l.lease_id, l.property_id, l.tenant, l.lease_expiration, l.annual_rent, l.status
    from leases l
    where l.is_active = true
      and l.lease_expiration is not null
      and l.lease_expiration < current_date
  ),
  successor as (
    select c.lease_id, min(s.lease_id) as successor_lease_id
    from candidates c
    join leases s
      on s.property_id = c.property_id
     and s.lease_id <> c.lease_id
     and s.lease_start is not null
     and s.lease_start >= c.lease_expiration
    group by c.lease_id
  ),
  clinic_rows as (
    select c.lease_id, mc.status as mc_status, mc.is_operating
    from candidates c
    join medicare_clinics mc on mc.property_id = c.property_id
  ),
  cms_eval as (
    -- bool_and()/bool_or() over ALL medicare_clinics rows on the property —
    -- one operating or non-closed row disqualifies cms_closure entirely.
    select cr.lease_id,
           bool_and(coalesce(cr.is_operating, false) is not true
                     and cr.mc_status in ('closed', 'relocated')) as all_confirmed_closed,
           bool_or(coalesce(cr.is_operating, true) is true) as any_operating
    from clinic_rows cr
    group by cr.lease_id
  )
  select
    c.lease_id, c.property_id, c.tenant, c.lease_expiration, c.annual_rent,
    case
      when suc.successor_lease_id is not null then 'expired_confirmed'
      when c.status ilike '%terminat%' then 'expired_confirmed'
      when cm.all_confirmed_closed then 'expired_confirmed'
      else 'expired_unconfirmed'
    end as proposed_state,
    case
      when suc.successor_lease_id is not null then 'successor_lease'
      when c.status ilike '%terminat%' then 'termination_record'
      when cm.all_confirmed_closed then 'cms_closure'
      when cm.any_operating then null  -- no confirming evidence; note carries the reason
      else null
    end as evidence_type,
    case
      when suc.successor_lease_id is not null then 'successor lease_id=' || suc.successor_lease_id
      when c.status ilike '%terminat%' then 'status=' || c.status
      when cm.all_confirmed_closed then 'medicare_clinics all rows closed/relocated, none operating'
      when cm.any_operating then 'clinic operating (CMS) — no expiration evidence; holdover or renewal undetermined'
      else null
    end as evidence_detail
  from candidates c
  left join successor suc on suc.lease_id = c.lease_id
  left join cms_eval cm on cm.lease_id = c.lease_id
  order by coalesce(c.annual_rent, 0) desc, c.lease_id
  limit p_limit;
$$;

comment on function dia_recon2_classify_expired_leases(int) is
  'RECON2-b: DRY-RUN classifier only — reads leases/medicare_clinics and PROPOSES '
  'expiration_state + evidence per row. Writes NOTHING. cms_closure REQUIRES '
  'every medicare_clinics row on the property to read is_operating IS NOT TRUE '
  'AND status IN (closed, relocated) — status=removed alone (90% of the table, '
  'an import/list state) never qualifies, and an operating clinic disqualifies '
  'cms_closure outright and surfaces as evidence_detail so the residue is named, '
  'not silently absent. Superseded RECON2 (20260917220000), which fired '
  'cms_closure off ANY row with status IN (removed,closed,relocated) — measured '
  '1,489 of 1,494 expired_confirmed proposals on that key, 1,481 of them on a '
  'property with an is_operating=true clinic row.';

-- ── 3. Enqueue-function hygiene: gate on l.is_active (563 of the 1,000
--       already-created worklist tasks sit on leases already is_active=false —
--       superseded history the function had no filter to exclude), and rank
--       "clinic operating (CMS)" residue first (the case an operator can most
--       cheaply confirm/refute). ─────────────────────────────────────────────
create or replace function dia_recon2_enqueue_expired_unconfirmed_research(
  p_dry_run boolean default true,
  p_limit   int default 200
)
returns table (lease_id integer, action text, detail text)
language plpgsql
as $$
declare
  v_row record;
  v_batch text := 'recon2b_worklist_' || to_char(now(), 'YYYYMMDD_HH24MISS');
begin
  for v_row in
    select l.lease_id, l.property_id, l.tenant, l.lease_expiration, l.annual_rent,
           exists (
             select 1 from medicare_clinics mc
             where mc.property_id = l.property_id
               and coalesce(mc.is_operating, true) is true
           ) as clinic_operating
    from leases l
    where l.expiration_state = 'expired_unconfirmed'
      and l.is_active = true
      and not exists (
        select 1 from pending_updates pu
        where pu.entity = 'lease:' || l.lease_id
          and pu.status in ('open', 'pending_review', 'needs_match', 'needs_clarification', 'retry', 'new')
      )
    order by (case when exists (
                select 1 from medicare_clinics mc
                where mc.property_id = l.property_id
                  and coalesce(mc.is_operating, true) is true
              ) then 0 else 1 end),
             coalesce(l.annual_rent, 0) desc, l.lease_id
    limit p_limit
  loop
    if p_dry_run then
      return query select v_row.lease_id, 'dry_run', 'would enqueue: property ' || v_row.property_id ||
        ', tenant ' || coalesce(v_row.tenant,'?') || ', expired ' || v_row.lease_expiration ||
        ', annual_rent ' || coalesce(v_row.annual_rent::text,'unknown') ||
        case when v_row.clinic_operating then ' [clinic operating (CMS)]' else '' end;
    else
      insert into pending_updates (table_name, field_name, action, reason, entity, payload, file_name, status)
      values (
        'leases', 'expiration_state', 'research_needed',
        'Lease past expiration with no confirming evidence (successor lease, '
        'termination record, CMS closure, sale/OM reference) — confirm expired '
        'or mark holdover/renewed.' ||
        case when v_row.clinic_operating then ' Clinic reads operating on CMS — likely holdover or an unrecorded renewal.' else '' end,
        'lease:' || v_row.lease_id,
        jsonb_build_object('lease_id', v_row.lease_id, 'property_id', v_row.property_id,
          'tenant', v_row.tenant, 'lease_expiration', v_row.lease_expiration,
          'annual_rent', v_row.annual_rent, 'clinic_operating', v_row.clinic_operating),
        'recon2b_expired_unconfirmed_worklist',
        'open'
      );
      return query select v_row.lease_id, 'enqueued', 'pending_updates row created, batch ' || v_batch;
    end if;
  end loop;
end;
$$;

comment on function dia_recon2_enqueue_expired_unconfirmed_research(boolean, int) is
  'RECON2-b: as RECON2, plus l.is_active=true (excludes leases already '
  'superseded/inactive — the RECON2 enqueuer had no such filter and 563 of its '
  'first 1,000 tasks landed on already-inactive leases) and ranks a lease whose '
  'property carries an operating CMS clinic first (the cheapest case for an '
  'operator to confirm or refute).';

-- ── 4. Close the 563 already-open worklist tasks that sit on leases already
--       is_active=false. Reversible (ledgered; note names the batch). ───────
do $$
declare
  v_closed int := 0;
  v_row record;
begin
  for v_row in
    select pu.id, pu.entity
    from pending_updates pu
    join leases l on l.lease_id = (regexp_replace(pu.entity, '^lease:', ''))::int
    where pu.entity like 'lease:%'
      and pu.file_name = 'recon2_expired_unconfirmed_worklist'
      and pu.status in ('open', 'pending_review', 'needs_match', 'needs_clarification', 'retry', 'new')
      and l.is_active = false
  loop
    update pending_updates
       set status = 'ignored',
           reason = reason || ' [RECON2-b: lease already is_active=false — superseded history, not open work]'
     where id = v_row.id;

    insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, new_value, note, dry_run)
    values (
      'recon2b_close_inactive_' || to_char(now(), 'YYYYMMDD'), 'close_worklist_on_inactive_lease',
      'pending_updates', v_row.id::text, 'ignored',
      jsonb_build_object('status', 'open'), jsonb_build_object('status', 'ignored'),
      'RECON2-b: worklist row on ' || v_row.entity || ' pointed at a lease already is_active=false.',
      false
    );
    v_closed := v_closed + 1;
  end loop;

  raise notice 'RECON2-b: closed % worklist tasks on already-inactive leases', v_closed;
end $$;
