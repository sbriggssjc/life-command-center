-- ============================================================================
-- Round 76bv — improve lcc_check_cron_health to capture originating URL
--
-- Current behavior: cron-health-check buckets pg_net failures by status
-- code only and stores `sample` (first 60 chars of body). When operators
-- inspect the alert later, both pg_net._http_response and
-- pg_net.http_request_queue have auto-pruned (typically within an hour
-- or two) — leaving no way to trace which endpoint failed.
--
-- Today's audit found 4 open alerts (405/404/400/no_response). The 405
-- was traceable via cron schedule + endpoint URL inspection
-- (daily-briefing edge fn rejects POST). The 404/400/no_response from
-- 06:31-06:34 were lost to pruning.
--
-- Fix: lcc_check_cron_health now joins to http_request_queue at health-
-- check time and stores the originating URL + method in details JSON.
-- Alerts fired in the next 24h will carry actionable trace data even if
-- pg_net rotates the response log before a human inspects.
--
-- Bonus: also bucket alerts by URL host (so different endpoints with the
-- same status code don't get collapsed into one alert).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_check_cron_health()
RETURNS TABLE(new_alerts integer, total_unresolved integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  n_new int := 0;
  m int := 0;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  -- Cron job failures (unchanged from prior version)
  WITH failed AS (
    SELECT DISTINCT ON (j.jobname) j.jobname, d.return_message, d.start_time
    FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid
    WHERE d.start_time > v_cutoff AND d.status = 'failed'
    ORDER BY j.jobname, d.start_time DESC
  ),
  inserts AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'cron_failure', f.jobname, 'error',
           'Scheduled job ' || f.jobname || ' failed at ' || f.start_time::text,
           jsonb_build_object('return_message', LEFT(COALESCE(f.return_message,''), 500),
                              'start_time', f.start_time)
    FROM failed f
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='cron_failure' AND a.source=f.jobname
         AND a.resolved_at IS NULL AND a.detected_at > v_cutoff)
    RETURNING 1
  )
  SELECT COUNT(*) INTO n_new FROM inserts;

  -- HTTP failures, now bucketed by status_code + URL host with full URL
  -- list captured. We try-join the queue but tolerate prunes (LEFT JOIN).
  WITH bad_http AS (
    SELECT
      r.id,
      COALESCE(r.status_code::text, 'no_response') AS code,
      COALESCE(LEFT(r.content, 60), '<no body>')   AS sample,
      r.created
    FROM net._http_response r
    WHERE r.created > v_cutoff
      AND (r.status_code IS NULL OR r.status_code < 200 OR r.status_code >= 400)
  ),
  bad_http_with_url AS (
    SELECT b.code, b.sample, b.created,
           q.url, q.method,
           CASE WHEN q.url IS NULL THEN 'unknown'
                ELSE COALESCE(substring(q.url FROM '^https?://([^/]+)'), 'unknown')
           END AS host
    FROM bad_http b
    LEFT JOIN net.http_request_queue q ON q.id = b.id
  ),
  bad_http_grouped AS (
    SELECT code, host,
           MAX(sample) AS sample,
           MAX(created) AS last_seen,
           MAX(url) AS url,
           MAX(method) AS method,
           COUNT(*) AS n
    FROM bad_http_with_url
    GROUP BY code, host
  ),
  inserts2 AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'http_failure',
           'pg_net:' || b.code || CASE WHEN b.host <> 'unknown' THEN ' [' || b.host || ']' ELSE '' END,
           CASE WHEN b.code='no_response' THEN 'error' ELSE 'warn' END,
           b.n || ' HTTP call(s) returned ' || b.code
             || COALESCE(' to ' || b.host, '')
             || ' in last 24h: ' || b.sample,
           jsonb_build_object(
             'count',     b.n,
             'last_seen', b.last_seen,
             'sample',    b.sample,
             'url',       b.url,
             'method',    b.method,
             'host',      b.host
           )
    FROM bad_http_grouped b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='http_failure'
         AND a.source = 'pg_net:' || b.code
                       || CASE WHEN b.host <> 'unknown' THEN ' [' || b.host || ']' ELSE '' END
         AND a.resolved_at IS NULL
         AND a.detected_at > v_cutoff
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO m FROM inserts2;
  n_new := n_new + m;

  -- Auto-resolve cron_failure alerts where job has since succeeded
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: subsequent run succeeded'
   WHERE a.alert_kind='cron_failure' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM cron.job j JOIN cron.job_run_details d ON d.jobid=j.jobid
                  WHERE j.jobname=a.source AND d.status='succeeded'
                    AND d.start_time > a.detected_at
                    AND d.start_time > now() - interval '1 hour');

  RETURN QUERY SELECT n_new, (SELECT COUNT(*)::int FROM public.lcc_health_alerts WHERE resolved_at IS NULL);
END $function$;
