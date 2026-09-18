-- RECON2-d (2026-09-18): rename leases.expiration_state 'holdover_confirmed' ->
-- 'occupied_term_unknown'.
--
-- 'holdover_confirmed' asserted more than was known. The only evidence on file for
-- every row this state has ever been used on (leases 23259 / 12678 / 13058) is: a
-- CoStar-sourced lease record shows the tenant active with NO expiration date
-- landed on the record, plus an independent occupancy signal (operator locator /
-- Google Business hours) confirming the clinic is open. There is no evidence of
-- month-to-month tenancy and no evidence of a renewal. 'occupied_term_unknown'
-- states exactly and only what is known: the space is occupied and the current
-- lease term is not on file. No date is invented anywhere in this migration.
-- is_active is not touched by this migration (it is untouched by design: an
-- occupied space with an unknown term is still an active tenancy).
--
-- Also fixes a live defect in dia_recon2_classify_expired_leases() found while
-- verifying this rename: re-running the structural classifier against the 3
-- already-confirmed rows proposed 'expired_confirmed' for all three (successor
-- lease / status='Terminated' matches on the SAME lease row), directly
-- contradicting the fresher, human-recorded field evidence that the tenant is
-- still in occupancy. The classifier's own conflict detector did not catch this
-- because it only inspects the expiration_evidence array for textual
-- active-vs-closed contradictions, never the row's already-confirmed
-- expiration_state against its own structural signals. Fixed by (a) excluding any
-- lease already carrying a human-confirmed continued-occupancy state from the
-- classifier's candidate population, (b) flagging conflict=true when a clinic is
-- CMS-confirmed operating at the SAME property while a structural closure signal
-- also fires, and (c) proposing 'occupied_term_unknown' (never a state implying
-- holdover/renewal) when the only positive signal is CMS-confirmed continued
-- occupancy with no closure/termination/successor evidence.
--
-- PL-54 (docs/architecture/reconcile-property-spec.md R5): also teaches the guard
-- trigger that a capture stamping lease_expiration_source_state='source_no_date'
-- against a lease whose RECORDED expiration has already passed, on a lease that
-- is currently active, is itself evidence of continued occupancy with an unknown
-- term -- so it now promotes the row to occupied_term_unknown directly, rather
-- than leaving it (or defaulting it back to) expired_unconfirmed. It never
-- invents a date and never promotes past a state a human has already confirmed
-- (expired_confirmed / renewed_confirmed).
--
-- Idempotent / re-runnable: the UPDATE and the evidence-audit append are both
-- no-ops on a second run; the CHECK/trigger/function replacements are
-- CREATE-OR-REPLACE / DROP-IF-EXISTS throughout.

begin;

-- ---------------------------------------------------------------------------
-- 1. Guard trigger FUNCTION first (before any data write), so the rename value
--    is already recognised as a terminal/confirmed state by the time step 4
--    below writes it -- otherwise the OLD guard body would immediately
--    overwrite 'occupied_term_unknown' back to 'expired_unconfirmed'.
-- ---------------------------------------------------------------------------
create or replace function public.dia_recon2_lease_expiration_state_guard()
 returns trigger
 language plpgsql
as $function$
begin
  -- PL-54: a capture stating the lease is active with NO date, against an
  -- already-passed RECORDED expiration, is evidence of continued occupancy
  -- with an unknown term -- never a renewal/holdover inference, never a date.
  if new.lease_expiration_source_state = 'source_no_date'
     and new.lease_expiration is not null
     and new.lease_expiration < current_date
     and coalesce(new.is_active, false) is true
     and new.expiration_state is distinct from 'expired_confirmed'
     and new.expiration_state is distinct from 'renewed_confirmed'
  then
    new.expiration_state := 'occupied_term_unknown';
    new.expiration_state_at := now();
    return new;
  end if;

  if new.expiration_state in ('expired_confirmed', 'occupied_term_unknown', 'renewed_confirmed') then
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
$function$;

