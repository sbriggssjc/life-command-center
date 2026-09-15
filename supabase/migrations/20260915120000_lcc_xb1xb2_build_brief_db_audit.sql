-- ============================================================================
-- XB1/XB2 — the DB-side half of the CTO/CDO build-brief collector.
--
-- Scope (docs/architecture/EXEC-BRIEFS-SPEC.md §5, prompt
-- prompts/XB1-XB2-build-brief-collector-and-audit-rules.md): a deterministic
-- collector + audit rules writing into `build_brief_snapshots` (EB1,
-- 20260911165100). NO dashboard here (#/exec is XB3) and NO Ollama narrative
-- (XB4) -- a surface with nothing behind it is how three "looks live, does
-- nothing" defects happened the same week this was scoped.
--
-- This migration ships the TWO rules that can only be answered from the DB
-- (feature_flags_registry, producer_runs) -- everything repo-side (branches,
-- prompts/responses, doc sizes, GENERATED-file edits) lives in the Node
-- collector (scripts/build-brief-collector.mjs) because git/filesystem state
-- is not queryable from Postgres. Both halves write into the SAME
-- `build_brief_snapshots.audit_flags` array via the collector script, which
-- calls this RPC and merges its findings with its own.
--
-- Cowork ran this audit BY HAND on 2026-09-14 before any code existed
-- (docs/os/PLANNED-BACKLOG.md XB2), which is the acceptance target these
-- rules are built against:
--   * 68 flags: 37 on, 29 off (now 31 off, live) -- 15 off >3 weeks, 11 off
--     >60 days, oldest SF_LIST_SEED_INSTITUTION off since 2026-05-30.
--   * sidebar_contact_guard: N runs, ALL skipped, 0 completions ever,
--     skip_reason='blocks_all_chrome_or_duplicate' (operational, NOT a flag).
--   * p_rss: skipped every run too, but skip_reason='flag MARKET_BRIEF_PRSS
--     is off' -- INTENDED, must never alert.
--
-- THE RULE REFINEMENT THE HAND RUN PRODUCED (do not collapse these two):
-- "no completions ever" is NOT the rule -- a flag-gated skip is the system
-- working (FEED2/MB2e's same dead-vs-silent distinction, one surface over).
-- The rule is: a producer whose skips are NOT flag-gated (skip_reason does
-- not match the writer convention `flag <NAME> is off`) and which has
-- completed ZERO of its last N runs is a stall wearing a skip's clothes.
-- A flag-gated skip streak of any length must never appear in this finding
-- set -- it belongs to the flag-long-dark rule instead (the flag itself is
-- the finding, not each producer it silences).
--
-- REVERSAL RUNBOOK:
--   DROP FUNCTION IF EXISTS public.lcc_build_brief_db_audit(integer, integer, integer, integer);
--   DROP VIEW IF EXISTS public.v_build_brief_flag_long_dark;
--   DROP VIEW IF EXISTS public.v_build_brief_producer_stall;
-- Neither view/function is read by any other object; no data is touched. The third rule reads
-- EB1's existing v_market_brief_staleness (owned by 20260911165100) -- do not drop that view here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Rule: flag-long-dark. A flag OFF past a re-measure age is either dead code
-- that should be deleted or forgotten work that should be scheduled -- CLAUDE
-- .md's own "re-measure a dated blocker" doctrine applied to feature flags.
-- off_since IS NULL (never recorded, or on-since-inception) is UNMEASURED,
-- never "0 days off" -- P180 (unknown is not zero).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_build_brief_flag_long_dark AS
SELECT
  flag,
  state,
  off_since,
  (CURRENT_DATE - off_since) AS days_off,
  owner,
  purpose,
  CASE
    WHEN off_since IS NULL THEN 'unmeasured'
    WHEN (CURRENT_DATE - off_since) >= 60 THEN 'critical'
    WHEN (CURRENT_DATE - off_since) >= 21 THEN 'warn'
    ELSE 'ok'
  END AS band
FROM public.feature_flags_registry
WHERE state <> 'on';

COMMENT ON VIEW public.v_build_brief_flag_long_dark IS
  'XB2 -- every OFF/partial feature_flags_registry row with its dark-duration '
  'band (ok <21d / warn >=21d / critical >=60d / unmeasured = off_since NULL, '
  'never counted as 0 -- P180). The collector filters to warn+critical for the '
  'finding set; ok and unmeasured rows ride along for the raw payload.';

-- ----------------------------------------------------------------------------
-- Rule: producer-stall-not-flag-gated. A producer whose most recent runs are
-- ALL skipped, for a reason that is NOT the writer convention naming an OFF
-- flag, and which has never once completed. The flag-gated case (skip_reason
-- matches 'flag <NAME> is off') is EXCLUDED here on purpose -- it is the
-- system working, and it is reported instead by v_build_brief_flag_long_dark
-- once that flag itself has been off long enough. Collapsing the two would
-- read as "N producers unhealthy" when N-1 of them are a single flag decision
-- (the exact FEED2/MB2e-class distinction the hand-run's rule refinement
-- names).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_build_brief_producer_stall AS
WITH per_producer AS (
  SELECT
    producer,
    count(*)                                               AS total_runs,
    count(*) FILTER (WHERE status = 'completed')            AS completed_runs,
    count(*) FILTER (WHERE status = 'skipped')               AS skipped_runs,
    count(*) FILTER (
      WHERE status = 'skipped' AND skip_reason ~ '^flag \S+ is off$'
    )                                                        AS flag_gated_skips,
    max(started_at)                                         AS last_run_at,
    -- The most recent non-flag-gated skip reason, for the finding detail --
    -- never the FIRST one (an old reason would misdescribe today's stall).
    (
      SELECT pr2.skip_reason FROM public.producer_runs pr2
      WHERE pr2.producer = pr.producer
        AND pr2.status = 'skipped'
        AND pr2.skip_reason !~ '^flag \S+ is off$'
      ORDER BY pr2.started_at DESC
      LIMIT 1
    ) AS last_operational_skip_reason
  FROM public.producer_runs pr
  GROUP BY producer
)
SELECT
  producer,
  total_runs,
  completed_runs,
  skipped_runs,
  flag_gated_skips,
  (skipped_runs - flag_gated_skips) AS operational_skips,
  last_run_at,
  last_operational_skip_reason
FROM per_producer
-- A producer that has completed at least once is not a stall -- it works,
-- even if it currently skips (a rate limit, a queue drain, etc.). A producer
-- whose ENTIRE skip history is flag-gated has zero operational_skips and is
-- excluded structurally, without a separate branch: the flag is the finding.
WHERE completed_runs = 0
  AND (skipped_runs - flag_gated_skips) > 0;

COMMENT ON VIEW public.v_build_brief_producer_stall IS
  'XB2 -- a producer with ZERO completions ever whose skip history includes '
  'at least one skip NOT matching the flag-off writer convention. Excludes a '
  'producer that has ever completed (working, even if it currently skips) and '
  'a producer whose skips are ENTIRELY flag-gated (the flag itself is the '
  'finding on v_build_brief_flag_long_dark, once it is old enough).';

-- ----------------------------------------------------------------------------
-- lcc_build_brief_db_audit() -- one jsonb findings array over both rules,
-- shaped identically to the collector's own repo-side findings so the two
-- merge without a translation layer:
--   {rule, severity, subject, measured, detail}
-- ----------------------------------------------------------------------------

-- B1/N15d lesson: adding a defaulted parameter to an existing function makes every call at the
-- OLD arity ambiguous (42725 "function is not unique") once both signatures exist. Drop the
-- 3-arg form first so only the 4-arg one remains.
DROP FUNCTION IF EXISTS public.lcc_build_brief_db_audit(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.lcc_build_brief_db_audit(
  p_flag_warn_days integer DEFAULT 21,
  p_flag_critical_days integer DEFAULT 60,
  p_stall_min_skips integer DEFAULT 1,
  p_stale_min_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_build_brief_flag_long_dark
    WHERE band IN ('warn', 'critical')
      AND days_off >= p_flag_warn_days
    ORDER BY days_off DESC NULLS LAST
  LOOP
    v_findings := v_findings || jsonb_build_object(
      'rule', 'flag_long_dark',
      'severity', CASE WHEN v_row.days_off >= p_flag_critical_days THEN 'critical' ELSE 'warn' END,
      'subject', v_row.flag,
      'measured', jsonb_build_object('days_off', v_row.days_off, 'off_since', v_row.off_since, 'state', v_row.state),
      'detail', format('Flag %s has been %s for %s days (since %s, owner: %s) -- either dead code to delete or forgotten work to schedule',
                        v_row.flag, v_row.state, v_row.days_off, v_row.off_since, COALESCE(v_row.owner, 'unassigned'))
    );
  END LOOP;

  FOR v_row IN
    SELECT * FROM public.v_build_brief_producer_stall
    WHERE operational_skips >= p_stall_min_skips
    ORDER BY operational_skips DESC
  LOOP
    v_findings := v_findings || jsonb_build_object(
      'rule', 'producer_stall_not_flag_gated',
      'severity', 'warn',
      'subject', v_row.producer,
      'measured', jsonb_build_object(
        'total_runs', v_row.total_runs, 'completed_runs', v_row.completed_runs,
        'skipped_runs', v_row.skipped_runs, 'operational_skips', v_row.operational_skips,
        'last_run_at', v_row.last_run_at
      ),
      'detail', format('Producer "%s" has %s runs, %s skipped operationally (not flag-gated), 0 completions ever -- last reason: %s',
                        v_row.producer, v_row.total_runs, v_row.operational_skips,
                        COALESCE(v_row.last_operational_skip_reason, 'unrecorded'))
    );
  END LOOP;

  -- Rule: market-brief lane stale-or-missing (spec §5 "stale market-brief facts"). Reuses EB1's
  -- v_market_brief_staleness rather than re-deriving staleness a second way -- this view already
  -- computes stale_after live, never cached, per the EB1 header's own doctrine.
  --
  -- ⚠️ XB2-precision (2026-09-15): this used to emit ONE FINDING PER (lane, section) cell, so one
  -- known fact -- "no producer has ever written a government or net_lease fact" (MB8/MB9) --
  -- became 10 critical findings (5 sections x 2 empty lanes), 31% of a 32-finding snapshot, and
  -- buried the one genuinely new find in the same run (SIDEBARGUARD1). It now emits ONE finding
  -- PER LANE, with every affected section named in `measured` rather than restated as its own row.
  -- A cell reads is_missing when that (lane, section) has never emitted a live fact at all
  -- (worse than stale); both states are still named, per-section, inside the single lane finding.
  FOR v_row IN
    SELECT
      s.lane,
      array_agg(s.section ORDER BY s.section) FILTER (WHERE s.is_missing) AS missing_sections,
      array_agg(s.section ORDER BY s.section) FILTER (WHERE NOT s.is_missing AND s.stale_count >= p_stale_min_count) AS stale_sections,
      sum(s.stale_count) FILTER (WHERE NOT s.is_missing) AS total_stale_count,
      sum(s.live_count) AS total_live_count,
      -- last_producer/_status/_skip_reason are identical across every section row for one lane
      -- (v_market_brief_staleness joins last_run on lane alone) -- max() picks the single value.
      max(s.last_producer) AS last_producer,
      max(s.last_run_status) AS last_run_status,
      max(s.last_run_skip_reason) AS last_run_skip_reason
    FROM public.v_market_brief_staleness s
    GROUP BY s.lane
    HAVING count(*) FILTER (WHERE s.is_missing) > 0
        OR count(*) FILTER (WHERE NOT s.is_missing AND s.stale_count >= p_stale_min_count) > 0
    ORDER BY (count(*) FILTER (WHERE s.is_missing) > 0) DESC, s.lane
  LOOP
    v_findings := v_findings || jsonb_build_object(
      'rule', 'market_brief_lane_stale_or_missing',
      'severity', CASE WHEN v_row.missing_sections IS NOT NULL THEN 'critical' ELSE 'warn' END,
      'subject', v_row.lane,
      'measured', jsonb_build_object(
        'missing_sections', COALESCE(v_row.missing_sections, ARRAY[]::text[]),
        'stale_sections', COALESCE(v_row.stale_sections, ARRAY[]::text[]),
        'total_stale_count', COALESCE(v_row.total_stale_count, 0),
        'total_live_count', COALESCE(v_row.total_live_count, 0),
        'last_producer', v_row.last_producer, 'last_run_status', v_row.last_run_status,
        'last_run_skip_reason', v_row.last_run_skip_reason
      ),
      'detail', format(
        'lane %s: %s section(s) never carried a live fact (%s); %s section(s) carry %s stale fact(s) beside %s live (%s) -- last producer %s, %s',
        v_row.lane,
        COALESCE(array_length(v_row.missing_sections, 1), 0), COALESCE(array_to_string(v_row.missing_sections, ', '), 'none'),
        COALESCE(array_length(v_row.stale_sections, 1), 0), COALESCE(v_row.total_stale_count, 0), COALESCE(v_row.total_live_count, 0),
        COALESCE(array_to_string(v_row.stale_sections, ', '), 'none'),
        COALESCE(v_row.last_producer, 'none'), COALESCE(v_row.last_run_status, 'no run')
      )
    );
  END LOOP;

  RETURN v_findings;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_build_brief_db_audit(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_build_brief_db_audit(integer, integer, integer, integer) TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_build_brief_db_audit(integer, integer, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_build_brief_db_audit must not be anon-executable';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_build_brief_db_audit(integer, integer, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lcc_build_brief_db_audit must not be authenticated-executable';
  END IF;
END
$assert$;
