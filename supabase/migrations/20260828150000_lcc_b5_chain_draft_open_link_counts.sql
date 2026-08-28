-- ============================================================================
-- 20260828150000_lcc_b5_chain_draft_open_link_counts.sql
-- B5 — the standing draft's link count, per OPEN lane task.
--
-- The drafter prepares from `fresh` = open AND UNDRAFTED, so a task that already
-- carries a proposal is never re-drafted. Measured live 2026-08-28: 527 of 579
-- open gov tasks are already drafted, and every one of those drafts was built
-- BEFORE the B5 sales feeder put 2,776 transitions into gov.ownership_history.
-- Without a state-keyed re-draft pass B5 would convert on 52 tasks instead of
-- 579 — the same stale-draft trap A4b and A2b were each built to close, arriving
-- for a third time from a third direction.
--
-- This view is the COMPARISON's single owner: subject_ref -> how many links the
-- standing draft used. The drafter's B5 pass re-runs the REAL planner against
-- the live gov view and supersedes only where it now yields MORE links, so a
-- failed gov fetch supersedes nothing ("the fetch returned less" must never read
-- as "the chain got shorter").
--
-- Reversible: drop view if exists v_lcc_ownership_chain_draft_open_link_counts;
-- ============================================================================
create or replace view public.v_lcc_ownership_chain_draft_open_link_counts as
select
  p.proposal_id,
  p.subject_ref,
  split_part(p.subject_ref, ':', 2)                              as source_domain,
  split_part(p.subject_ref, ':', 3)                              as source_property_id,
  coalesce(jsonb_array_length(p.proposed_link -> 'links'), 0)    as standing_links,
  t.id                                                           as research_task_id
from public.lcc_clean_assist_proposals p
join public.research_tasks t
  on  t.research_type    = 'establish_ownership_history'
  and t.status           in ('queued', 'in_progress')
  and t.domain           = split_part(p.subject_ref, ':', 2)
  and t.source_record_id = split_part(p.subject_ref, ':', 3)
where p.source = 'ownership_chain_draft'
  and p.status = 'proposed'
  and jsonb_typeof(p.proposed_link -> 'links') = 'array';

comment on view public.v_lcc_ownership_chain_draft_open_link_counts is
  'B5: standing draft link count per OPEN establish_ownership_history task. Drives the drafter''s B5 re-draft pass (a draft built before new transitions landed is stale and would otherwise never be rebuilt).';

grant select on public.v_lcc_ownership_chain_draft_open_link_counts to anon, authenticated, service_role;
