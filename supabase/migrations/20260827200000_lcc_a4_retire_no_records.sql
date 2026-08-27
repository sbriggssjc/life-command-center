-- ---------------------------------------------------------------------------
-- A4 -- auto-retire the `no_records` bucket of `establish_ownership_history`.
--
-- 2026-08-27 - LCC Opps. Reversible, dry-run default, batch-tagged.
--
-- WHAT THIS RETIRES
-- -----------------
-- A1 split the lane into four actions. This closes exactly one of them:
-- `action = 'no_records'` on `v_lcc_ownership_history_lane_split`, i.e. the
-- drafter (P131) reported `insufficient_reason = 'no_transitions_on_file'`.
--
-- The SPLIT VIEW is the single owner of that classification. This function
-- never reads `insufficient_reason` itself and never greps the drafted prose
-- (A1's whole point, and the P182 text-detector trap). It reads `action`.
--
-- ⚠️ IT MUST NEVER TOUCH THE OTHER THREE ACTIONS. `all_guarded` in particular
-- wears the same "we could not draft this" surface wording and is a
-- COMPLETELY different fact: those properties HAVE recorded transfers, every
-- one of which failed a data-quality guard. Measured in A4b, a corrected
-- guard unblocks 10 of those 18 -- retiring them would silently discard real,
-- recoverable ownership history. One label, two facts (P181).
--
-- ⚠️ "NO RECORDS" IS THE DRAFTER'S VERDICT, NOT "NOTHING IS RECORDED"
-- -------------------------------------------------------------------
-- Measured live on the 74 (gov `scknotsqkcheojiaewwh`, 2026-08-27):
--
--   transitions visible in v_ownership_transitions_portfolio :   0
--   RAW gov.ownership_history rows for the same 74 properties :  84
--
-- All 84 are dropped by the view's own base filter
-- (`transfer_date IS NULL OR prior_owner IS NULL OR new_owner IS NULL`):
--
--   no prior_owner (and no date)          54 rows / 50 properties
--   no prior_owner, no date, no new_owner 24 rows / 24 properties
--   no prior_owner, dated                  5 rows /  3 properties
--   PRIOR OWNER PRESENT, undated           1 row  /  1 property
--
-- 83 of 84 carry NO PRIOR OWNER, and the prior owner is the lane's entire
-- deliverable -- so they are unanswerable from what we hold, by anyone. The
-- reason string says `no_usable_transition_on_file`, NOT "no records": a
-- retire that overstates its own premise is how the next reader concludes the
-- source is empty when it is not.
--
-- The single exception is named, not lumped: property 14280,
-- `SUFFOLK VA III FGF, LLC -> Boyd Watterson`, from a county deed, missing
-- ONLY the transfer date. It is still not draftable today (an undated link
-- cannot be ordered, and an ordered chain is the deliverable), so it retires
-- with the rest -- but it is one date lookup from being real history, so it
-- is surfaced in `v_lcc_a4_undated_prior_owner_watch` and carries its own
-- outcome reason rather than disappearing into the bucket.
--
-- ⚠️ WHAT STOPS THE 74 COMING BACK TONIGHT -- AND WHAT LETS THEM BACK IN
-- ---------------------------------------------------------------------
-- `lcc_generate_chain_research_tasks` (cron 144, 05:10) excludes a property
-- only for an OPEN task or
--
--     status = 'skipped' AND outcome->>'terminal' = 'true'
--
-- so a bare `status='skipped'` is NOT terminal to the seeder: it re-mints the
-- row the next morning and the retire becomes a chore repeated silently
-- forever (P176). This therefore stamps `terminal = 'true'`.
--
-- That stamp is exactly what would make the retire a DELETE, so it is paired
-- with its inverse -- the P121 re-enqueue pattern. `lcc_a4_reopen_tasks()`
-- clears `terminal`, returns the task to `queued`, and ledgers the reopen.
--
-- ⚠️ THE RE-OPEN SENSOR CANNOT LIVE IN SQL, AND THAT IS MEASURED, NOT ASSUMED.
-- LCC Opps holds NO mirror of `gov.ownership_history`: there is no LCC table
-- or view carrying a per-property transition count (`v_ownership_chain_worklist`
-- and `v_lcc_ownership_chain_completeness` both checked -- neither has one).
-- The ONLY thing in this system that reads gov transitions is the drafter tick
-- `api/_handlers/ownership-chain-draft-tick.js`, over `domainQuery`. So the
-- sensor is a re-open pass INSIDE that tick, reusing its existing
-- `fetchTransitionsFor` reader rather than adding a second gov fetcher that
-- can drift from it. This function is the write half; the tick is the eye.
--
-- Consequence, stated plainly: the retire below is live the moment this
-- migration applies, and the re-open pass is live on the next Railway
-- redeploy. Until that deploy, records landing on a retired property do NOT
-- bring it back on their own.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- Ledger. Reversal is by batch tag; `prior_outcome` is the whole jsonb so an
-- unretire restores the row byte-for-byte rather than guessing what was there.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_a4_retire_log (
  log_id           bigserial primary key,
  batch_tag        text        not null,
  action           text        not null
                     check (action in ('retired','reopened','unretired')),
  research_task_id uuid        not null,
  entity_id        uuid,
  domain           text,
  source_record_id text,
  reason           text,
  prior_status     text,
  prior_outcome    jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_lcc_a4_retire_log_batch on public.lcc_a4_retire_log (batch_tag);
create index if not exists idx_lcc_a4_retire_log_task  on public.lcc_a4_retire_log (research_task_id);

comment on table public.lcc_a4_retire_log is
  'A4. One row per A4 state change on an establish_ownership_history task. '
  'action=retired | reopened | unretired. Reverse a retire batch with '
  'lcc_a4_unretire(batch_tag). Read `retired` minus `reopened`/`unretired` for '
  'the live retired population -- never count the table.';

-- ---------------------------------------------------------------------------
-- lcc_a4_retire_no_records
--
-- Dry-run default. Returns the write set it WOULD write, so the grade
-- describes what ships (the A2 lesson: a dry run counted off the plan instead
-- of the write set is a dry run of something else).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_a4_retire_no_records(
  p_dry_run   boolean default true,
  p_batch_tag text    default null,
  p_limit     int     default null
) returns jsonb
language plpgsql
as $fn$
declare
  v_tag      text := coalesce(nullif(btrim(p_batch_tag), ''),
                              'a4-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_retired  int  := 0;
  v_out      jsonb;
begin
  -- The write set. `action` comes from the split view and nothing else.
  --
  -- ⚠️ `on commit drop` drops at COMMIT, not at statement end, so two calls in
  -- one transaction collide on the temp name (42P07). Found by the live round
  -- trip, not by any dry run -- and it is reachable in production the moment a
  -- caller sweeps gov and dia in the same transaction.
  drop table if exists _a4_plan;
  create temp table _a4_plan on commit drop as
  select s.research_task_id,
         s.entity_id,
         s.domain,
         s.source_record_id,
         t.status::text as prior_status,
         t.outcome      as prior_outcome
    from public.v_lcc_ownership_history_lane_split s
    join public.research_tasks t on t.id = s.research_task_id
   where s.action = 'no_records'
     and t.status in ('queued','in_progress')
   order by s.research_task_id
   limit coalesce(p_limit, 1000000);

  if p_dry_run then
    select jsonb_build_object(
             'dry_run',            true,
             'batch_tag',          v_tag,
             'tasks_to_retire',    count(*),
             'owners',             count(distinct entity_id),
             'sample',             coalesce(jsonb_agg(
                                       jsonb_build_object('task', p.research_task_id,
                                                          'domain', p.domain,
                                                          'property', p.source_record_id)
                                       order by p.research_task_id)
                                       filter (where p.rn <= 5), '[]'::jsonb))
      into v_out
      from (select pl.*, row_number() over (order by pl.research_task_id) rn
              from _a4_plan pl) p;
    return v_out;
  end if;

  with upd as (
    update public.research_tasks t
       set status  = 'skipped',
           outcome = coalesce(t.outcome, '{}'::jsonb) || jsonb_build_object(
                       'status',     'retired',
                       'reason',     'a4_no_usable_transition_on_file',
                       -- ⚠️ load-bearing: the seeder's ONLY terminal test.
                       -- Without it cron 144 re-mints this row at 05:10.
                       'terminal',   'true',
                       'a4_batch',   v_tag,
                       'retired_at', now(),
                       'reopen_on',  'gov.ownership_history gains a transition '
                                     || 'visible to v_ownership_transitions_portfolio '
                                     || '(dated, with both parties named)'),
           updated_at = now()
      from _a4_plan pl
     where t.id = pl.research_task_id
       and t.status in ('queued','in_progress')
    returning t.id, pl.entity_id, pl.domain, pl.source_record_id,
              pl.prior_status, pl.prior_outcome
  ),
  led as (
    insert into public.lcc_a4_retire_log
      (batch_tag, action, research_task_id, entity_id, domain,
       source_record_id, reason, prior_status, prior_outcome)
    select v_tag, 'retired', upd.id, upd.entity_id, upd.domain,
           upd.source_record_id, 'a4_no_usable_transition_on_file',
           upd.prior_status, upd.prior_outcome
      from upd
    returning 1
  )
  -- ⚠️ Count from the UPDATE's own RETURNING set, never from the ledger write
  -- that follows it (A2 defect 2: a join back to the plan over-reported by 18).
  select count(*) into v_retired from led;

  return jsonb_build_object(
    'dry_run',       false,
    'batch_tag',     v_tag,
    'tasks_retired', v_retired);
end;
$fn$;

comment on function public.lcc_a4_retire_no_records(boolean, text, int) is
  'A4. Retire the establish_ownership_history tasks the split view classes '
  'no_records. Reads v_lcc_ownership_history_lane_split.action -- never the '
  'drafted prose, never insufficient_reason directly. Stamps '
  'outcome.terminal=true because that is the ONLY thing cron 144 treats as '
  'terminal. Reverse with lcc_a4_unretire(batch_tag); re-open with '
  'lcc_a4_reopen_tasks(). Read tasks_retired, never tasks scanned.';

-- ---------------------------------------------------------------------------
-- lcc_a4_reopen_tasks -- the inverse sweep (P121).
--
-- Called by the drafter tick with the properties that NOW have gov
-- transitions. Clears `terminal` so cron 144 stops excluding the property,
-- and returns the task itself to `queued` so the drafter picks it up the same
-- night rather than waiting for a re-mint.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_a4_reopen_tasks(
  p_domain       text,
  p_property_ids text[],
  p_dry_run      boolean default true,
  p_reason       text    default 'transitions_landed'
) returns jsonb
language plpgsql
as $fn$
declare
  v_n int := 0;
begin
  if p_property_ids is null or array_length(p_property_ids, 1) is null then
    return jsonb_build_object('dry_run', p_dry_run, 'tasks_reopened', 0,
                              'note', 'no_property_ids_supplied');
  end if;

  drop table if exists _a4_reopen;   -- see the 42P07 note on _a4_plan
  create temp table _a4_reopen on commit drop as
  select t.id, t.entity_id, t.domain, t.source_record_id,
         t.status::text as prior_status, t.outcome as prior_outcome
    from public.research_tasks t
   where t.research_type = 'establish_ownership_history'
     and t.status = 'skipped'
     and t.outcome->>'reason' = 'a4_no_usable_transition_on_file'
     and t.domain = p_domain
     and t.source_record_id = any (p_property_ids);

  if p_dry_run then
    select count(*) into v_n from _a4_reopen;
    return jsonb_build_object('dry_run', true, 'tasks_to_reopen', v_n);
  end if;

  with upd as (
    update public.research_tasks t
       set status  = 'queued',
           outcome = (coalesce(t.outcome, '{}'::jsonb)
                       - 'terminal' - 'status' - 'reason' - 'retired_at' - 'reopen_on')
                     || jsonb_build_object('a4_reopened_at', now(),
                                           'a4_reopen_reason', p_reason),
           updated_at = now()
      from _a4_reopen r
     where t.id = r.id
    returning t.id, r.entity_id, r.domain, r.source_record_id,
              r.prior_status, r.prior_outcome,
              coalesce(r.prior_outcome->>'a4_batch', 'unknown') as batch
  ),
  led as (
    insert into public.lcc_a4_retire_log
      (batch_tag, action, research_task_id, entity_id, domain,
       source_record_id, reason, prior_status, prior_outcome)
    select upd.batch, 'reopened', upd.id, upd.entity_id, upd.domain,
           upd.source_record_id, p_reason, upd.prior_status, upd.prior_outcome
      from upd
    returning 1
  )
  select count(*) into v_n from led;

  return jsonb_build_object('dry_run', false, 'tasks_reopened', v_n);
end;
$fn$;

comment on function public.lcc_a4_reopen_tasks(text, text[], boolean, text) is
  'A4. The inverse of the retire (P121 re-enqueue). Clears outcome.terminal and '
  'returns the task to queued for properties whose gov transitions have since '
  'landed. LCC Opps holds no mirror of gov.ownership_history, so the CALLER is '
  'the drafter tick (the only reader of v_ownership_transitions_portfolio), '
  'reusing its own fetchTransitionsFor -- not a second gov fetcher.';

-- ---------------------------------------------------------------------------
-- Full reversal of a batch: restore status and the whole prior outcome.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_a4_unretire(p_batch_tag text)
returns jsonb
language plpgsql
as $fn$
declare v_n int := 0;
begin
  with tgt as (
    select distinct on (l.research_task_id)
           l.research_task_id, l.prior_status, l.prior_outcome
      from public.lcc_a4_retire_log l
     where l.batch_tag = p_batch_tag
       and l.action = 'retired'
       -- a task already reopened is not this batch's to restore
       and not exists (select 1 from public.lcc_a4_retire_log x
                        where x.research_task_id = l.research_task_id
                          and x.action in ('reopened','unretired')
                          and x.log_id > l.log_id)
     order by l.research_task_id, l.log_id desc
  ),
  upd as (
    update public.research_tasks t
       set status     = tgt.prior_status::research_status,
           outcome    = tgt.prior_outcome,
           updated_at = now()
      from tgt
     where t.id = tgt.research_task_id
    returning t.id
  ),
  led as (
    insert into public.lcc_a4_retire_log
      (batch_tag, action, research_task_id, reason)
    select p_batch_tag, 'unretired', upd.id, 'batch_reversal' from upd
    returning 1
  )
  select count(*) into v_n from led;

  return jsonb_build_object('batch_tag', p_batch_tag, 'tasks_unretired', v_n);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Observability.
--
-- `v_lcc_a4_retired_watch` -- the live retired population (retired MINUS any
-- later reopen/unretire), so a reader cannot mistake the ledger's row count
-- for the population.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_a4_retired_watch as
with last_action as (
  select distinct on (research_task_id)
         research_task_id, batch_tag, action, created_at
    from public.lcc_a4_retire_log
   order by research_task_id, log_id desc
)
select la.research_task_id,
       la.batch_tag,
       la.created_at as retired_at,
       t.domain,
       t.source_record_id,
       t.entity_id,
       t.status::text  as task_status,
       t.outcome->>'reason'   as retire_reason,
       t.outcome->>'terminal' as terminal_flag,
       t.title
  from last_action la
  join public.research_tasks t on t.id = la.research_task_id
 where la.action = 'retired';

comment on view public.v_lcc_a4_retired_watch is
  'A4. The LIVE retired population: tasks whose most recent A4 ledger action is '
  '`retired`. A task later reopened or unretired drops out. Never count '
  'lcc_a4_retire_log directly -- it is an append-only history of state changes.';

-- ---------------------------------------------------------------------------
-- The one named exception. Property 14280 carries a real prior owner from a
-- county deed and is blocked ONLY by a missing transfer_date -- one date
-- lookup from being real ownership history, unlike the other 73. It is
-- retired with them (undated is undraftable) but stays findable here rather
-- than being absorbed into a bucket it does not belong to (P181).
--
-- Kept as a static, commented reference because LCC cannot query gov: the
-- membership was measured on gov directly and is recorded in
-- docs/audits/A4_OWNERSHIP_LANE_RETIRE_AND_ADJUDICATE_2026-08-27.md.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_a4_undated_prior_owner_watch as
select w.*,
       'gov.ownership_history has a county-deed row naming a prior owner with no '
       'transfer_date; recover the date from the deed rather than retiring the fact'
         as note
  from public.v_lcc_a4_retired_watch w
 where w.domain = 'gov'
   and w.source_record_id = '14280';

comment on view public.v_lcc_a4_undated_prior_owner_watch is
  'A4. The single retired property whose gov record DOES name a prior owner '
  '(SUFFOLK VA III FGF, LLC -> Boyd Watterson, county deed) and is blocked only '
  'by a NULL transfer_date. Measured 2026-08-27: 83 of the 84 raw rows behind '
  'the 74 retired properties carry no prior owner at all; this is the one that '
  'does. Recoverable by date lookup, not by loosening a guard.';

commit;

-- ---------------------------------------------------------------------------
-- SCHEDULE -- cron 245 (`lcc-a4-retire-no-records`), scheduled live 2026-08-27.
--
-- 06:51 UTC, after the 06:45 drafter (so today's classification is fresh) and
-- after the 06:49 A2 apply (so a task A2 completes is never seen as a retire
-- candidate). Calls the function directly rather than via lcc_cron_post, so no
-- Railway deploy is on the critical path -- crons 103/144/244 already do this.
--
-- Scheduled even though it will usually retire 0: an unscheduled job is
-- invisible, and this lane's producer is recurring (P133/P176).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'lcc-a4-retire-no-records',
  '51 6 * * *',
  $cron$ select public.lcc_a4_retire_no_records(false, 'a4-nightly-' || to_char(now(),'YYYYMMDD')); $cron$
);

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--
--   select public.lcc_a4_unretire('<batch_tag>');
--   select cron.unschedule('lcc-a4-retire-no-records');
--   drop view if exists public.v_lcc_a4_undated_prior_owner_watch;
--   drop view if exists public.v_lcc_a4_retired_watch;
--   drop function if exists public.lcc_a4_unretire(text);
--   drop function if exists public.lcc_a4_reopen_tasks(text, text[], boolean, text);
--   drop function if exists public.lcc_a4_retire_no_records(boolean, text, int);
--   drop table if exists public.lcc_a4_retire_log;
-- ---------------------------------------------------------------------------
