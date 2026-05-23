-- ============================================================================
-- 20260524132000_gov_B7_completeness_snapshot.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B7 extension (gov)
-- Mirror of dia. Adds v_sales_completeness_summary snapshot + completeness_regression alert.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.data_health_snapshot_tick()
RETURNS TABLE (snapshots_written BIGINT, alerts_opened BIGINT, run_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE
  v_snaps  BIGINT := 0;
  v_alerts BIGINT := 0;
  v_today  JSONB;
  v_curr   NUMERIC;
  v_prevv  NUMERIC;
BEGIN
  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_sales t;
  INSERT INTO public.data_health_snapshots (view_name, payload) VALUES ('v_data_health_sales', v_today);
  v_snaps := v_snaps + 1;

  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_ownership t;
  INSERT INTO public.data_health_snapshots (view_name, payload) VALUES ('v_data_health_ownership', v_today);
  v_snaps := v_snaps + 1;

  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_data_health_entities t;
  INSERT INTO public.data_health_snapshots (view_name, payload) VALUES ('v_data_health_entities', v_today);
  v_snaps := v_snaps + 1;

  SELECT to_jsonb(row_to_json(t.*))::jsonb INTO v_today FROM v_sales_completeness_summary t;
  INSERT INTO public.data_health_snapshots (view_name, payload) VALUES ('v_sales_completeness_summary', v_today);
  v_snaps := v_snaps + 1;

  SELECT (payload->>'duplicate_groups_live')::numeric INTO v_curr
  FROM public.data_health_snapshots WHERE view_name='v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 5 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary)
    VALUES ('dup_growth', 'warn', 'duplicate_groups_live', v_curr,
            format('Live duplicate sale groups = %s', v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  SELECT (payload->>'sales_live_missing_price')::numeric INTO v_curr
  FROM public.data_health_snapshots WHERE view_name='v_data_health_sales' ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, curr_value, summary)
    VALUES ('missing_price_growth', 'info', 'sales_live_missing_price', v_curr,
            format('Live sales missing price = %s', v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_curr
  FROM public.data_health_snapshots WHERE view_name='v_data_health_entities' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'redundant_owner_rows')::numeric INTO v_prevv
  FROM public.data_health_snapshots WHERE view_name='v_data_health_entities'
    AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_entities')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_curr - v_prevv) > 25 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('entity_growth', 'warn', 'redundant_owner_rows', v_prevv, v_curr, v_curr - v_prevv,
            format('Redundant owner rows grew from %s to %s', v_prevv, v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_curr
  FROM public.data_health_snapshots WHERE view_name='v_data_health_ownership' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'pct_property_to_recorded_owner')::numeric INTO v_prevv
  FROM public.data_health_snapshots WHERE view_name='v_data_health_ownership'
    AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_data_health_ownership')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_prevv - v_curr) > 2 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('coverage_regression', 'warn', 'pct_property_to_recorded_owner', v_prevv, v_curr, v_curr - v_prevv,
            format('Property->recorded_owner coverage dropped from %s%% to %s%% (-%spp)', v_prevv, v_curr, v_prevv - v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  SELECT (payload->>'avg_score')::numeric INTO v_curr
  FROM public.data_health_snapshots WHERE view_name='v_sales_completeness_summary' ORDER BY snapshot_at DESC LIMIT 1;
  SELECT (payload->>'avg_score')::numeric INTO v_prevv
  FROM public.data_health_snapshots WHERE view_name='v_sales_completeness_summary'
    AND snapshot_at < (SELECT MAX(snapshot_at) FROM public.data_health_snapshots WHERE view_name='v_sales_completeness_summary')
  ORDER BY snapshot_at DESC LIMIT 1;
  IF v_curr IS NOT NULL AND v_prevv IS NOT NULL AND (v_prevv - v_curr) > 1.5 THEN
    INSERT INTO public.data_health_alerts (alert_kind, severity, metric, prev_value, curr_value, delta, summary)
    VALUES ('completeness_regression', 'warn', 'sales_completeness_avg', v_prevv, v_curr, v_curr - v_prevv,
            format('Sales completeness avg dropped from %s to %s', v_prevv, v_curr));
    v_alerts := v_alerts + 1;
  END IF;

  RETURN QUERY SELECT v_snaps, v_alerts, now();
END;
$$;
