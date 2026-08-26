-- ============================================================================
-- P182 / P182a — auto-retire the exclusion state nothing ever clears (Class 10)
--                APPLIED LIVE 2026-08-26 (batch p182a-reachable-20260826).
--
-- FINDING (P182). `v_owner_contact_enrich_queue` excludes any owner with an OPEN
-- `owner_contact_manual` research task — correct in itself (the automated worker cannot
-- resolve those rows). But NOTHING EVER CLOSES ONE: all 316 tasks read status='queued'
-- and not one had moved to any other status since the lane was born 2026-06-27. The
-- exclusion never expires, so the owner is removed from automated processing permanently.
--
-- ⚠️⚠️ TWO CORRECTIONS MADE ON NAMED ROWS BEFORE THE FIRST APPLY. The original gate would
-- have closed 115 tasks. **Only 5 qualified.** Both errors were plausible and both would
-- have shipped on the strength of an aggregate.
--
-- CORRECTION 1 — CLOSE AS `skipped`, NEVER `completed`.
--   The premise cleared; nobody did the work. Marking 115 tasks `completed` would credit
--   the lane with 115 completions for work never performed, AND corrupt the Class 2
--   detector, which keys on `count(*) filter (where status='completed')` — a lane with
--   zero real completions would suddenly report 115. The convention already in use on
--   this very table is `skipped` + an outcome reason: `establish_ownership_history` closed
--   142 as `chain_gap_resolved_or_changed` and 1,548 as `below_value_floor`, all skipped.
--   One convention, not two. (Verified after apply: lane completions still 0.)
--
-- CORRECTION 2 — REQUIRE A **REACHABLE** CONTACT, NOT MERELY A NAMED ONE.
--   The gate keyed on `active_contact_entity_id is not null` + "does not restate the owner
--   name". Measured live, that matched 115 tasks. Reading them:
--
--       11  a genuinely different named person   (5 of them with an email or phone)
--      104  SELF-ECHO with ZERO email and ZERO phone
--
--   The 104 are the owner's own name copied into the contact slot with no contact detail:
--   "Alan Cohen" -> Alan Cohen, "Avalon Companies" -> Avalon Companies,
--   "PS Business Parks" -> PS Business Parks. That is the **P164 phantom-contact shape**.
--   Closing them would suppress 104 owners from the acquisition lane while nobody can
--   actually be called — the premise has NOT cleared. Even 6 of the 11 different-named
--   rows carried no email and no phone and are correctly left open.
--
--   ⚠️ AND THE OBVIOUS DISCRIMINATOR WAS ALSO WRONG. A first split used
--   `lcc_owner_name_has_org_marker` to separate "an individual owner is legitimately their
--   own contact" from "an org as its own contact" — and put **PS Business Parks, Rexford
--   Industrial, Sterling Bay, Foulger Pratt and FD Stonewater** in the INDIVIDUAL bucket,
--   because a firm without a legal suffix reads as a person. Class 4: the guard checked the
--   label. **Reachability is the substance** — does the contact carry an email or a phone?
--
-- RESULT (batch p182a-reachable-20260826), all five verifiable by eye:
--     Acquest Development           -> Omar Abu-Sitta
--     Garrett Development           -> Andrew Garrett
--     Gba Associates LP             -> Vincent Forte
--     Procacci Development Company  -> Philip Procacci
--     Trammell Crow Co              -> Thomas Finan
--   Lane 316 -> 311. Completions still 0. Re-run yields 0 (idempotent).
--
-- DOCTRINE HELD:
--   * Auto-retire (rule 2): a scheduled sweep closes items whose premise cleared.
--   * P176: a one-shot repair of a RECURRING producer is a chore you repeat forever — pair
--     this with a cron once the 5-row result is trusted (deliberately NOT scheduled yet:
--     a gate that just went from 115 to 5 should be watched before it runs unattended).
--   * P161: `works_at` is the weak SF org edge and does not make an owner reachable. This
--     keys on `active_contact_entity_id` (an explicitly SELECTED contact), never on edges.
--   * P131: reuses the EXISTING `lcc_p131_candidate_restates_owner` predicate rather than
--     defining a second one (normaliser drift).
--
-- REVERSAL:
--   update research_tasks rt
--      set status = l.prior_status::research_status,
--          outcome = rt.outcome - 'status' - 'reason' - 'contact_name' - 'batch'
--     from lcc_p182_manual_retire_log l
--    where rt.id = l.research_task_id and l.batch_tag = 'p182a-reachable-20260826';
--   delete from lcc_p182_manual_retire_log where batch_tag = 'p182a-reachable-20260826';
-- ============================================================================

