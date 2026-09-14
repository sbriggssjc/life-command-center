-- ============================================================================
-- P112 Unit A2 — enrol the reachable, value-qualified owners nobody works
-- + SCHEDULE the four cadence sweeps that were built and never wired up
-- ============================================================================
-- Prompt 112 removed the noise (active surface 1,214 -> 278) and flagged Unit A2
-- as unbuilt. This closes it, and closes a bigger gap found on the way in.
--
-- ── THE BIGGER GAP: none of the P112 sweeps were scheduled ──────────────────
-- 112's write-up flagged only `lcc_p112_resume_workable_cadences` as needing a
-- cron. In fact **no cron referenced any P112 function** — retire, resume and
-- stamp were all built, verified, and then never ran again. So the consumption
-- loop the prompt was written to close had not actually closed: the one-shot
-- results were frozen in place and would drift the moment data moved.
--   jobid 226  lcc-p112-retire-unworkable    20 6 * * *
--   jobid 227  lcc-p112-resume-workable      25 6 * * *
--   jobid 228  lcc-p112-enrol-workable       30 6 * * *   (this unit)
--   jobid 229  lcc-p112-stamp-point-person   35 6 * * *
-- Order matters: retire (drop noise) -> resume (return the workable) ->
-- enrol (add newly-qualified) -> stamp the point person on whatever is active.
-- All four dry-ran to 0 before scheduling, i.e. they are at steady state and
-- the schedule is maintenance, not a pending bulk change.
--
-- ── HONEST SIZING (the raw count overstated this four times running) ────────
--   1,420 owner entities
--     110 reachable (narrow org-record definition)
--      99 reachable with no ACTIVE cadence   <- the number previously quoted
--      44 pass the SAME gate the retire sweep uses, via the CANONICAL
--         `lcc_entity_cadence_reachable()` predicate (broader than the ad-hoc
--         query, which is exactly why the ad-hoc number kept disagreeing)
--       1 excluded as a brokerage (below)
--      41 enrolled
-- The other ~58 fail the value gate and are **correctly excluded, not a gap**.
-- Enrolling them would re-create precisely the noise 112 just cleared.
--
-- RULE REINFORCED: never hand-roll a reachability predicate. Call
-- `lcc_entity_cadence_reachable()` / read `v_lcc_owner_reachability`.
--
-- ── A BROKERAGE WAS ABOUT TO BE PROSPECTED AS A LANDLORD ────────────────────
-- The first dry-run put **Marcus & Millichap** ($4.99M connected value) at the
-- top of the enrolment list. It is recorded in `lcc_property_owner` as a
-- property owner. Sizing that revealed a standing data-quality problem —
-- **46 owner rows name a brokerage as the owner**:
--     relationship_graph  42
--     domain_true_owner    4
--     supersession         0   <- the guard added in 20260907120000 held
-- and they split into two distinct classes:
--   (a) ~35 SUFFIX-POLLUTED names — "1121 California Avenue LLC by Capital
--       Pacific", "DP Brighton LLC by Marcus & Millichap", "Michvet LLC by
--       Northmarq". The OWNER IS CORRECT; the NAME carries a CoStar
--       "by <broker>" suffix. This is the `_BROKER_SUFFIX_RE_R5` defect that
--       detail.js already strips defensively ON RENDER — the underlying data
--       was never cleaned. Fix = strip at source.
--   (b) ~11 PURE BROKERAGES as owner — "Marcus & Millichap", "Capital Pacific",
--       "Stan Johnson Co", "Lee & Associates", "Trammell Crow Co (CBRE)",
--       "NAI Pfefferle", "Svn(r)". The OWNER IS WRONG.
-- Not fixed here: (a) and (b) need different treatments and their own dry-run.
-- Logged in connectivity-and-open-threads.md as the next data unit.
--
-- ── DISCIPLINE ──────────────────────────────────────────────────────────────
-- The gate is COPIED VERBATIM from lcc_p112_resume_workable_cadences rather
-- than re-implemented, so enrol / retire / resume can never drift apart. Change
-- the floor or the arms in all three or none.
-- Consumption-Layer contract: named consumer = My Day / the outreach focus
-- session (both read active cadences); value gate = open opp OR SF activity OR
-- connected value/rent >= floor; auto-retire = the retire sweep pauses these
-- again the moment they stop qualifying (reversible, never deleted); ranked by
-- connected value and capped by p_limit; the return value is what it enrolled,
-- not what it scanned.
--
-- Idempotency note: the first cut selected owners with no ACTIVE cadence, so
-- three owners holding a PAUSED row stayed eligible forever while the insert
-- silently no-opped on `uq_cadence_contact_property` — a dry-run that reports
-- "would_enrol 3" in perpetuity is a dishonest count. Enrolment now requires NO
-- cadence row at all; a paused row is the resume sweep's job. Re-run = 0.
--
-- REVERSAL
--   delete from public.touchpoint_cadence
--    where metadata->>'enrolled_by' = 'lcc_p112_enroll_workable_owners'
--      and metadata->>'batch_tag'   = 'a2_enrol_20260815';
--   (safe to delete outright — a freshly enrolled row carries no touch history)
--
-- ── APPLIED 2026-08-15, batch `a2_enrol_20260815` ───────────────────────────
--   enrolled                     41  (1 brokerage skipped)
--   cadence rows total    1,905 -> 1,946
--   active surface          278 -> 319
--   due in the future        23 -> 22 + 41 new due now
--   last_touch_at in future   0  (unchanged)
--   re-run                    0  (idempotent)
-- ============================================================================

-- The function body as applied lives in the database; see
-- `lcc_p112_enroll_workable_owners` on LCC Opps (xengecqvemvfknjvbvrq).
-- Reproduced here so the repo is a faithful record:

-- create or replace function public.lcc_p112_enroll_workable_owners(
--   p_dry_run boolean default true, p_floor numeric default 500000,
--   p_limit int default 100, p_batch text default null) returns jsonb ...
--   (selects owners with NO cadence row that pass lcc_entity_cadence_reachable()
--    AND the verbatim P112 value gate, excludes lcc_owner_name_is_brokerage(),
--    ranks by connected value, caps at p_limit, inserts a 'prospecting' cadence
--    due now with tier A >= $2M else B, tagged enrolled_by + batch_tag.)

select cron.schedule('lcc-p112-retire-unworkable',  '20 6 * * *',
  $$select public.lcc_p112_retire_unworkable_cadences(false)$$);
select cron.schedule('lcc-p112-resume-workable',    '25 6 * * *',
  $$select public.lcc_p112_resume_workable_cadences(false)$$);
select cron.schedule('lcc-p112-enrol-workable',     '30 6 * * *',
  $$select public.lcc_p112_enroll_workable_owners(false, 500000, 100)$$);
select cron.schedule('lcc-p112-stamp-point-person', '35 6 * * *',
  $$select public.lcc_p112_stamp_cadence_point_person(false)$$);
