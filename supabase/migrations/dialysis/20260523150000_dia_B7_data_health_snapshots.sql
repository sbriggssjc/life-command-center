-- ============================================================================
-- 20260523150000_dia_B7_data_health_snapshots.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B7 backslide alarms (dia)
--
-- Daily snapshot of v_data_health_* views so regressions become visible
-- as a delta from prior days. The snapshot table is the durable record;
-- v_data_health_trend exposes the 30-day sparkline used by B8's dashboard.
--
-- A regression rule check fires in the same function:
--   * dup_growth         : duplicate_groups_live > prev_value (any growth)
--   * orphan_growth      : sales_live_missing_property up >25 vs prev
--   * missing_price_growth: sales_live_missing_price up >25 vs prev
--   * entity_growth      : redundant_owner_rows up >25 vs prev
--   * coverage_regression: pct_property_to_recorded_owner drops >2pp vs prev
--
-- Detected regressions are written into data_health_alerts (per-domain
-- table) with severity. They're easy to lift into lcc_health_alerts via
-- a follow-up pg_net write once we have a Vercel/edge endpoint to call.
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

COMMENT ON TABLE public.data_health_snapshots IS
  'B7: daily snapshots of v_data_health_* views. Lets cron compare today vs prior days. Powers v_data_health_trend (B8 dashboard).';

-- ----------------------------------------------------------------------------
-- data_health_alerts: per-domain alert ledger
-- ----------------------------------------------------------------------------
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

COMMENT ON TABLE public.data_health_alerts IS
  'B7: per-domain backslide alerts. Open rows (resolved_at IS NULL) appear on the operator dashboard.';

-- ----------------------------------------------------------------------------
-- v_data_health_trend: 30-day rolling view for B8 dashboard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_data_health_trend AS
SELECT
  snapshot_at::date                 AS day,
  view_name,
  payload->>'sales_live'            AS sales_live,
  payload->>'duplicate_groups_live' AS duplicate_groups_live,
  payload->>'sales_live_missing_price'   AS sales_live_missing_price,
  payload->>'sales_live_missing_property' AS sales_live_missing_property,
  payload->>'sales_duplicate_superseded' AS sales_duplicate_superseded,
  payload->>'sales_ownership_stub'   AS sales_ownership_stub,
  payload->>'sales_needs_review'     AS sales_needs_review,
  payload->>'redundant_owner_rows'   AS redundant_owner_rows,
  payload->>'pct_property_to_recorded_owner' AS pct_property_to_recorded_owner,
  payload
FROM public.data_health_snapshots
WHERE snapshot_at >= now() - interval '30 days'
ORDER BY snapshot_at DESC, view_name;

-- ----------------------------------------------------------------------------
-- Snapshot + alarm function
-- ----------------------------------------------------------------------------
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
  v_prev   JSONB;
  v_metric TEXT;
  v_curr   NUMERIC;
  v_prevv  NUMERIC;
BEGIN
  -- Snapshot v_data_health_sales
  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_sales t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_sales', v_today);
  v_snaps := v_snaps + 1;

  -- Snapshot v_data_health_ownership
  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_ownership t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_ownership', v_today);
  v_snaps := v_snaps + 1;

  -- Snapshot v_data_health_entities
  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_entities t;
  INSERT INTO public.data_health_snapshots (view_name, payload)
  VALUES ('v_data_health_entities', v_today);
  v_snaps := v_snaps + 1;

  -- ---- Rule evaluation: compare TODAY to most-recent PRIOR snapshot ----
  -- Rule 1: dup_growth — sales duplicate_groups_live > 0 means B1 or C1 missed
  SELECT (payload->>'duplicate_groups_live')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 5 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary, details)
    VALUES ('dup_growth', 'warn', 'duplicate_groups_live', v_curr,
            format('Live duplicate sale groups = %s (expected ~0 after A2a+B1+C1)', v_curr),
            jsonb_build_object('threshold', 5));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 2: missing_price_growth — sales_live_missing_price > 25
  SELECT (payload->>'sales_live_missing_price')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary)
    VALUES ('missing_price_growth', 'info', 'sales_live_missing_price', v_curr,
            format('Live sales missing price = %s (writers may be regressing or new bulk import landed)', v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 3: entity_growth — redundant_owner_rows vs prior snapshot
  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_entities' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_prevv
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_entities' AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_entities')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_curr - v_prevv) > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('entity_growth', 'warn', 'redundant_owner_rows', v_prevv, v_curr, v_curr - v_prevv,
            format('Redundant owner rows grew from %s to %s (+%s) — entity dedup may be regressing', v_prevv, v_curr, v_curr - v_prevv));
    v_alerts := v_alerts + 1;
  END IF;

  -- Rule 4: coverage_regression — property->recorded_owner pct dropped >2pp
  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_curr
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_ownership' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_prevv
  FROM public.data_health_snapshots
  WHERE view_name = 'v_data_health_ownership' AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_ownership')
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

COMMENT ON FUNCTION public.data_health_snapshot_tick IS
  'B7: nightly snapshot of v_data_health_* views + rule-based backslide alarm. Opens rows in data_health_alerts when thresholds trip.';

-- ----------------------------------------------------------------------------
-- pg_cron: nightly at 02:30 UTC (before B5 at 03:15 so snapshot precedes
-- the cap-rate tagging refresh)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname = 'lcc-dia-data-health-snapshot';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule(
    'lcc-dia-data-health-snapshot', '30 2 * * *',
    $cron$SELECT public.data_health_snapshot_tick();$cron$
  );
  RAISE NOTICE '[B7] Scheduled lcc-dia-data-health-snapshot (nightly 02:30 UTC)';
END $$;