create table if not exists lcc_p182_manual_retire_log (
  id               bigserial primary key,
  research_task_id uuid not null,
  entity_id        uuid,
  owner_name       text,
  contact_name     text,
  prior_status     text not null,
  batch_tag        text not null,
  retired_at       timestamptz not null default now()
);
create index if not exists idx_p182_manual_retire_batch on lcc_p182_manual_retire_log(batch_tag);

create or replace function lcc_p182_retire_cleared_owner_contact_manual(
  p_dry_run   boolean default true,
  p_limit     integer default 500,
  p_batch_tag text    default null
)
returns table (
  research_task_id uuid,
  owner_name       text,
  contact_name     text,
  action           text
)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_batch text := coalesce(p_batch_tag, 'p182-manual-autoretire-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  return query
  with cleared as (
    select t.id            as research_task_id,
           t.entity_id     as entity_id,
           t.status::text  as prior_status,
           coalesce(t.metadata->>'owner_name', e.name) as owner_name,
           pe.name         as contact_name
    from research_tasks t
    join entities e            on e.id = t.entity_id
    join owner_contact_pivot p on p.entity_id = t.entity_id
                              and p.active_contact_entity_id is not null
    join entities pe           on pe.id = p.active_contact_entity_id
    where t.research_type = 'owner_contact_manual'
      and t.status in ('queued','in_progress')
      -- a real named person, not a self-echo of the owner
      and not lcc_p131_candidate_restates_owner(pe.name, coalesce(t.metadata->>'owner_name', e.name))
      -- P182a: and REACHABLE — a name with no email and no phone is not a contact
      and (nullif(trim(coalesce(pe.email,'')),'') is not null
           or nullif(trim(coalesce(pe.phone,'')),'') is not null)
    order by t.created_at
    limit greatest(p_limit, 0)
  ),
  applied as (
    update research_tasks rt
       set status  = 'skipped',
           outcome = coalesce(rt.outcome,'{}'::jsonb) || jsonb_build_object(
                       'status',       'superseded',
                       'reason',       'reachable_contact_already_selected',
                       'contact_name', c.contact_name,
                       'batch',        v_batch),
           updated_at = now()
      from cleared c
     where rt.id = c.research_task_id
       and not p_dry_run
    returning rt.id
  ),
  logged as (
    insert into lcc_p182_manual_retire_log
      (research_task_id, entity_id, owner_name, contact_name, prior_status, batch_tag)
    select c.research_task_id, c.entity_id, c.owner_name, c.contact_name, c.prior_status, v_batch
    from cleared c
    where not p_dry_run and exists (select 1 from applied a where a.id = c.research_task_id)
    returning 1
  )
  select c.research_task_id, c.owner_name, c.contact_name,
         case when p_dry_run then 'would_skip' else 'skipped' end
  from cleared c;
end $$;

comment on function lcc_p182_retire_cleared_owner_contact_manual is
  'P182a: close owner_contact_manual tasks whose premise genuinely cleared — a REACHABLE '
  'named contact (email or phone) is already selected in owner_contact_pivot. Closes as '
  'skipped, never completed. Dry-run default; reverse by batch tag.';

-- ============================== VERIFY ==================================================
--   select * from lcc_p182_retire_cleared_owner_contact_manual();   -- dry run, expect 0 now
--   select count(*) from research_tasks
--    where research_type='owner_contact_manual' and status='completed';  -- MUST stay 0