-- Widen the trigger's column list so a source-state-only UPDATE fires PL-54.
drop trigger if exists trg_dia_recon2_lease_expiration_state_guard on leases;
create trigger trg_dia_recon2_lease_expiration_state_guard
  before insert or update of is_active, lease_expiration, status, expiration_state, lease_expiration_source_state
  on leases
  for each row execute function public.dia_recon2_lease_expiration_state_guard();

-- ---------------------------------------------------------------------------
-- 2. Confirm-function: rename the allowed target state name.
-- ---------------------------------------------------------------------------
create or replace function public.dia_recon2_confirm_lease_expired(
  p_lease_id integer,
  p_new_state text,
  p_evidence_type text,
  p_source text,
  p_reference text default null,
  p_note text default null,
  p_recorded_by text default 'recon2_manual'
) returns table(lease_id integer, expiration_state text, is_active boolean)
 language plpgsql
as $function$
#variable_conflict use_column
declare
  v_prior      jsonb;
  v_new_active boolean;
  v_existing   jsonb;
  v_array      jsonb;
  v_entry      jsonb;
begin
  if p_new_state not in ('expired_confirmed', 'occupied_term_unknown', 'renewed_confirmed') then
    raise exception 'dia_recon2_confirm_lease_expired: p_new_state must be expired_confirmed, occupied_term_unknown or renewed_confirmed, got %', p_new_state;
  end if;
  if p_evidence_type is null or p_source is null then
    raise exception 'dia_recon2_confirm_lease_expired: p_evidence_type and p_source are required — no confirmation without stated evidence';
  end if;

  select to_jsonb(l) into v_prior from leases l where l.lease_id = p_lease_id;
  if v_prior is null then
    raise exception 'dia_recon2_confirm_lease_expired: lease_id % not found', p_lease_id;
  end if;

  v_new_active := (p_new_state <> 'expired_confirmed');

  select expiration_evidence into v_existing from leases where lease_id = p_lease_id;
  v_array := case
               when v_existing is null then '[]'::jsonb
               when jsonb_typeof(v_existing) = 'array' then v_existing
               else jsonb_build_array(v_existing)
             end;
  v_entry := jsonb_build_object(
    'evidence_type', p_evidence_type,
    'source', p_source,
    'reference', p_reference,
    'observed_date', current_date,
    'recorded_by', p_recorded_by,
    'recorded_at', now(),
    'note', p_note
  );
  v_array := v_array || jsonb_build_array(v_entry);

  update leases l
     set expiration_state = p_new_state,
         expiration_state_at = now(),
         expiration_evidence = v_array,
         expiration_evidence_conflict = dia_recon2_evidence_array_conflicts(v_array),
         is_active = v_new_active
   where l.lease_id = p_lease_id;

  insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, new_value, note, dry_run)
  values (
    'recon2_confirm_' || to_char(now(), 'YYYYMMDD'), 'confirm_expiration', 'leases', p_lease_id::text,
    p_new_state, v_prior,
    jsonb_build_object('expiration_state', p_new_state, 'is_active', v_new_active,
                        'evidence_type', p_evidence_type, 'source', p_source, 'reference', p_reference),
    p_note, false
  );

  return query select l.lease_id, l.expiration_state, l.is_active from leases l where l.lease_id = p_lease_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Drop the OLD constraint first (a tightened ADD CONSTRAINT validates the
--    WHOLE TABLE immediately, before the rename below has run).
-- ---------------------------------------------------------------------------
alter table leases drop constraint if exists chk_leases_expiration_state;

-- ---------------------------------------------------------------------------
-- 4. Data: move every existing 'holdover_confirmed' row (measured: 3, leases
--    23259 / 12678 / 13058) to the new name. is_active is not referenced here
--    and therefore cannot change.
-- ---------------------------------------------------------------------------
update leases
   set expiration_state = 'occupied_term_unknown',
       expiration_state_at = now()
 where expiration_state = 'holdover_confirmed';

