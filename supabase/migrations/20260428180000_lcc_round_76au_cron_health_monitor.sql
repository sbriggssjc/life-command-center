-- ============================================================================
-- Round 76au — cron + HTTP health monitor (LCC Opps)
--
-- This session uncovered THREE separate clusters of silently-failing
-- infrastructure that nobody had noticed:
--
--   76al/an: 4 trigger crashes blocking writes (silenced by JS catch blocks)
--   76ar:    4 nightly HTTP crons hitting wrong URL → 404/405 (silenced
--            by pg_net.http_post returning a row id regardless of outcome)
--   76at:    5 nightly matview crons failing for missing-unique-index
--            (silenced by no one watching cron.job_run_details)
--
-- Meta-bug: LCC has no health surfacing on its own scheduled jobs.
--
-- This migration adds a self-monitor:
--
--   public.lcc_health_alerts (table)  — append-only log of detected
--     failures, with resolved_at for closed alerts
--
--   public.lcc_check_cron_health() (function) — surveys cron failures
--     and pg_net non-2xx responses in last 24h, INSERTs new alerts,
--     auto-resolves alerts whose underlying job has subsequently succeeded
--
--   public.v_cron_health_summary (view) — friendly read of unresolved
--     alerts, used by daily briefing
--
--   pg_cron schedule 'lcc-cron-health-check' — runs every hour at :15
--
-- Daily briefing handler should be enhanced (separate change in api/) to
-- query v_cron_health_summary and include any unresolved alerts in the
-- morning email. For now, alerts are stored and queryable on demand.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_health_alerts (
  alert_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  alert_kind      text NOT NULL,           -- 'cron_failure' | 'http_failure' | future kinds
  source          text NOT NULL,           -- jobname or 'pg_net:<status>'
  severity        text NOT NULL DEFAULT 'warn',  -- 'warn' | 'error' | 'critical'
  summary         text NOT NULL,
  details         jsonb,
  resolved_at     timestamptz,
  resolved_note   text
);

CREATE INDEX IF NOT EXISTS lcc_health_alerts_unresolved_idx
  ON public.lcc_health_alerts (detected_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS lcc_health_alerts_kind_source_idx
  ON public.lcc_health_alerts (alert_kind, source, detected_at DESC);

CREATE OR REPLACE FUNCTION public.lcc_check_cron_health()
RETURNS TABLE(new_alerts integer, total_unresolved integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n_new int := 0;
  m int := 0;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  -- A. Cron failures from cron.job_run_details
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

  -- B. HTTP failures from pg_net._http_response (non-2xx or no response)
  WITH bad_http AS (
    SELECT COALESCE(LEFT(content, 60), '<no body>') AS sample,
           COALESCE(status_code::text, 'no_response') AS code,
           MAX(created) AS last_seen, COUNT(*) AS n
    FROM net._http_response
    WHERE created > v_cutoff
      AND (status_code IS NULL OR status_code < 200 OR status_code >= 400)
    GROUP BY 1, 2
  ),
  inserts2 AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'http_failure', 'pg_net:' || b.code,
           CASE WHEN b.code='no_response' THEN 'error' ELSE 'warn' END,
           b.n || ' HTTP call(s) returned ' || b.code || ' in last 24h: ' || b.sample,
           jsonb_build_object('count', b.n, 'last_seen', b.last_seen, 'sample', b.sample)
    FROM bad_http b
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind='http_failure' AND a.source='pg_net:' || b.code
         AND a.resolved_at IS NULL AND a.detected_at > v_cutoff)
    RETURNING 1
  )
  SELECT COUNT(*) INTO m FROM inserts2;
  n_new := n_new + m;

  -- C. Auto-resolve cron alerts when the same job has subsequently succeeded
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: subsequent run succeeded'
   WHERE a.alert_kind='cron_failure' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM cron.job j JOIN cron.job_run_details d ON d.jobid=j.jobid
                  WHERE j.jobname=a.source AND d.status='succeeded'
                    AND d.start_time > a.detected_at
                    AND d.start_time > now() - interval '1 hour');

  RETURN QUERY
  SELECT n_new, (SELECT COUNT(*)::int FROM public.lcc_health_alerts WHERE resolved_at IS NULL);
END $$;

CREATE OR REPLACE VIEW public.v_cron_health_summary AS
 SELECT alert_id, detected_at, alert_kind, source, severity, summary, details,
        resolved_at, resolved_note, AGE(now(), detected_at) AS age
   FROM public.lcc_health_alerts
  WHERE resolved_at IS NULL
  ORDER BY detected_at DESC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('lcc-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('lcc-cron-health-check', '15 * * * *',
                          'SELECT public.lcc_check_cron_health();');
  END IF;
END $$;
