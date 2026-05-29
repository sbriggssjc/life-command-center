-- Capital Markets — register Trend Watch KPI block (parity Tier-4, dialysis p.20)
-- 2026-05-29. Reuses the kpi_block chart_type/render path. Underlying view
-- cm_dialysis_trend_watch_kpis lives on Dialysis_DB (migration
-- 20260529140000_cm_dialysis_trend_watch_kpis.sql). Export tab + percent_signed
-- FMT token wired in api/_shared/cm-excel-export.js. dialysis-only (the gov
-- deck has no equivalent front-of-deck Trend Watch cluster).
INSERT INTO public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token,
   applies_to_verticals, subspecialty_friendly, view_name_template, phase, cadence)
VALUES
  ('trend_watch_callouts', 'Trend Watch — KPI Block', 'kpi_block', 'kpi_tile_grid',
   'trend_watch', 'mixed', '{dialysis}', false,
   'cm_{vertical}_trend_watch_kpis', 4, 'quarterly')
ON CONFLICT (chart_template_id) DO NOTHING;
