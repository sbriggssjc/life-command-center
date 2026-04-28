-- ============================================================================
-- Round 76au — cron health monitor (dialysis project)
--
-- Companion migration to LCC Opps Round 76au — adds the same self-monitor
-- pattern to the dialysis Supabase project. Dia's crons are all internal
-- SQL refreshes (no HTTP), so this version skips the pg_net._http_response
-- check.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_health_alerts (
  alert_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  alert_kind      text NOT NULL,
  source          text NOT NULL,
  severity        text NOT NULL DEFAULT 'warn',
  summary         text NOT NULL,
  details         jsonb,
  resolved_at     timestamptz,
  resolved_note   text
);

CREATE INDEX IF NOT EXISTS lcc_health_alerts_unresolved_idx
  ON public.lcc_health_alerts (detected_at DESC) WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.lcc_check_cron_health()
RETURNS TABLE(new_alerts integer, total_unresolved integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n_new int := 0;
  v_cutoff timestamptz := now() - interval '24 hours';
BEGIN
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
   FROM public.lcc_health_alerts WHERE resolved_at IS NULL
  ORDER BY detected_at DESC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('dia-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('dia-cron-health-check', '15 * * * *',
                          'SELECT public.lcc_check_cron_health();');
  END IF;
END $$;