-- ---------------------------------------------------------------------------
-- 4b. Now add the tightened CHECK constraint (no row can violate it).
-- ---------------------------------------------------------------------------
alter table leases add constraint chk_leases_expiration_state
  check (
    expiration_state is null
    or expiration_state = any (array[
      'in_term', 'expired_unconfirmed', 'expired_confirmed',
      'occupied_term_unknown', 'renewed_confirmed', 'expiration_unknown'
    ])
  );

-- ---------------------------------------------------------------------------
-- 5. Classifier fix (see header for the defect this closes).
-- ---------------------------------------------------------------------------
create or replace function public.dia_recon2_classify_expired_leases(p_limit integer default null)
 returns table(lease_id integer, property_id integer, tenant text, lease_expiration date, annual_rent numeric, proposed_state text, evidence_type text, evidence_detail text, conflict boolean)
 language sql
 stable
as $function$
  with candidates as (
    select l.lease_id, l.property_id, l.tenant, l.lease_expiration, l.annual_rent, l.status,
           l.expiration_evidence
    from leases l
    where l.is_active = true
      and l.lease_expiration is not null
      and l.lease_expiration < current_date
      -- RECON2-d: never re-litigate a lease a human has already confirmed as a
      -- continuing (if term-unknown) or renewed occupancy against the same
      -- structural signals that made it a candidate in the first place.
      and coalesce(l.expiration_state, 'expired_unconfirmed') not in ('occupied_term_unknown', 'renewed_confirmed')
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
    select c.lease_id, mc.status as mc_status, mc.is_operating,
           mc_op.operator_id as mc_operator_id, tenant_op.operator_id as tenant_operator_id
    from candidates c
    join medicare_clinics mc
      on mc.property_id = c.property_id
     and coalesce(mc.dedup_status, '') is distinct from 'demoted_duplicate'
    cross join lateral dia_resolve_operator(mc.chain_organization) mc_op
    cross join lateral dia_resolve_operator(c.tenant) tenant_op
  ),
  cms_eval as (
    select cr.lease_id,
           bool_and(
             coalesce(cr.is_operating, false) is not true
             and cr.mc_status in ('closed', 'relocated')
             and cr.mc_operator_id is not null
             and cr.mc_operator_id = cr.tenant_operator_id
           ) as all_confirmed_closed,
           bool_or(
             coalesce(cr.is_operating, true) is true
             and cr.mc_operator_id is not null
             and cr.mc_operator_id = cr.tenant_operator_id
           ) as any_operating_matched
    from clinic_rows cr
    group by cr.lease_id
  ),
  had_demoted_duplicate as (
    select c.lease_id, true as flag
    from candidates c
    join medicare_clinics mc
      on mc.property_id = c.property_id
     and mc.dedup_status = 'demoted_duplicate'
    group by c.lease_id
  ),
  twins as (
    select c.lease_id, c.property_id as base_property_id, p2.property_id as twin_property_id
    from candidates c
    join properties p on p.property_id = c.property_id
    join properties p2
      on p2.state = p.state
     and p2.property_id <> p.property_id
     and dia_recon2_street_twin_key(p2.address) is not null
     and dia_recon2_street_twin_key(p2.address) = dia_recon2_street_twin_key(p.address)
  ),
  twin_operating as (
    select t.lease_id, min(t.twin_property_id) as twin_property_id
    from twins t
    join candidates c on c.lease_id = t.lease_id
    join medicare_clinics mc
      on mc.property_id = t.twin_property_id
     and coalesce(mc.dedup_status, '') is distinct from 'demoted_duplicate'
     and coalesce(mc.is_operating, false) is true
    cross join lateral dia_resolve_operator(mc.chain_organization) mc_op
    cross join lateral dia_resolve_operator(c.tenant) tenant_op
    where mc_op.operator_id is not null
      and mc_op.operator_id = tenant_op.operator_id
    group by t.lease_id
  )
  select
    c.lease_id, c.property_id, c.tenant, c.lease_expiration, c.annual_rent,
    case
      when suc.successor_lease_id is not null then 'expired_confirmed'
      when twn.twin_property_id is not null then 'expired_unconfirmed'
      when c.status ilike '%terminat%' then 'expired_confirmed'
      when cm.all_confirmed_closed then 'expired_confirmed'
      when cm.any_operating_matched then 'occupied_term_unknown'
      else 'expired_unconfirmed'
    end as proposed_state,
    case
      when suc.successor_lease_id is not null then 'successor_lease'
      when twn.twin_property_id is not null then 'twin_operating'
      when c.status ilike '%terminat%' then 'termination_record'
      when cm.all_confirmed_closed then 'cms_closure'
      when cm.any_operating_matched then 'cms_operating_match'
      else null
    end as evidence_type,
    case
      when suc.successor_lease_id is not null then 'successor lease_id=' || suc.successor_lease_id
      when twn.twin_property_id is not null then 'operating on twin ' || twn.twin_property_id
      when c.status ilike '%terminat%' then 'status=' || c.status
      when cm.all_confirmed_closed then 'medicare_clinics all rows closed/relocated (operator-matched), none operating'
      when cm.any_operating_matched then 'clinic operating (CMS, operator-matched) at this property — no expiration date on file; occupied, term not confirmed'
      else null
    end as evidence_detail,
    (
      coalesce(
        twn.twin_property_id is not null
        and (
          coalesce(dd.flag, false)
          or coalesce(c.status ilike '%terminat%', false)
          or coalesce(cm.all_confirmed_closed, false)
        ),
        false
      )
      or coalesce(
           cm.any_operating_matched
           and (
             coalesce(c.status ilike '%terminat%', false)
             or coalesce(cm.all_confirmed_closed, false)
             or suc.successor_lease_id is not null
           ),
           false
         )
      or coalesce(dia_recon2_evidence_array_conflicts(c.expiration_evidence), false)
    ) as conflict
  from candidates c
  left join successor suc on suc.lease_id = c.lease_id
  left join cms_eval cm on cm.lease_id = c.lease_id
  left join had_demoted_duplicate dd on dd.lease_id = c.lease_id
  left join twin_operating twn on twn.lease_id = c.lease_id
  order by coalesce(c.annual_rent, 0) desc, c.lease_id
  limit p_limit;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Append a rename-audit entry to the 3 renamed rows' evidence array. This
