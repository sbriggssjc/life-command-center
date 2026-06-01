-- pg_net HTTP-failure attribution: stop reporting failed calls "to unknown".
--
-- lcc_check_cron_health() attributes a failed net._http_response to a URL by
-- joining net.http_request_queue. But pg_net DELETES the queue row as soon as a
-- request is processed, so by the time the hourly health check runs the join
-- always misses and every http_failure alert reads "... to unknown". The URL is
-- unrecoverable after the fact.
--
-- Fix: lcc_cron_post() now records request_id -> endpoint in lcc_cron_post_log at
-- post time (the only moment the endpoint is known). lcc_check_cron_health() falls
-- back to that log when the queue row is gone, so alerts read e.g.
-- "pg_net:404 [/api/npi-lookup]" instead of "[unknown]".

CREATE TABLE IF NOT EXISTS public.lcc_cron_post_log (
  request_id bigint PRIMARY KEY,
  endpoint   text NOT NULL,
  target     text,
  created    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lcc_cron_post_log_created_idx ON public.lcc_cron_post_log (created);

-- lcc_cron_post: log the request_id -> endpoint mapping after enqueue.
CREATE OR REPLACE FUNCTION public.lcc_cron_post(endpoint text, body jsonb DEFAULT '{}'::jsonb, target text DEFAULT 'vercel'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_url text;
  api_key text;
  headers jsonb;
  result_id bigint;
BEGIN
  IF target = 'edge' THEN
    base_url := 'https://xengecqvemvfknjvbvrq.supabase.co/functions/v1';
  ELSE
    SELECT decrypted_secret INTO base_url
      FROM vault.decrypted_secrets
     WHERE name = 'lcc_railway_url' LIMIT 1;
    IF base_url IS NULL THEN
      base_url := 'https://tranquil-delight-production-633f.up.railway.app';
    END IF;
    base_url := rtrim(base_url, '/');
  END IF;

  SELECT decrypted_secret INTO api_key
    FROM vault.decrypted_secrets
   WHERE name = 'lcc_api_key' LIMIT 1;

  IF target = 'edge' THEN
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    );
  ELSE
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-LCC-Key', api_key
    );
  END IF;

  SELECT net.http_post(
    url := base_url || endpoint,
    headers := headers,
    body := body,
    timeout_milliseconds := 60000
  ) INTO result_id;

  -- Record attribution so a later failed response can be traced back to its
  -- endpoint even after pg_net prunes net.http_request_queue. Never let a
  -- logging hiccup break the actual outbound call.
  BEGIN
    INSERT INTO public.lcc_cron_post_log (request_id, endpoint, target)
    VALUES (result_id, endpoint, target)
    ON CONFLICT (request_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN result_id;
END $function$;

-- lcc_check_cron_health: fall back to lcc_cron_post_log for URL attribution.
CREATE OR REPLACE FUNCTION public.lcc_check_cron_health()
 RETURNS TABLE(new_alerts integer, total_unresolved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  n_new int := 0;
  m int := 0;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  WITH failed AS (
    -- only jobs whose LATEST run in the window is failed (currently broken)
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
           jsonb_build_object('return_message', LEFT(COALESCE(f.return_message,''), 500),
                              'start_time', f.start_time)
    FROM failed f
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='cron_failure' AND a.source=f.jobname
         AND a.resolved_at IS NULL AND a.detected_at > v_cutoff)
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
    SELECT b.code, b.sample, b.created,
           COALESCE(q.url, l.endpoint) AS url, q.method,
           CASE
             WHEN q.url IS NOT NULL THEN COALESCE(substring(q.url FROM '^https?://([^/]+)'), 'unknown')
             WHEN l.endpoint IS NOT NULL THEN l.endpoint
             ELSE 'unknown'
           END AS host
    FROM bad_http b
    LEFT JOIN net.http_request_queue q ON q.id = b.id
    LEFT JOIN public.lcc_cron_post_log l ON l.request_id = b.id
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

-- Keep the attribution log bounded (a bit longer than pg_net's 24h response
-- retention so a failed response can always find its endpoint).
SELECT cron.schedule(
  'lcc-cron-post-log-cleanup',
  '47 * * * *',
  $$DELETE FROM public.lcc_cron_post_log WHERE created < now() - interval '48 hours'$$
);
