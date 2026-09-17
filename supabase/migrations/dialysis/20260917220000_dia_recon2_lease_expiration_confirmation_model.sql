-- RECON2 (unit 1) — Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live via Supabase MCP.
--
-- Replaces the RECON1 date-only lease-active guard (disabled by
-- 20260917213000) with a CONFIRMED-EXPIRATION model. Scott's rule, verbatim
-- (2026-09-17): "Let's only allow leases to go inactive once we have
-- confirmation that the lease expired. We can leave it in an unconfirmed
-- status until further research or evidence updates it."
--
-- Confirmed evidence classes (spec docs/architecture/reconcile-property-spec.md
-- R5, restated with this migration): a new/successor lease recorded for the
-- same property/tenant, a recorded termination, a CMS-derived closure/move
-- signal (medicare_clinics.termination_date), a sale/OM/lease-abstract
-- explicitly naming a successor lease, or an explicit operator/app decision.
-- Until one of those exists, a past-due lease is `expired_unconfirmed` and
-- `is_active` is NEVER touched by the automatic guard.
--
-- REVERSAL RUNBOOK:
--   alter table public.leases disable trigger trg_dia_recon2_lease_expiration_state_guard;
--   -- to fully undo the column additions:
--   -- alter table public.leases drop column expiration_state, drop column
--   --   expiration_evidence, drop column expiration_state_at;
--   -- drop trigger/function, drop dia_recon2_classify_expired_leases,
--   -- dia_recon2_confirm_lease_expired; drop dia_recon1_lease_active_past_expiration_guard
--   -- (already unused since RECON1's trigger was disabled 2026-09-17).

-- ── 1. Clean up RECON1's disabled date-only guard entirely. ─────────────────
drop trigger if exists trg_dia_recon1_lease_active_guard on leases;
drop function if exists dia_recon1_lease_active_past_expiration_guard();

-- ── 2. The confirmation model. ───────────────────────────────────────────────
alter table leases add column if not exists expiration_state text;
alter table leases add column if not exists expiration_evidence jsonb;
alter table leases add column if not exists expiration_state_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'leases'::regclass and conname = 'chk_leases_expiration_state'
  ) then
    alter table leases add constraint chk_leases_expiration_state
      check (expiration_state is null or expiration_state in (
        'in_term', 'expired_unconfirmed', 'expired_confirmed',
        'holdover_confirmed', 'renewed_confirmed'
      ));
  end if;
end $$;

comment on column leases.expiration_state is
  'RECON2: confirmation state for expiration. in_term = not past expiration '
  '(or no expiration on file). expired_unconfirmed = lease_expiration is in '
  'the past and NO confirming evidence exists yet — is_active is left '
  'UNCHANGED in this state; it is not an automatic inactivation. '
  'expired_confirmed = evidence exists (see expiration_evidence) and '
  'is_active has been set false. holdover_confirmed / renewed_confirmed = '
  'evidence of continued occupancy (holdover) or a recorded renewal keeps '
  'the lease active past its original expiration. Written only by '
  'dia_recon2_lease_expiration_state_guard() (unconfirmed default) and '
  'dia_recon2_confirm_lease_expired() (confirmed transitions, evidence-gated).';
comment on column leases.expiration_evidence is
  'RECON2: jsonb {evidence_type, source, reference, observed_date, recorded_by, '
  'recorded_at, note} — the confirming evidence for a non-in_term/non-'
  'unconfirmed expiration_state. Never fabricated; null until real evidence '
  'is recorded via dia_recon2_confirm_lease_expired().';
comment on column leases.expiration_state_at is
  'RECON2: when expiration_state last changed.';

