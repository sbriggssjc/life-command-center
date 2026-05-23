-- ============================================================================
-- 20260523150000_gov_B7_data_health_snapshots.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B7 backslide alarms (gov)
--
-- Mirror of dia B7. See dia file for design notes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_health_snapshots (
  snapshot_id  BIGSERIAL PRIMARY KEY,
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  view_name    TEXT NOT NULL,
  payload      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_health_snap_recent
  ON public.data_health_snapshots (view_name, snapshot_at DESC);

ALTER TABLE public.data_health_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_health_snap_service_role_all ON public.data_health_snapshots;
CREATE POLICY data_health_snap_service_role_all ON public.data_health_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS data_health_snap_authenticated_read ON public.data_health_snapshots;
CREATE POLICY data_health_snap_authenticated_read ON public.data_health_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.data_health_alerts (
  alert_id     BIGSERIAL PRIMARY KEY,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_kind   TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  metric       TEXT NOT NULL,
  prev_value   NUMERIC,
  curr_value   NUMERIC,
  delta        NUMERIC,
  summary      TEXT NOT NULL,
  details      JSONB,
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dha_open
  ON public.data_health_alerts (alert_kind, detected_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.data_health_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_health_alerts_service_role_all ON public.data_health_alerts;
CREATE POLICY data_health_alerts_service_role_all ON public.data_health_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS data_health_alerts_authenticated_read ON public.data_health_alerts;
CREATE POLICY data_health_alerts_authenticated_read ON public.data_health_alerts
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE VIEW public.v_data_health_trend AS
SELECT
  snapshot_at::date AS day,
  view_name,
  payload->>'sales_live'             AS sales_live,
  payload->>'duplicate_groups_live'  AS duplicate_groups_live,
  payload->>'sales_live_missing_price'    AS sales_live_missing_price,
  payload->>'sales_live_missing_property' AS sales_live_missing_property,
  payload->>'sales_duplicate_superseded'  AS sales_duplicate_superseded,
  payload->>'sales_ownership_stub'    AS sales_ownership_stub,
  payload->>'sales_needs_review'      AS sales_needs_review,
  payload->>'redundant_owner_rows'    AS redundant_owner_rows,
  payload->>'pct_property_to_recorded_owner' AS pct_property_to_recorded_owner,
  payload
FROM public.data_health_snapshots
WHERE snapshot_at >= now() - interval '30 days'
ORDER BY snapshot_at DESC, view_name;

CREATE OR REPLACE FUNCTION public.data_health_snapshot_tick()
RETURNS TABLE (
  snapshots_written BIGINT,
  alerts_opened     BIGINT,
  run_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_snaps  BIGINT := 0;
  v_alerts BIGINT := 0;
  v_today  JSONB;
  v_curr   NUMERIC;
  v_prevv  NUMERIC;
BEGIN
  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_sales t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_sales', v_today);
  v_snaps := v_snaps + 1;

  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_ownership t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_ownership', v_today);
  v_snaps := v_snaps + 1;

  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_entities t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_entities', v_today);
  v_snaps := v_snaps + 1;

  -- Rule 1: dup_growth
  SELECT (payload->>'duplicate_groups_live')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 5 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary)
    VALUES ('dup_growth', 'warn', 'duplicate_groups_live', v_curr,
            format('Live duplicate sale groups = %s', v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 2: missing_price_growth (gov baseline is 0 after A3b; >25 is real growth)
  SELECT (payload->>'sales_live_missing_price')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary)
    VALUES ('missing_price_growth', 'info', 'sales_live_missing_price', v_curr,
            format('Live sales missing price = %s', v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 3: entity_growth
  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_entities' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_prevv
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_entities'
    AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_entities')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_curr - v_prevv) > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('entity_growth', 'warn', 'redundant_owner_rows', v_prevv, v_curr, v_curr - v_prevv,
            format('Redundant owner rows grew from %s to %s', v_prevv, v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 4: coverage_regression
  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_ownership' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_prevv
  FROM public.data_health_snapshots
  WHERE view_name='v_data_health_ownership'
    AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_ownership')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_prevv - v_curr) > 2 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('coverage_regression', 'warn', 'pct_property_to_recorded_owner', v_prevv, v_curr, v_curr - v_prevv,
            format('Property->recorded_owner coverage dropped from %s%% to %s%% (-%spp)', v_prevv, v_curr, v_prevv - v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  RETURN QUERY SELECT v_snaps, v_alerts, now();
END;
$$;

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname='lcc-gov-data-health-snapshot';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule(
    'lcc-gov-data-health-snapshot', '30 2 * * *',
    $cron$SELECT public.data_health_snapshot_tick();$cron$
  );
END $$;
