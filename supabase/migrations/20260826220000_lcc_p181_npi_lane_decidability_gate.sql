-- ============================================================================
-- P181 — the npi_missing_inventory lane was VALUE-gated but never
--        DECIDABILITY-gated (2026-08-26). Applied live to LCC Opps.
--
-- ⚠️ MY OWN FRAMING WAS WRONG TWICE BEFORE THE DATA CORRECTED IT.
--
-- (1) I called this "a third dead lane" on the strength of 203 open / 0 closed.
--     The tasks were created 2026-08-06..08-15 — the lane is THREE WEEKS OLD.
--     "Zero completions ever" on a new lane is a different claim from zero on a
--     year-old one, and the phrase hides the difference.
--
-- (2) I then assumed it needed a capture path (Class 3) and started designing
--     one. The tasks carry a ready-made `metadata.deep_link`
--     (`#/dia?d=prop:dia:453502:Overview`), so rendering a button looked
--     obvious — until I checked the destination: **NPI is DISPLAY-ONLY in the
--     clinic panel** (`_row('NPI', ...)`, no edit field). A deep-link button
--     would have been precisely the P173 trap it was meant to fix: notify, and
--     still not capture.
--
-- WHAT IS ACTUALLY THERE (dia `zqzrriwuavgrquhisnoa`): an NPPES lookup worker
-- ALREADY RAN. `npi_registry_lookups` holds 7,088 rows. For the 504
-- missing-NPI clinics: **all 504 have a lookup, 480 returned a candidate NPI,
-- and 0 were applied** — every one marked `low_confidence` / `no_match`.
--
-- **That is the worker abstaining, correctly, under the never-guess rule.** The
-- research tasks are the intended escalation of the low-confidence residue to a
-- human. The lane is the designed flow working, NOT a dead producer.
--
-- ⚠️ THE REAL DEFECT: `low_confidence` was applied to everything, so a genuine
-- judgement call and a hopeless one wore the same label. Scored:
--
--     >= 0.75  DECIDABLE          50 clinics  (avg 0.80)
--     0.50-.75 weak              141 clinics  (avg 0.67)
--     <  0.50  not a match       289 clinics  (avg 0.28)   <- not a judgement call
--
-- A 0.28 score is not "low confidence in a match", it is "there is no match".
-- Of the 203 QUEUED tasks: **15 decidable, 47 weak, 129 below 0.50, 12 with no
-- candidate at all — 141 of 203 (69%) that no human could ever resolve**,
-- burying the 15 that they could. The producer capped by PATIENT VOLUME and
-- never filtered by whether the question was answerable: value-gated, but the
-- Consumption-Layer "actionable-only" rule has a second axis and this missed it.
--
-- ACTION (reversible, tagged, dry-run-verified — two independent computations
-- agreed on 15/47/141 before anything was written):
--   • 141 retired to `skipped` with reason `no_plausible_npi_match` + the score.
--     Never deleted. These need better SOURCE DATA, not a human.
--   • 47 weak  -> priority 60
--   • 15 decidable -> priority 30
--   Lane open count 203 -> 62.
--
-- GATE (all PASS): 62 open; 141 retired and tagged; **0 tasks with a score
-- >= 0.50 were retired**; 203 log rows for reversal.
--
-- ⚠️ STILL OPEN, NOT BUILT HERE: the 15 (and arguably the 47) need a BINARY
-- VERDICT surface — "is clinic X the same facility as NPPES org Y?" — with the
-- clinic name/address beside `best_match_org`/`npi_address`. That is a Decision
-- Center lane, not a research card, and it is the correct home for a
-- confirm/reject question. Until it exists these 62 remain notify-only, and the
-- lane picker correctly reports `answerable = false`.
--
-- REVERSAL: select * from lcc_ungate_npi_tasks('p181-npi-gate-20260826');
-- ============================================================================