-- Ledger: reuse dia_recon1_run_log (already shaped target_table/target_id/
-- action/prior_value/new_value/note, RECON1's ledger convention) rather than
-- mint a parallel table for the same purpose.
comment on table dia_recon1_run_log is
  'RECON1/RECON2: one row per write performed while reconciling lease/'
  'property state. Every UPDATE captures prior_value so it can be reversed '
  'by hand; every merge captures backup_id for dia_unmerge_property(). '
  'RECON2 lease-expiration-confirmation writes (dia_recon2_confirm_lease_expired) '
  'log here with step=''confirm_expiration''.';

-- ── 3. The standing guard: mark unconfirmed, NEVER touch is_active. ─────────
create or replace function dia_recon2_lease_expiration_state_guard()
returns trigger
language plpgsql
as $$
begin
  -- Once a human/evidence path has set a confirmed/holdover/renewed state,
  -- the automatic guard never overwrites it — that would silently discard
  -- recorded evidence the moment any other column on the row is touched.
  if new.expiration_state in ('expired_confirmed', 'holdover_confirmed', 'renewed_confirmed') then
    return new;
  end if;

  if new.lease_expiration is not null and new.lease_expiration < current_date then
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
  -- is_active is deliberately never assigned here. Confirmed inactivation
  -- only happens through dia_recon2_confirm_lease_expired(), with evidence.
  return new;
end;
$$;

comment on function dia_recon2_lease_expiration_state_guard() is
  'RECON2/R5: sets expiration_state=expired_unconfirmed on any past-due '
  'lease with no confirming evidence yet, and in_term otherwise. NEVER '
  'writes is_active. Replaces the RECON1 date-only guard (disabled '
  '2026-09-17, dropped by this migration) that flipped is_active on date '
  'alone, which Scott overruled: "only allow leases to go inactive once we '
  'have confirmation that the lease expired."';

drop trigger if exists trg_dia_recon2_lease_expiration_state_guard on leases;
create trigger trg_dia_recon2_lease_expiration_state_guard
  before insert or update of is_active, lease_expiration, status, expiration_state on leases
  for each row
  execute function dia_recon2_lease_expiration_state_guard();

-- ── 4. The ONLY path that may flip is_active to false or to a
--       holdover/renewed state on a past-due lease: evidence-gated,
--       ledgered, reversible. ────────────────────────────────────────────────
create or replace function dia_recon2_confirm_lease_expired(
  p_lease_id       integer,
  p_new_state      text,      -- 'expired_confirmed' | 'holdover_confirmed' | 'renewed_confirmed'
  p_evidence_type  text,      -- 'successor_lease' | 'termination_record' | 'cms_closure' |
                               -- 'sale_or_om_reference' | 'operator_decision' | 'continued_occupancy'
  p_source         text,      -- free text: what/who recorded this
  p_reference      text default null,   -- e.g. the successor lease_id, doc id, sale_id
  p_note           text default null,
  p_recorded_by    text default 'recon2_manual'
)
returns table (lease_id integer, expiration_state text, is_active boolean)
language plpgsql
as $$
declare
  v_prior jsonb;
  v_new_active boolean;
begin
  if p_new_state not in ('expired_confirmed', 'holdover_confirmed', 'renewed_confirmed') then
    raise exception 'dia_recon2_confirm_lease_expired: p_new_state must be expired_confirmed, holdover_confirmed or renewed_confirmed, got %', p_new_state;
  end if;
  if p_evidence_type is null or p_source is null then
    raise exception 'dia_recon2_confirm_lease_expired: p_evidence_type and p_source are required — no confirmation without stated evidence';
  end if;

  select to_jsonb(l) into v_prior from leases l where l.lease_id = p_lease_id;
  if v_prior is null then
    raise exception 'dia_recon2_confirm_lease_expired: lease_id % not found', p_lease_id;
  end if;

  v_new_active := (p_new_state <> 'expired_confirmed');

  update leases l
     set expiration_state = p_new_state,
         expiration_state_at = now(),
         expiration_evidence = jsonb_build_object(
           'evidence_type', p_evidence_type,
           'source', p_source,
           'reference', p_reference,
           'observed_date', current_date,
           'recorded_by', p_recorded_by,
           'recorded_at', now(),
           'note', p_note
         ),
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
$$;

comment on function dia_recon2_confirm_lease_expired(integer, text, text, text, text, text, text) is
  'RECON2: the ONLY function permitted to move a lease out of expired_unconfirmed '
  'with is_active changed. Requires evidence_type + source (raises otherwise — '
  'no confirmation without a stated reason). Ledgers to dia_recon1_run_log '
  '(step=confirm_expiration) with prior_value for manual reversal, e.g.: '
  '  update leases set expiration_state = (r.prior_value->>''expiration_state''), '
  '    is_active = (r.prior_value->>''is_active'')::boolean, '
  '    expiration_evidence = null where lease_id = (r.target_id)::int '
  '  from dia_recon1_run_log r where r.step=''confirm_expiration'' and r.target_id=''<lease_id>'';';

-- ── 5. Backfill expiration_state on every existing row (read/derive only —
--       no is_active write). ────────────────────────────────────────────────
update leases
   set expiration_state = case
         when lease_expiration is not null and lease_expiration < current_date then 'expired_unconfirmed'
         else 'in_term'
       end,
       expiration_state_at = now()
 where expiration_state is null;

-- ── 6. Classifier — DRY-RUN / READ-ONLY. Proposes a state + evidence per row,
--       writes NOTHING to leases. Used to size the population before any
--       fleet confirmation pass (a separate, future unit — not built here).
--       Evidence classes implemented deterministically:
--         successor_lease   — another lease on the SAME property with
--                              lease_start >= this lease's lease_expiration
--                              (a real gap-free or overlapping handoff).
--         termination_record— this lease's own status text names a
--                              termination (status ilike '%terminat%').
--         cms_closure       — (dia only) medicare_clinics.status in (removed,closed,
--                              relocated) for a clinic on the same property.
--       Everything else proposes expired_unconfirmed — never guessed. ───────
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
    -- min(): a property can carry MULTIPLE candidate successor leases, so an
    -- un-aggregated join fans out (measured live before this fix: 2,508 rows
    -- for 2,454 distinct candidate leases).
    select c.lease_id, min(s.lease_id) as successor_lease_id
    from candidates c
    join leases s
      on s.property_id = c.property_id
     and s.lease_id <> c.lease_id
     and s.lease_start is not null
     and s.lease_start >= c.lease_expiration
    group by c.lease_id
  ),
  cms as (
    -- min(): same fan-out risk — a property can carry multiple
    -- medicare_clinics rows matching the closure statuses.
    select c.lease_id, min(mc.status) as cms_status
    from candidates c
    join medicare_clinics mc
      on mc.property_id = c.property_id
     and mc.status in ('removed', 'closed', 'relocated')
    group by c.lease_id
  )
  select
    c.lease_id, c.property_id, c.tenant, c.lease_expiration, c.annual_rent,
    case
      when suc.successor_lease_id is not null then 'expired_confirmed'
      when c.status ilike '%terminat%' then 'expired_confirmed'
      when cm.cms_status is not null then 'expired_confirmed'
      else 'expired_unconfirmed'
    end as proposed_state,
    case
      when suc.successor_lease_id is not null then 'successor_lease'
      when c.status ilike '%terminat%' then 'termination_record'
      when cm.cms_status is not null then 'cms_closure'
      else null
    end as evidence_type,
    case
      when suc.successor_lease_id is not null then 'successor lease_id=' || suc.successor_lease_id
      when c.status ilike '%terminat%' then 'status=' || c.status
      when cm.cms_status is not null then 'medicare_clinics.status=' || cm.cms_status
      else null
    end as evidence_detail
  from candidates c
  left join successor suc on suc.lease_id = c.lease_id
  left join cms cm on cm.lease_id = c.lease_id
  order by coalesce(c.annual_rent, 0) desc, c.lease_id
  limit p_limit;
