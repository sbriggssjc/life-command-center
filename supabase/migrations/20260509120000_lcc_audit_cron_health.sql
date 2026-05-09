-- ============================================================================
-- lcc_audit_cron_health()
--
-- Returns one row per active pg_cron job on LCC Opps that is either
--   (a) "stale"   — last successful run was longer than 1.5x the job's
--                   observed median run-interval (with a 1h floor). Only
--                   evaluated when we have >=2 successes in 30d to derive
--                   a median; brand-new jobs are excluded until enough
--                   history accumulates.
--   (b) "failing" — at least one non-success run in the last 24h, OR
--   (c) "no_runs_30d" — no run history at all in the last 30 days.
--
-- Empty result = all active pg_cron jobs are healthy.
--
-- Background: #561 caught a near-miss where the
-- lcc-availability-promotion-sweep cron looked silent (no rows in
-- listing_verification_history) but was actually firing every 6h. The
-- canonical "is this cron firing?" source is cron.job_run_details, not
-- the job's output table. This function generalizes that lesson — every
-- active pg_cron job is heart-beat-checked from a single source.
--
-- Why median-interval-based threshold (not a flat 25h):
-- LCC has cron jobs at every cadence from every-10-minutes
-- (lcc-geocode-backfill) to weekly (weekly-intelligence-report). A flat
-- threshold either spams on weekly jobs (25h is short for them) or
-- misses outages on high-frequency jobs (25h is forever for a 10min
-- job). Using 1.5x the observed median interval means each job has its
-- own threshold derived from its actual schedule.
--
-- Why we don't fall back to a default interval when median is unknown:
-- A new job with only one historical run could have any cadence
-- (every-10-minutes through monthly). Picking any default risks either
-- alarm-storming (if default is too short) or hiding outages (if too
-- long). Better to wait for a second run to derive a real median; in
-- the meantime, the `failing` path still catches jobs that error out.
--
-- The companion workflow .github/workflows/cron-heartbeat-check.yml
-- calls this RPC daily and opens a tracking issue (label
-- cron-heartbeat-stale) when any rows come back.
-- ============================================================================

-- DROP first because changing OUT parameters changes the return type,
-- which CREATE OR REPLACE refuses. Safe — no rows depend on this function.
DROP FUNCTION IF EXISTS public.lcc_audit_cron_health();

CREATE FUNCTION public.lcc_audit_cron_health()
RETURNS TABLE (
  jobid                    bigint,
  jobname                  text,
  schedule                 text,
  active                   boolean,
  last_success_at          timestamptz,
  hours_since_last_success numeric,
  expected_interval_hours  numeric,
  stale_threshold_hours    numeric,
  recent_failures          bigint,
  problem                  text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, cron, pg_temp
AS $$
  WITH ordered_runs AS (
    SELECT jrd.jobid,
           jrd.start_time,
           lag(jrd.start_time) OVER (PARTITION BY jrd.jobid ORDER BY jrd.start_time) AS prev_start
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '30 days'
      AND jrd.status = 'succeeded'
  ),
  per_job AS (
    SELECT o.jobid,
           percentile_cont(0.5) WITHIN GROUP (
             ORDER BY extract(epoch FROM (o.start_time - o.prev_start))
           ) AS median_seconds
    FROM ordered_runs o
    WHERE o.prev_start IS NOT NULL  -- need a pair to compute an interval
    GROUP BY o.jobid
  ),
  last_success AS (
    SELECT jrd.jobid, max(jrd.start_time) AS last_success_at
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '30 days'
      AND jrd.status = 'succeeded'
    GROUP BY jrd.jobid
  ),
  recent_fail AS (
    SELECT jrd.jobid, count(*) AS n
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '24 hours'
      AND jrd.status <> 'succeeded'
    GROUP BY jrd.jobid
  ),
  joined AS (
    SELECT j.jobid,
           j.jobname,
           j.schedule,
           j.active,
           ls.last_success_at,
           pj.median_seconds,
           coalesce(rf.n, 0) AS recent_failures
    FROM cron.job j
    LEFT JOIN per_job      pj ON pj.jobid = j.jobid
    LEFT JOIN last_success ls ON ls.jobid = j.jobid
    LEFT JOIN recent_fail  rf ON rf.jobid = j.jobid
    WHERE j.active = true
  ),
  evaluated AS (
    SELECT jc.*,
           -- Stale threshold: 1.5x median interval, floor 1 hour.
           -- NULL when median can't be computed (job has <2 runs in 30d) —
           -- in that case staleness can't be evaluated.
           CASE WHEN jc.median_seconds IS NULL THEN NULL
                ELSE GREATEST(1.5 * jc.median_seconds, 3600)
           END AS stale_threshold_seconds
    FROM joined jc
  )
  SELECT e.jobid,
         e.jobname,
         e.schedule,
         e.active,
         e.last_success_at,
         CASE WHEN e.last_success_at IS NULL THEN NULL
              ELSE round((extract(epoch FROM (now() - e.last_success_at)) / 3600.0)::numeric, 2)
         END AS hours_since_last_success,
         CASE WHEN e.median_seconds IS NULL THEN NULL
              ELSE round((e.median_seconds / 3600.0)::numeric, 2)
         END AS expected_interval_hours,
         CASE WHEN e.stale_threshold_seconds IS NULL THEN NULL
              ELSE round((e.stale_threshold_seconds / 3600.0)::numeric, 2)
         END AS stale_threshold_hours,
         e.recent_failures,
         CASE
           WHEN e.last_success_at IS NULL                                          THEN 'no_runs_30d'
           WHEN e.recent_failures > 0                                              THEN 'failing'
           WHEN e.stale_threshold_seconds IS NOT NULL
                AND e.last_success_at < now() - make_interval(secs => e.stale_threshold_seconds::int)
                                                                                   THEN 'stale'
         END AS problem
  FROM evaluated e
  WHERE e.last_success_at IS NULL
     OR e.recent_failures > 0
     OR (
          e.stale_threshold_seconds IS NOT NULL
          AND e.last_success_at < now() - make_interval(secs => e.stale_threshold_seconds::int)
        )
  ORDER BY e.jobname;
$$;

REVOKE EXECUTE ON FUNCTION public.lcc_audit_cron_health() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.lcc_audit_cron_health() TO service_role;

COMMENT ON FUNCTION public.lcc_audit_cron_health() IS
  'Heart-beat audit for all active pg_cron jobs. Returns rows for jobs that are stale (>1.5x observed median interval since last success, floor 1h; only evaluated when 2+ runs in 30d), failing (any non-success in last 24h), or have no run history in 30d. Called daily by .github/workflows/cron-heartbeat-check.yml. Restricted to service_role.';