create table if not exists lcc_p181_npi_task_gate_log (
  id bigserial primary key,
  batch_tag text not null,
  task_id uuid not null,
  clinic_id text,
  action text not null,              -- 'retire_undecidable' | 'rank'
  prior_status text,
  prior_priority int,
  best_match_score numeric,
  gated_at timestamptz not null default now(),
  reverted_at timestamptz
);

-- Scores are supplied by the caller (they live in the dia DB), keyed by clinic_id.
create or replace function lcc_gate_npi_tasks(
  p_scores jsonb,                    -- [{"clinic_id":"...","score":0.83}, ...]
  p_dry_run boolean default true,
  p_batch text default null
) returns table(action text, tasks bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'p181-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _npi;
  create temp table _npi on commit drop as
  select rt.id as task_id, rt.metadata->>'clinic_id' as clinic_id,
         rt.status as prior_status, rt.priority as prior_priority,
         (select (e->>'score')::numeric from jsonb_array_elements(p_scores) e
           where e->>'clinic_id' = rt.metadata->>'clinic_id' limit 1) as score
  from research_tasks rt
  where rt.research_type = 'npi_missing_inventory'
    and rt.status in ('queued','in_progress');

  if p_dry_run then
    return query
      select case when n.score is null or n.score < 0.50
                  then 'DRY-RUN retire_undecidable (no plausible NPPES match)'
                  when n.score >= 0.75 then 'DRY-RUN rank 30 (decidable)'
                  else 'DRY-RUN rank 60 (weak but plausible)' end,
             count(*)::bigint
      from _npi n group by 1 order by 1;
    return;
  end if;

  insert into lcc_p181_npi_task_gate_log(batch_tag, task_id, clinic_id, action,
    prior_status, prior_priority, best_match_score)
  select v_batch, n.task_id, n.clinic_id,
         case when n.score is null or n.score < 0.50 then 'retire_undecidable' else 'rank' end,
         n.prior_status, n.prior_priority, n.score
  from _npi n;

  -- Undecidable: the premise cannot be acted on by a human, so it is retired
  -- with a REASON (never deleted). Reversible via the log.
  update research_tasks rt
     set status = 'skipped',
         outcome = coalesce(rt.outcome,'{}'::jsonb)
                   || jsonb_build_object('status','superseded',
                                         'reason','no_plausible_npi_match',
                                         'best_match_score', n.score,
                                         'batch', v_batch),
         updated_at = now()
  from _npi n
  where rt.id = n.task_id and (n.score is null or n.score < 0.50);

  update research_tasks rt
     set priority = case when n.score >= 0.75 then 30 else 60 end,
         updated_at = now(),
         metadata = coalesce(rt.metadata,'{}'::jsonb)
                    || jsonb_build_object('prior_priority', n.prior_priority,
                                          'ranked_by','npi_best_match_score',
                                          'best_match_score', n.score,
                                          'batch', v_batch)
  from _npi n
  where rt.id = n.task_id and n.score >= 0.50;

  return query
    select case when n.score is null or n.score < 0.50 then 'RETIRED_UNDECIDABLE (batch '||v_batch||')'
                when n.score >= 0.75 then 'RANKED 30 decidable (batch '||v_batch||')'
                else 'RANKED 60 weak (batch '||v_batch||')' end,
           count(*)::bigint
    from _npi n group by 1 order by 1;
end $$;

create or replace function lcc_ungate_npi_tasks(p_batch text)
returns table(action text, tasks bigint) language plpgsql as $$
begin
  update research_tasks rt
     set status = l.prior_status, priority = l.prior_priority,
         outcome = rt.outcome - 'status' - 'reason' - 'best_match_score' - 'batch',
         updated_at = now()
  from lcc_p181_npi_task_gate_log l
  where l.batch_tag = p_batch and l.reverted_at is null and rt.id = l.task_id;
  update lcc_p181_npi_task_gate_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED '||p_batch, count(*)::bigint
               from lcc_p181_npi_task_gate_log where batch_tag=p_batch and reverted_at is not null;
end $$;