--    records WHY the state changed without inventing any new date; the prior
--    evidence entries are left exactly as recorded (they are an accurate
--    historical record of what was observed and when).
-- ---------------------------------------------------------------------------
update leases
   set expiration_evidence = expiration_evidence || jsonb_build_array(jsonb_build_object(
         'evidence_type', 'state_rename',
         'source', 'recon2d_migration',
         'reference', null,
         'observed_date', current_date,
         'recorded_by', 'recon2d_migration',
         'recorded_at', now(),
         'note', 'RECON2-d: expiration_state renamed holdover_confirmed -> occupied_term_unknown. '
                 || 'No date invented; the only evidence on file is CoStar active + no expiration '
                 || 'date recorded, plus an independent occupancy signal. No holdover/month-to-month '
                 || 'status and no renewal has been confirmed.'
       ))
 where lease_id in (23259, 12678, 13058)
   and not exists (
     select 1
     from jsonb_array_elements(expiration_evidence) e
     where e->>'evidence_type' = 'state_rename'
       and e->>'source' = 'recon2d_migration'
   );

-- ---------------------------------------------------------------------------
-- 7. Run log for the rename.
-- ---------------------------------------------------------------------------
insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, note, dry_run)
select 'recon2d_rename_' || to_char(now(), 'YYYYMMDD'), 'rename_state', 'leases', l.lease_id::text,
       'holdover_confirmed_to_occupied_term_unknown',
       'RECON2-d: renamed holdover_confirmed -> occupied_term_unknown; is_active untouched.', false
from leases l
where l.lease_id in (23259, 12678, 13058)
  and not exists (
    select 1 from dia_recon1_run_log rl
    where rl.step = 'rename_state'
      and rl.target_table = 'leases'
      and rl.target_id = l.lease_id::text
      and rl.action = 'holdover_confirmed_to_occupied_term_unknown'
  );

commit;
