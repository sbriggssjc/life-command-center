-- ============================================================================
-- P176 — supersede the card AND clear the producer's SEED (2026-08-26).
--        Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- ⚠️ THIS FIXES P172 — WHICH WAS UNDONE WITHIN 24 HOURS, BY DESIGN, SILENTLY.
--
-- P172 (2026-08-25) superseded 78 `junk_entity_name` cards whose subject had
-- been merged away, and reported the honest result at the time: open cards on a
-- merged subject 80 -> 2. **By the next morning 10 of those exact cards were
-- open again.** Not similar cards — the same subjects, re-minted the same day:
-- JBG SMITH Properties | Ares Management, Mark Neumann | Columbia Development
-- Group, InCommercial Property Group, Terreno Realty, AP Williams | SOUTH QUEEN
-- ASSOCIATES LLC … the very names P172's own header quotes as examples.
-- Measured: 10 of 10 re-opened cards had a P172-superseded sibling.
--
-- ROOT CAUSE — CLOSING A CARD IS NOT CLOSING A LANE. The junk lane does not
-- seed from the decision table; it seeds from a FLAG ON THE ENTITY,
-- `entities.metadata->>'junk_name_flagged'` (the B9 bulk worker knows this —
-- `delete meta.junk_name_flagged; // drop out of the lane (seed predicate
-- fails)`). P172 closed the symptom and left the seed, so the nightly seeder
-- did exactly what it is supposed to do and minted a fresh card.
--
-- The full re-mint surface was **78** — precisely the number P172 had closed.
-- 10 had fired; 68 were queued for subsequent nights.
--
-- **This is Class 8 of docs/audits/DEAD_END_AUDIT_PLAYBOOK.md, caught eating my
-- own repair.** It is also the strongest argument for the class: the P172
-- write-up was true when measured and false by morning, and nothing would have
-- revealed that except asking "was this row written AFTER the cleanup?".
--
-- THE FIX: lcc_close_decisions_on_merged_subjects now does BOTH — supersede the
-- card and drop the seed flag (soft: the key is removed and replaced with
-- junk_name_reviewed / junk_review_reason='subject_merged_away' /
-- junk_review_batch, mirroring the B9 worker's own reversible pattern). The
-- entity is never deleted and the prior metadata is snapshotted whole.
--
-- ⚠️ SCOPE HELD DELIBERATELY NARROW, TWICE:
--   • Only `junk_entity_name`. The other stranded types are NOT defects to fix:
--     **`exact_name_merge` (62 stranded, 0 open) has a tombstone subject BY
--     DESIGN** — the card records WHICH entity was merged away, so resolving it
--     to the survivor would falsify the history it exists to preserve.
--     sf_link_collision / sf_contact_account_mismatch stay open for a human; a
--     merge does not answer them.
--   • Only entities that are ALREADY merged. 712 LIVE entities carry
--     junk_name_flagged and are untouched (verified) — this is not a way to
--     drain the junk lane.
--
-- STANDING SWEEP: cron 238 `lcc-decisions-merged-subject-retire`, daily 06:40.
-- A one-shot repair of a recurring producer is a chore you repeat; the sweep is
-- what makes it stay fixed. It is idempotent, so a no-op day costs nothing.
--
-- ALSO MEASURED, NOT A DEFECT: 211 further junk cards on tombstones were minted
-- BEFORE their subject was merged (card first, merge later) and are all already
-- decided. That is ordinary staleness in closed history — left alone.
--
-- VERIFICATION GATE (all PASS 2026-08-26):
--   open junk cards on a tombstone                    0
--   merged entities still carrying junk_name_flagged  0   (the tap is closed)
--   idempotent re-run                                 0/0
--   LIVE entities still in the junk lane            712   (correctly untouched)
--
-- REVERSAL:
--   select * from lcc_unclear_junk_flag_on_merged('p176-junkflag-20260826');
--   update lcc_decisions set status='open', decided_at=null
--    where metadata->>'batch'='p176-junkflag-20260826';
--   select cron.unschedule('lcc-decisions-merged-subject-retire');
-- ============================================================================

create table if not exists lcc_p176_junk_flag_clear_log (
  id bigserial primary key,
  batch_tag text not null,
  entity_id uuid not null,
  entity_name text,
  prior_metadata jsonb not null,
  cleared_at timestamptz not null default now(),
  reverted_at timestamptz
);

create or replace function lcc_close_decisions_on_merged_subjects(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, cards bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'dec-merged-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _dm;
  create temp table _dm on commit drop as
  select d.id, d.decision_type, e.name as ghost_name,
         lcc_entity_survivor(d.subject_entity_id) as surv_id
  from lcc_decisions d
  join entities e on e.id = d.subject_entity_id
  where e.merged_into_entity_id is not null
    and d.decided_at is null
    -- Per TYPE, never blanket. Only junk_entity_name is answered by a merge.
    and d.decision_type = 'junk_entity_name';

  -- "Merged into nothing" is not an answer.
  delete from _dm where surv_id is null;

  -- The producer's SEED: entities.metadata->>'junk_name_flagged'. Clearing it is
  -- what actually stops the lane; superseding the card only treats the symptom.
  drop table if exists _df;
  create temp table _df on commit drop as
  select e.id, e.name, e.metadata as prior_metadata
  from entities e
  where e.merged_into_entity_id is not null
    and e.metadata->>'junk_name_flagged' is not null;

  if p_dry_run then
    return query select 'DRY-RUN would_supersede'::text, count(*)::bigint from _dm
      union all select 'DRY-RUN would_clear_junk_flag', count(*)::bigint from _df;
    return;
  end if;

  update lcc_decisions d
     set decided_at = now(),
         status  = 'superseded',
         metadata = coalesce(d.metadata,'{}'::jsonb)
                    || jsonb_build_object('auto_closed', true,
                                          'reason','subject_merged_away_question_moot',
                                          'survivor', m.surv_id::text,
                                          'batch', v_batch)
  from _dm m where m.id = d.id;

  insert into lcc_p176_junk_flag_clear_log(batch_tag, entity_id, entity_name, prior_metadata)
  select v_batch, f.id, f.name, f.prior_metadata from _df f;

  -- Soft + reversible: drop the seed key, record why. Never deletes the entity.
  update entities e
     set metadata = (coalesce(e.metadata,'{}'::jsonb) - 'junk_name_flagged')
                    || jsonb_build_object('junk_name_reviewed', true,
                                          'junk_review_reason','subject_merged_away',
                                          'junk_review_batch', v_batch),
         updated_at = now()
  from _df f where f.id = e.id;

  return query select 'SUPERSEDED (batch ' || v_batch || ')', count(*)::bigint from _dm
    union all select 'JUNK_FLAG_CLEARED (batch ' || v_batch || ')', count(*)::bigint from _df;
end $$;

create or replace function lcc_unclear_junk_flag_on_merged(p_batch text)
returns table(action text, entities bigint) language plpgsql as $$
begin
  update entities e set metadata = l.prior_metadata, updated_at = now()
  from lcc_p176_junk_flag_clear_log l
  where l.batch_tag = p_batch and l.reverted_at is null and e.id = l.entity_id;
  update lcc_p176_junk_flag_clear_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED ' || p_batch, count(*)::bigint
               from lcc_p176_junk_flag_clear_log where batch_tag = p_batch and reverted_at is not null;
end $$;

-- Standing auto-retire. A one-shot repair of a recurring producer is a chore.
-- select cron.schedule('lcc-decisions-merged-subject-retire', '40 6 * * *',
--   $$select public.lcc_close_decisions_on_merged_subjects(false, 'auto-' || to_char(now(),'YYYYMMDD'))$$);
-- (applied live as jobid 238)
