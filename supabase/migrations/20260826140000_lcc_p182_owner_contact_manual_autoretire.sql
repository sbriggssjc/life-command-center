-- P182 — auto-retire the exclusion state nothing ever clears (Class 10 refinement)
--
-- FINDING. `v_owner_contact_enrich_queue` excludes any owner with an OPEN
-- `owner_contact_manual` research task (added by P159, correctly: the automated worker
-- cannot resolve those rows). But NOTHING EVER CLOSES ONE — all 316 tasks read
-- status='queued' and not a single row has moved to any other status since the lane
-- was born 2026-06-27. So the exclusion never expires and the owner is removed from
-- automated processing permanently.
--
-- Measured 2026-08-26: 115 owners ($102,407,924 of current annual rent) already carry a
-- GENUINE named active contact in owner_contact_pivot -- the exact field the panel and
-- the enrich engine read -- while their research card still says "find the contact".
-- Gba Associates LP ($27.2M, Vincent Forte) and Reston Va II FGF ($25.3M, Joseph Capra)
-- have been queued 43 days.
--
-- DOCTRINE.
--   * Auto-retire (rule 2): a scheduled sweep closes items whose premise cleared.
--   * P176: a one-shot repair of a RECURRING producer is a chore you repeat forever --
--     so this ships with a cron, not as a one-time UPDATE.
--   * P176 again: clearing an item is not clearing a lane. This lane seeds from
--     owner_contact_pivot having no usable contact, so closing a task whose pivot now
--     HAS one is exactly the seed predicate failing -- the row will not be re-minted.
--   * P161: `works_at` is the weak Salesforce org edge and does NOT make an owner
--     reachable. This sweep keys on owner_contact_pivot.active_contact_entity_id (an
--     explicitly SELECTED contact), never on edge presence.
--   * P131: a candidate that merely restates the owner name is not a contact. Reuses
--     the EXISTING lcc_p131_candidate_restates_owner predicate rather than defining a
--     second one (normaliser drift).
--
-- Dry-run by default. Reversible via the batch tag. Idempotent.

create table if not exists lcc_p182_manual_retire_log (
  id             bigserial primary key,
  research_task_id uuid not null,
  entity_id      uuid,
  owner_name     text,
  contact_name   text,
  prior_status   text not null,
  batch_tag      text not null,
  retired_at     timestamptz not null default now()
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
      -- the premise has genuinely cleared: a real named person, not a self-echo
      and not lcc_p131_candidate_restates_owner(pe.name, coalesce(t.metadata->>'owner_name', e.name))
    order by t.created_at
    limit greatest(p_limit, 0)
  ),
  applied as (
    update research_tasks rt
       set status       = 'completed',
           completed_at = now(),
           metadata     = coalesce(rt.metadata,'{}'::jsonb) || jsonb_build_object(
                            'p182_autoretire_batch', v_batch,
                            'p182_closed_reason',    'active_contact_already_selected',
                            'p182_contact_name',     c.contact_name)
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
  select c.research_task_id,
         c.owner_name,
         c.contact_name,
         case when p_dry_run then 'would_close' else 'closed' end
  from cleared c;
end $$;

comment on function lcc_p182_retire_cleared_owner_contact_manual is
  'P182: close owner_contact_manual tasks whose premise cleared (a genuine named active '
  'contact is already selected in owner_contact_pivot), so the enrich-queue exclusion '
  'expires. Dry-run default. Reverse by batch tag - see the runbook below.';

-- ============================== VERIFY (run before --apply) ==============================
--   select * from lcc_p182_retire_cleared_owner_contact_manual();            -- dry run
--   select count(*) from lcc_p182_retire_cleared_owner_contact_manual();     -- expect 115
--   -- named-row expectation: Gba Associates LP -> Vincent Forte; Trammell Crow Co -> Thomas Finan
--
-- ============================== APPLY ===================================================
--   select * from lcc_p182_retire_cleared_owner_contact_manual(p_dry_run => false);
--
-- ============================== REVERSAL RUNBOOK ========================================
--   update research_tasks rt
--      set status = l.prior_status::research_status,
--          completed_at = null,
--          metadata = rt.metadata - 'p182_autoretire_batch' - 'p182_closed_reason' - 'p182_contact_name'
--     from lcc_p182_manual_retire_log l
--    where rt.id = l.research_task_id and l.batch_tag = '<batch>';
--   delete from lcc_p182_manual_retire_log where batch_tag = '<batch>';
