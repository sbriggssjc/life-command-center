-- Prompt 12 (2026-08-01) - LCC Health surface.
--
-- Single normalized health-event ledger plus read views over the existing
-- health planes. Additive and idempotent. Apply on LCC Opps.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_health_events (
  event_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL,
  check_name   text NOT NULL,
  status       text NOT NULL CHECK (status IN ('green', 'amber', 'red', 'unknown')),
  count        integer NOT NULL DEFAULT 1,
  last_error   text,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  ts           timestamptz NOT NULL DEFAULT now(),
  external_url text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.lcc_health_events IS
  'Prompt 12: normalized health events for LCC Health. Sources include power_automate, db_checks, deploy, boot_check, and connector_probe.';

CREATE INDEX IF NOT EXISTS lcc_health_events_latest_idx
  ON public.lcc_health_events (source, check_name, ts DESC);

CREATE INDEX IF NOT EXISTS lcc_health_events_status_idx
  ON public.lcc_health_events (status, ts DESC)
  WHERE status IN ('amber', 'red');

CREATE OR REPLACE FUNCTION public.lcc_record_health_event(
  p_source       text,
  p_check_name   text,
  p_status       text,
  p_count        integer DEFAULT 1,
  p_last_error   text DEFAULT NULL,
  p_external_url text DEFAULT NULL,
  p_details      jsonb DEFAULT '{}'::jsonb,
  p_ts           timestamptz DEFAULT now()
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_event_id bigint;
  v_status text := lower(coalesce(nullif(p_status, ''), 'unknown'));
  v_first_seen timestamptz;
BEGIN
  IF v_status NOT IN ('green', 'amber', 'red', 'unknown') THEN
    v_status := 'unknown';
  END IF;

  SELECT min(e.first_seen)
    INTO v_first_seen
    FROM public.lcc_health_events e
   WHERE e.source = p_source
     AND e.check_name = p_check_name
     AND e.status = v_status
     AND e.ts > p_ts - interval '7 days';

  INSERT INTO public.lcc_health_events (
    source, check_name, status, count, last_error, first_seen, ts,
    external_url, details
  ) VALUES (
    p_source,
    p_check_name,
    v_status,
    greatest(coalesce(p_count, 1), 0),
    left(coalesce(p_last_error, ''), 2000),
    coalesce(v_first_seen, p_ts),
    p_ts,
    p_external_url,
    coalesce(p_details, '{}'::jsonb)
  )
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.lcc_record_health_event(text,text,text,integer,text,text,jsonb,timestamptz)
  TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_health_events_current AS
SELECT DISTINCT ON (source, check_name)
       event_id, source, check_name, status, count, last_error,
       first_seen, ts, external_url, details
  FROM public.lcc_health_events
 ORDER BY source, check_name, ts DESC, event_id DESC;

GRANT SELECT ON public.v_lcc_health_events_current TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_health_surface AS
WITH pa AS (
  SELECT 'power_automate'::text AS subsystem,
         flow_name AS check_name,
         CASE
           WHEN count(*) FILTER (WHERE resolved_at IS NULL) > 0 THEN 'red'
           WHEN count(*) >= 3 THEN 'amber'
           ELSE 'green'
         END AS status,
         count(*)::int AS count,
         min(detected_at) AS first_seen,
         max(detected_at) AS ts,
         left((array_agg(error_detail ORDER BY detected_at DESC))[1], 500) AS last_error,
         null::text AS external_url,
         jsonb_build_object(
           'open_failures', count(*) FILTER (WHERE resolved_at IS NULL),
           'latest_action', (array_agg(failed_action ORDER BY detected_at DESC))[1],
           'latest_run_id', (array_agg(flow_run_id ORDER BY detected_at DESC))[1]
         ) AS details
    FROM public.flow_run_failures
   WHERE detected_at >= now() - interval '7 days'
   GROUP BY flow_name
),
db_drift AS (
  SELECT 'db_checks'::text AS subsystem,
         'field_source_priority_invalid_columns'::text AS check_name,
         CASE WHEN count(*) > 0 THEN 'red' ELSE 'green' END AS status,
         count(*)::int AS count,
         now() AS first_seen,
         now() AS ts,
         CASE WHEN count(*) > 0
              THEN count(*)::text || ' field_source_priority rule(s) point at missing columns'
              ELSE NULL END AS last_error,
         NULL::text AS external_url,
         jsonb_build_object(
           'sample', coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.target_table, x.field_name)
                              FILTER (WHERE x.target_table IS NOT NULL), '[]'::jsonb)
         ) AS details
    FROM (
      SELECT target_table, field_name, source, nearby_columns
        FROM public.v_field_source_priority_invalid_columns
       LIMIT 25
    ) x
),
connectors AS (
  SELECT 'connectors'::text AS subsystem,
         connector_type AS check_name,
         CASE
           WHEN bool_or(status IN ('error', 'disconnected')) THEN 'red'
           WHEN bool_or(status IN ('degraded', 'pending_setup')) THEN 'amber'
           ELSE 'green'
         END AS status,
         count(*)::int AS count,
         min(coalesce(last_sync_at, updated_at, created_at, now())) AS first_seen,
         max(coalesce(updated_at, last_sync_at, created_at, now())) AS ts,
         left((array_agg(last_error ORDER BY updated_at DESC NULLS LAST))[1], 500) AS last_error,
         NULL::text AS external_url,
         jsonb_build_object(
           'accounts', jsonb_agg(jsonb_build_object(
             'id', id,
             'display_name', display_name,
             'status', status,
             'last_sync_at', last_sync_at,
             'last_error', last_error
           ) ORDER BY connector_type, display_name)
         ) AS details
    FROM public.connector_accounts
   GROUP BY connector_type
),
events AS (
  SELECT source AS subsystem, check_name, status, count, first_seen, ts,
         nullif(last_error, '') AS last_error, external_url, details
    FROM public.v_lcc_health_events_current
)
SELECT * FROM pa
UNION ALL SELECT * FROM db_drift
UNION ALL SELECT * FROM connectors
UNION ALL SELECT * FROM events;

