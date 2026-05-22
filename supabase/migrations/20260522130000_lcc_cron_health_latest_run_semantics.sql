-- ============================================================================
-- 2026-05-22 — Cron-health "latest run" semantics (LCC Opps)
--
-- The 6-worker pool intermittently can't launch a cron bgworker -> "job
-- startup timeout". These failures are transient and self-recovering (the
-- idempotent job runs again next tick). But both cron-health checks flagged
-- "any non-success in the last 24h", so a single transient blip kept BOTH the
-- Teams cron_failure alert AND the daily GitHub "Cron Heartbeat Check" workflow
-- red even after the job had recovered.
--
-- This refines both checks to flag a job only when its LATEST run in the window
-- is failed (i.e. it is CURRENTLY broken). Genuinely-stuck jobs still surface;
-- transient-but-recovered ones no longer page.
--
-- NOTE: this reduces the false-alarm noise; it does NOT eliminate the timeouts
-- themselves. The durable fix is to lower cron.max_running_jobs to <= the
-- worker pool (e.g. 4) in the Supabase Dashboard custom Postgres config and
-- restart, OR bump compute for more max_worker_processes.
-- ============================================================================

-- 1. GitHub "Cron Heartbeat Check" RPC ----------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_audit_cron_health()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, active boolean, last_success_at timestamptz, hours_since_last_success numeric, expected_interval_hours numeric, stale_threshold_hours numeric, recent_failures bigint, problem text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public','cron','pg_temp'
AS $function$
  WITH ordered_runs AS (
    SELECT jrd.jobid, jrd.start_time,
           lag(jrd.start_time) OVER (PARTITION BY jrd.jobid ORDER BY jrd.start_time) AS prev_start
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '30 days' AND jrd.status = 'succeeded'
  ),
  per_job AS (
    SELECT o.jobid, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (o.start_time - o.prev_start))) AS median_seconds
    FROM ordered_runs o WHERE o.prev_start IS NOT NULL GROUP BY o.jobid
  ),
  last_success AS (
    SELECT jrd.jobid, max(jrd.start_time) AS last_success_at
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '30 days' AND jrd.status = 'succeeded'
    GROUP BY jrd.jobid
  ),
  recent_fail AS (
    SELECT jrd.jobid, count(*) AS n
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '24 hours' AND jrd.status <> 'succeeded'
    GROUP BY jrd.jobid
  ),
  last_run AS (
    SELECT DISTINCT ON (jrd.jobid) jrd.jobid, jrd.status AS last_status
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '24 hours'
    ORDER BY jrd.jobid, jrd.start_time DESC
  ),
  joined AS (
    SELECT j.jobid, j.jobname, j.schedule, j.active,
           ls.last_success_at, pj.median_seconds, coalesce(rf.n, 0) AS recent_failures, lr.last_status
    FROM cron.job j
    LEFT JOIN per_job      pj ON pj.jobid = j.jobid
    LEFT JOIN last_success ls ON ls.jobid = j.jobid
    LEFT JOIN recent_fail  rf ON rf.jobid = j.jobid
    LEFT JOIN last_run     lr ON lr.jobid = j.jobid
    WHERE j.active = true
  ),
  evaluated AS (
    SELECT jc.*, CASE WHEN jc.median_seconds IS NULL THEN NULL ELSE GREATEST(1.5 * jc.median_seconds, 3600) END AS stale_threshold_seconds
    FROM joined jc
  )
  SELECT e.jobid, e.jobname, e.schedule, e.active, e.last_success_at,
         CASE WHEN e.last_success_at IS NULL THEN NULL ELSE round((extract(epoch FROM (now() - e.last_success_at)) / 3600.0)::numeric, 2) END,
         CASE WHEN e.median_seconds IS NULL THEN NULL ELSE round((e.median_seconds / 3600.0)::numeric, 2) END,
         CASE WHEN e.stale_threshold_seconds IS NULL THEN NULL ELSE round((e.stale_threshold_seconds / 3600.0)::numeric, 2) END,
         e.recent_failures,
         CASE
           WHEN e.last_success_at IS NULL                                          THEN 'no_runs_30d'
           WHEN e.last_status IS NOT NULL AND e.last_status <> 'succeeded'         THEN 'failing'
           WHEN e.stale_threshold_seconds IS NOT NULL
                AND e.last_success_at < now() - make_interval(secs => e.stale_threshold_seconds::int) THEN 'stale'
         END
  FROM evaluated e
  WHERE e.last_success_at IS NULL
     OR (e.last_status IS NOT NULL AND e.last_status <> 'succeeded')
     OR (e.stale_threshold_seconds IS NOT NULL
         AND e.last_success_at < now() - make_interval(secs => e.stale_threshold_seconds::int))
  ORDER BY e.jobname;
