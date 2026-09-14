-- ============================================================================
-- P159a — P159's disease in a second form, plus the cadence that was hiding it.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-20.
-- ----------------------------------------------------------------------------
-- MEASURED ACROSS FOUR CONSECUTIVE LIVE RUNS.
--
--   run 2  (after P159, limit=100)  processed 42  attached 4  drill 35  skip 3
--   run 3  (after P159, limit=100)  processed 46  attached 4  drill 37  skip 5
--        ...and yet `find_person_at_manager` in the queue went 45 -> 47 (+2)
--           while the queue itself moved      752 -> 746 (-6)
--
-- So 35 of run 3's 37 drillthroughs were REPEATS. The drillthrough branch keys
-- on the NAME (not person-like, authority_level <= 2) and does NOT set
-- active_contact_entity_id -- so the row stays in the queue, matches the same
-- branch, re-mints the same managed_by edge idempotently, and reports
-- `manager_drillthrough` again. Forever. Real drain was ~6 rows/run, not 46.
--
-- ⚠️ THE LESSON, STATED PLAINLY: an outcome that reports success but does not
-- change the row's queue eligibility is indistinguishable from progress in the
-- summary counters. `drillthrough: 37` looked like the tick working hard. The
-- only thing that exposed it was comparing the STATE DELTA (queue -6,
-- find_person_at_manager +2) against the tally. Check the delta, not the tally --
-- the same discipline that caught the SAM "inserted: N" derivation counter and
-- the "rows sent vs rows written" trap earlier in this work.
--
-- `find_person_at_manager` is TERMINAL for the tick: it has already minted the
-- managing org and the managed_by edge. What remains -- "find a person at this
-- manager" -- is human work, and those owners stay visible on
-- v_owner_contact_worklist, which carries enrichment_action.
--
-- ── RESULT (run 4, immediately after the fix) ───────────────────────────────
--   run 3 (before)  processed 46  attached 4  drill 37  ->  queue drained  6
--   run 4 (after)   processed 19  attached 9  drill  7  ->  queue drained 16
-- Fewer rows processed, ~2.7x more drained, attached more than doubled, 0 failed.
-- Every slot now changes state.
--
-- ── CADENCE ─────────────────────────────────────────────────────────────────
-- With a real drain rate the daily cadence became the binding constraint (683
-- rows at 16/run = 43 days). cron 139 moved from `25 5 * * *` limit=25 to
-- `25 * * * *` limit=100 -- hourly. Safe because:
--   * the handler's 20s WALL CLOCK, not `limit`, governs batch size (limit=100
--     actually processed 19-46), so the job is self-bounding;
--   * every run so far reports failed:0;
--   * the external SOS/address/deed adapters are unconfigured, so the loop is
--     DB-bound with no third-party egress. ⚠️ IF ANY OWNER_ENRICH_*_URL IS EVER
--     SET, an untimed third-party fetch enters this serial loop with no rate
--     limit -- revisit the hourly cadence at that point.
--
-- REVERSAL:
--   drop the find_person_at_manager clause from the WHERE; and
--   select cron.alter_job(139, schedule := '25 5 * * *',
--     command := $x$SELECT public.lcc_cron_post(
--       '/api/owner-contact-enrich-tick?limit=25', '{}'::jsonb, 'vercel')$x$);
-- ============================================================================

CREATE OR REPLACE VIEW public.v_owner_contact_enrich_queue AS
 SELECT p.entity_id,
    p.owner_name,
    p.workspace_id,
    p.active_contact_name,
    p.active_contact_entity_id,
    p.active_authority_level,
    p.active_contact_role,
    p.enrichment_action,
    p.status,
    p.updated_at,
    COALESCE(NULLIF(pa.current_annual_rent_total, 0::numeric), cv.connected_property_value) AS rank_value
   FROM owner_contact_pivot p
     LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = p.entity_id
     LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = p.entity_id
  WHERE
    -- P159: nothing automated is possible; human work, lives on the worklist.
    p.enrichment_action IS DISTINCT FROM 'manual_research'
    -- P159a: already drilled to the managing org -- terminal for the tick.
    AND p.enrichment_action IS DISTINCT FROM 'find_person_at_manager'
    -- P159: already surfaced to a human.
    AND NOT EXISTS (
      SELECT 1 FROM public.research_tasks t
       WHERE t.entity_id = p.entity_id
         AND t.research_type = 'owner_contact_manual'
         AND t.status IN ('queued','in_progress'));

COMMENT ON VIEW public.v_owner_contact_enrich_queue IS
  'P159/P159a. Value-ranked queue for the owner-contact enrich tick, ACTIONABLE '
  'ONLY. Excludes three terminal states: enrichment_action=''manual_research'' '
  '(nothing automated to try), ''find_person_at_manager'' (already drilled to the '
  'managing org -- re-running just re-mints the same edge, and it did, 35 times '
  'per run), and owners with an open owner_contact_manual research task. All '
  'three previously occupied the highest-value slots under rank_value DESC and '
  'reported success while changing nothing. Humans still see them via '
  'v_owner_contact_worklist and v_lcc_named_lead_worklist.';

DO $$
DECLARE n_total int; n_dead int;
BEGIN
  SELECT count(*) INTO n_total FROM public.v_owner_contact_enrich_queue
   WHERE active_contact_entity_id IS NULL AND status IN ('active','exhausted');
  SELECT count(*) INTO n_dead FROM (
    SELECT * FROM public.v_owner_contact_enrich_queue
     WHERE active_contact_entity_id IS NULL AND status IN ('active','exhausted')
     ORDER BY rank_value DESC NULLS LAST, updated_at ASC LIMIT 50) t
   WHERE t.enrichment_action IN ('manual_research','find_person_at_manager')
      OR EXISTS (SELECT 1 FROM public.research_tasks rt
                  WHERE rt.entity_id = t.entity_id
                    AND rt.research_type='owner_contact_manual'
                    AND rt.status IN ('queued','in_progress'));
  IF n_dead > 0 THEN
    RAISE EXCEPTION 'P159a gate: % terminal rows still in the top 50', n_dead;
  END IF;
  RAISE NOTICE 'P159a ok: queue now % rows, 0 terminal rows in the head', n_total;
END $$;

-- Hourly, larger batch. The 20s wall clock keeps each run self-bounding.
SELECT cron.alter_job(
  job_id   := 139,
  schedule := '25 * * * *',
  command  := $cron$SELECT public.lcc_cron_post('/api/owner-contact-enrich-tick?limit=100', '{}'::jsonb, 'vercel')$cron$
);