GRANT SELECT ON public.v_lcc_health_surface TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lcc_health_threshold_tick(
  p_flow_failure_threshold integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_new int := 0;
  v_resolved int := 0;
BEGIN
  WITH bad AS (
    SELECT subsystem, check_name, status, count, last_error, first_seen, ts, details
      FROM public.v_lcc_health_surface
     WHERE status = 'red'
        OR (subsystem = 'power_automate' AND count >= p_flow_failure_threshold)
  ),
  ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'lcc_health_red',
           b.subsystem || ':' || b.check_name,
           CASE WHEN b.status = 'red' THEN 'error' ELSE 'warn' END,
           b.subsystem || ' check "' || b.check_name || '" is ' || upper(b.status)
             || ' (' || b.count || ' event(s)).'
             || coalesce(' Last error: ' || left(b.last_error, 240), ''),
           jsonb_build_object(
             'subsystem', b.subsystem,
             'check', b.check_name,
             'status', b.status,
             'count', b.count,
             'first_seen', b.first_seen,
             'ts', b.ts,
             'details', b.details
           )
      FROM bad b
     WHERE NOT EXISTS (
       SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind = 'lcc_health_red'
          AND a.source = b.subsystem || ':' || b.check_name
          AND a.resolved_at IS NULL
     )
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: LCC Health check no longer red'
   WHERE a.alert_kind = 'lcc_health_red'
     AND a.resolved_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.v_lcc_health_surface h
        WHERE a.source = h.subsystem || ':' || h.check_name
          AND (h.status = 'red'
               OR (h.subsystem = 'power_automate' AND h.count >= p_flow_failure_threshold))
     );
  GET DIAGNOSTICS v_resolved = row_count;

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved);
END;
$fn$;

REVOKE ALL ON FUNCTION public.lcc_health_threshold_tick(integer) FROM PUBLIC;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-health-threshold-tick')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-health-threshold-tick');
    PERFORM cron.schedule(
      'lcc-health-threshold-tick',
      '20 * * * *',
      'SELECT public.lcc_health_threshold_tick();'
    );
  END IF;
END $cron$;

COMMIT;
