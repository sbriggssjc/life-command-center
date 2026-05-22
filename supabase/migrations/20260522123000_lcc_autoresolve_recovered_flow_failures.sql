-- ============================================================================
-- 2026-05-22 — Auto-resolver for recovered Power Automate flow failures
--
-- Migration 20260514120000 (flow-failure dead-letter plane) created
-- lcc_record_flow_failure(), which opens a de-duplicated lcc_health_alerts
-- row (alert_kind='flow_failure') per flow per 24h. Its lcc_resolve_flow_failure()
-- helper only closes the forensic flow_run_failures row — it does NOT close the
-- health alert, and the comment explicitly left "a future auto-resolve cron"
-- unbuilt. Consequence: once a flow recovered (e.g. SF Object Sync after its
-- 5/17 rework) its flow_failure alert stayed open forever and lcc_notify_health_alerts_teams
-- re-paged it every 24h.
--
-- This builds that missing auto-resolver: close a flow_failure alert (and its
-- forensic rows) once the flow has had no new failure for p_quiet_hours. If the
-- flow fails again, lcc_record_flow_failure opens a fresh alert (it dedups only
-- on UNRESOLVED rows), so genuinely-broken flows re-surface — they don't get
-- silenced. Default quiet window 18h: shorter than the 24h alert-dedup window so
-- frequently-run flows that recover clear within a day, long enough that a
-- daily-failing flow stays continuously alerted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_autoresolve_recovered_flow_failures(p_quiet_hours int DEFAULT 18)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved int;
BEGIN
  WITH recovered AS (
    UPDATE public.lcc_health_alerts a
       SET resolved_at = now(),
           resolved_note = format('Auto-resolved: no new failure for flow "%s" in %sh (recovered)', a.source, p_quiet_hours)
     WHERE a.alert_kind = 'flow_failure'
       AND a.resolved_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.flow_run_failures f
          WHERE f.flow_name = a.source
            AND f.detected_at > now() - make_interval(hours => p_quiet_hours)
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM recovered;

  UPDATE public.flow_run_failures f
     SET resolved_at = now(),
         resolved_note = format('Auto-resolved: flow quiet %sh', p_quiet_hours)
   WHERE f.resolved_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.flow_run_failures f2
        WHERE f2.flow_name = f.flow_name
          AND f2.detected_at > now() - make_interval(hours => p_quiet_hours)
     );

  RETURN v_resolved;
END
$function$;

COMMENT ON FUNCTION public.lcc_autoresolve_recovered_flow_failures(int) IS
  'Closes flow_failure health alerts + flow_run_failures rows for flows with no new failure in p_quiet_hours. The auto-resolve cron deferred by migration 20260514120000.';

SELECT cron.schedule('lcc-autoresolve-flow-failures', '35 * * * *',
  $$SELECT public.lcc_autoresolve_recovered_flow_failures(18)$$);