$$;

comment on function dia_recon2_classify_expired_leases(int) is
  'RECON2: DRY-RUN classifier only — reads leases/medicare_clinics and PROPOSES '
  'expiration_state + evidence per row. Writes NOTHING. Run a fleet confirmation '
  'pass off this output is a SEPARATE, FUTURE unit (not built here) — this round '
  'ships a 25-row sample for Scott to review, no fleet write.';

-- ── 7. Research worklist routing for expired_unconfirmed leases — reuse the
--       existing pending_updates lane (valid status vocab; 'pending' is NOT
--       in the CHECK constraint, which is why RECON1's own task insert
--       failed — see dia_recon1_run_log where note='task_insert_failed').
--       Value-ranked by annual_rent (the existing value signal on leases).
--       Idempotent: only enqueues a lease with no existing OPEN task
--       referencing it. ─────────────────────────────────────────────────────
create or replace function dia_recon2_enqueue_expired_unconfirmed_research(
  p_dry_run boolean default true,
  p_limit   int default 200
)
returns table (lease_id integer, action text, detail text)
language plpgsql
as $$
declare
  v_row record;
  v_batch text := 'recon2_worklist_' || to_char(now(), 'YYYYMMDD_HH24MISS');
begin
  for v_row in
    select l.lease_id, l.property_id, l.tenant, l.lease_expiration, l.annual_rent
    from leases l
    where l.expiration_state = 'expired_unconfirmed'
      and not exists (
        select 1 from pending_updates pu
        where pu.entity = 'lease:' || l.lease_id
          and pu.status in ('open', 'pending_review', 'needs_match', 'needs_clarification', 'retry', 'new')
      )
    order by coalesce(l.annual_rent, 0) desc, l.lease_id
    limit p_limit
  loop
    if p_dry_run then
      return query select v_row.lease_id, 'dry_run', 'would enqueue: property ' || v_row.property_id ||
        ', tenant ' || coalesce(v_row.tenant,'?') || ', expired ' || v_row.lease_expiration ||
        ', annual_rent ' || coalesce(v_row.annual_rent::text,'unknown');
    else
      insert into pending_updates (table_name, field_name, action, reason, entity, payload, file_name, status)
      values (
        'leases', 'expiration_state', 'research_needed',
        'Lease past expiration with no confirming evidence (successor lease, '
        'termination record, CMS closure, sale/OM reference) — confirm expired '
        'or mark holdover/renewed.',
        'lease:' || v_row.lease_id,
        jsonb_build_object('lease_id', v_row.lease_id, 'property_id', v_row.property_id,
          'tenant', v_row.tenant, 'lease_expiration', v_row.lease_expiration,
          'annual_rent', v_row.annual_rent),
        'recon2_expired_unconfirmed_worklist',
        'open'
      );
      return query select v_row.lease_id, 'enqueued', 'pending_updates row created, batch ' || v_batch;
    end if;
  end loop;
end;
$$;

comment on function dia_recon2_enqueue_expired_unconfirmed_research(boolean, int) is
  'RECON2: routes expired_unconfirmed leases into the existing pending_updates '
  'research lane (status=''open'', a valid CHECK value — RECON1''s own task '
  'insert used status=''pending'', which is NOT in pending_updates_status_check '
  'and silently failed; see dia_recon1_run_log task_insert_failed rows). '
  'Value-ranked by annual_rent. Dry-run default; idempotent (skips a lease '
  'already carrying an open task).';
