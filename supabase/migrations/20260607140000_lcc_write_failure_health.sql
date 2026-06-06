-- ============================================================================
-- R7 Phase 2.3 — honest write-failure surfacing + spike alert (LCC Opps)
-- ============================================================================
-- Ops Health showed "WRITE FAILURES 32,536 recent" — a 7-DAY count mislabeled
-- "recent". The real signal is a 24h window + the top offending write path, and
-- a self-opening alert when one path floods (the LLC-tick 23514 storm hid in a
-- 7-day total). Read-only/additive views + an alert fn + hourly cron + a bounded
-- retention prune. No write-path change; the alert mirrors lcc_check_disk_health.
-- ============================================================================

-- 24h slice (same error_summary projection as the 7d view).
CREATE OR REPLACE VIEW public.v_ingest_write_failures_24h AS
  SELECT id, occurred_at, domain, method, path, record_pk, http_status, label,
         source_run_id, fields_attempted, caller_file,
         CASE
           WHEN error_detail IS NULL THEN NULL::text
           WHEN jsonb_typeof(error_detail)='object' AND error_detail ? 'message' THEN error_detail->>'message'
           WHEN jsonb_typeof(error_detail)='object' AND error_detail ? 'detail'  THEN error_detail->>'detail'
           ELSE substr(error_detail::text, 1, 200)
         END AS error_summary
    FROM public.ingest_write_failures
   WHERE occurred_at > now() - interval '24 hours'
   ORDER BY occurred_at DESC;

-- Top offenders in the last 24h, by normalized path (record PK collapsed to *)
-- + domain + http_status. Drives the "top offender" line on Ops Health.
CREATE OR REPLACE VIEW public.v_ingest_write_failures_top_24h AS
  SELECT
    domain,
    method,
    http_status,
    regexp_replace(path, '=eq\.[^&]+', '=eq.*', 'g') AS path_norm,
    count(*)::bigint AS failures_24h,
    max(occurred_at) AS last_seen,
    (array_agg(
       CASE
         WHEN error_detail IS NULL THEN NULL::text
         WHEN jsonb_typeof(error_detail)='object' AND error_detail ? 'message' THEN error_detail->>'message'
         WHEN jsonb_typeof(error_detail)='object' AND error_detail ? 'detail'  THEN error_detail->>'detail'
         ELSE substr(error_detail::text, 1, 160)
       END ORDER BY occurred_at DESC))[1] AS sample_error
  FROM public.ingest_write_failures
  WHERE occurred_at > now() - interval '24 hours'
  GROUP BY 1,2,3,4
  ORDER BY failures_24h DESC;

-- Spike alert: open a write_failure_spike alert for each normalized path whose
-- 24h failure count crosses p_threshold; auto-resolve when it drops back under.
-- Also prune rows older than p_retain_days so the table stays bounded
-- (telemetry, not a ledger). Mirrors lcc_check_disk_health's open/resolve shape.
CREATE OR REPLACE FUNCTION public.lcc_check_write_failures(
  p_threshold integer DEFAULT 500,
  p_retain_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_new int := 0;
  v_resolved int := 0;
  v_pruned int := 0;
  v_top jsonb;
  r record;
BEGIN
  -- Open (idempotent per source key) for each path over threshold.
  FOR r IN
    SELECT domain, path_norm, http_status, failures_24h, sample_error
    FROM public.v_ingest_write_failures_top_24h
    WHERE failures_24h >= p_threshold
  LOOP
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'write_failure_spike',
           'write_failures:' || COALESCE(r.domain,'?') || ':' || r.path_norm,
           CASE WHEN r.failures_24h >= p_threshold * 4 THEN 'critical' ELSE 'warn' END,
           r.failures_24h || ' write failures in 24h on ' || COALESCE(r.domain,'?')
             || ' ' || r.path_norm || ' (http ' || COALESCE(r.http_status,0) || '): '
             || COALESCE(left(r.sample_error, 140), 'no detail'),
           jsonb_build_object('domain', r.domain, 'path_norm', r.path_norm,
             'http_status', r.http_status, 'failures_24h', r.failures_24h,
             'sample_error', r.sample_error)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind='write_failure_spike'
        AND a.source = 'write_failures:' || COALESCE(r.domain,'?') || ':' || r.path_norm
        AND a.resolved_at IS NULL);
    v_new := v_new + (CASE WHEN FOUND THEN 1 ELSE 0 END);
  END LOOP;

  -- Auto-resolve open spikes whose path is no longer over threshold in 24h.
  WITH resolved AS (
    UPDATE public.lcc_health_alerts a
       SET resolved_at = now(),
           resolved_note = 'Auto-resolved: 24h write-failure count back under threshold'
     WHERE a.alert_kind='write_failure_spike' AND a.resolved_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.v_ingest_write_failures_top_24h t
         WHERE t.failures_24h >= p_threshold
           AND a.source = 'write_failures:' || COALESCE(t.domain,'?') || ':' || t.path_norm)
    RETURNING 1
  ) SELECT count(*) INTO v_resolved FROM resolved;

  -- Bounded retention.
  WITH pruned AS (
    DELETE FROM public.ingest_write_failures
     WHERE occurred_at < now() - make_interval(days => p_retain_days)
    RETURNING 1
  ) SELECT count(*) INTO v_pruned FROM pruned;

  SELECT jsonb_agg(t) INTO v_top FROM (
    SELECT * FROM public.v_ingest_write_failures_top_24h LIMIT 5
  ) t;

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved,
    'pruned', v_pruned, 'threshold', p_threshold, 'top', v_top);
END;
$fn$;

-- Hourly check (mirrors lcc-disk-health-check at :50; run at :55).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-write-failure-check') THEN
    PERFORM cron.unschedule('lcc-write-failure-check');
  END IF;
  PERFORM cron.schedule('lcc-write-failure-check', '55 * * * *',
    $job$SELECT public.lcc_check_write_failures();$job$);
END
$cron$;

SELECT public.lcc_check_write_failures();