$function$;

-- 2. Teams cron_failure alert generator ---------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_check_cron_health()
 RETURNS TABLE(new_alerts integer, total_unresolved integer)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  n_new int := 0;
  m int := 0;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  WITH failed AS (
    SELECT j.jobname, lr.return_message, lr.start_time
    FROM (
      SELECT DISTINCT ON (d.jobid) d.jobid, d.status, d.return_message, d.start_time
      FROM cron.job_run_details d
      WHERE d.start_time > v_cutoff
      ORDER BY d.jobid, d.start_time DESC
    ) lr
    JOIN cron.job j ON j.jobid = lr.jobid
    WHERE lr.status = 'failed'
  ),
  inserts AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'cron_failure', f.jobname, 'error',
           'Scheduled job ' || f.jobname || ' failed at ' || f.start_time::text,
           jsonb_build_object('return_message', LEFT(COALESCE(f.return_message,''), 500), 'start_time', f.start_time)
    FROM failed f
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='cron_failure' AND a.source=f.jobname AND a.resolved_at IS NULL AND a.detected_at > v_cutoff)
    RETURNING 1
  )
  SELECT COUNT(*) INTO n_new FROM inserts;

  WITH bad_http AS (
    SELECT r.id, COALESCE(r.status_code::text, 'no_response') AS code,
           COALESCE(LEFT(r.content, 60), '<no body>') AS sample, r.created
    FROM net._http_response r
    WHERE r.created > v_cutoff AND (r.status_code IS NULL OR r.status_code < 200 OR r.status_code >= 400)
  ),
  bad_http_with_url AS (
    SELECT b.code, b.sample, b.created, q.url, q.method,
           CASE WHEN q.url IS NULL THEN 'unknown' ELSE COALESCE(substring(q.url FROM '^https?://([^/]+)'), 'unknown') END AS host
    FROM bad_http b LEFT JOIN net.http_request_queue q ON q.id = b.id
  ),
  bad_http_grouped AS (
    SELECT code, host, MAX(sample) AS sample, MAX(created) AS last_seen, MAX(url) AS url, MAX(method) AS method, COUNT(*) AS n
    FROM bad_http_with_url GROUP BY code, host
  ),
  inserts2 AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'http_failure',
           'pg_net:' || b.code || CASE WHEN b.host <> 'unknown' THEN ' [' || b.host || ']' ELSE '' END,
           CASE WHEN b.code='no_response' THEN 'error' ELSE 'warn' END,
           b.n || ' HTTP call(s) returned ' || b.code || COALESCE(' to ' || b.host, '') || ' in last 24h: ' || b.sample,
           jsonb_build_object('count', b.n, 'last_seen', b.last_seen, 'sample', b.sample, 'url', b.url, 'method', b.method, 'host', b.host)
    FROM bad_http_grouped b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='http_failure'
         AND a.source = 'pg_net:' || b.code || CASE WHEN b.host <> 'unknown' THEN ' [' || b.host || ']' ELSE '' END
         AND a.resolved_at IS NULL AND a.detected_at > v_cutoff
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO m FROM inserts2;
  n_new := n_new + m;

  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(), resolved_note = 'Auto-resolved: subsequent run succeeded'
   WHERE a.alert_kind='cron_failure' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM cron.job j JOIN cron.job_run_details d ON d.jobid=j.jobid
                  WHERE j.jobname=a.source AND d.status='succeeded'
                    AND d.start_time > a.detected_at AND d.start_time > now() - interval '1 hour');

  RETURN QUERY SELECT n_new, (SELECT COUNT(*)::int FROM public.lcc_health_alerts WHERE resolved_at IS NULL);
END $function$;