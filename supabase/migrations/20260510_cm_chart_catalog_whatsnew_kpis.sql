-- Tier 4 — second kpi_block chart_type instance: 'whatsnew_quarter_kpis'.
-- Reuses the kpi_block contract established by 'value_proposition_results'.
--
-- Companion: DialysisProject migration 20260510_cm_dialysis_whatsnew_kpis
-- which adds cm_dialysis_whatsnew_kpis returning 3 tiles per quarter:
-- TTM Volume YoY, TTM Cap, 10-Year Treasury.
--
-- Dialysis-only for now (deliverable PDF p.3 is dialysis-specific). The gov
-- deck doesn't have a "What's New" front-of-deck KPI cluster in the same
-- form. NHE tile (annual + dual-figure) is deferred to a future PR.

INSERT INTO public.cm_chart_catalog (
  chart_template_id, name, chart_type, data_shape, metric_focus,
  y_format_token, applies_to_verticals, view_name_template, phase
) VALUES (
  'whatsnew_quarter_kpis',
  'What''s New This Quarter — KPI Block',
  'kpi_block',
  'kpi_tile_grid',
  'quarter_headline_kpis',
  'mixed',
  ARRAY['dialysis'],
  'cm_{vertical}_whatsnew_kpis',
  4
)
ON CONFLICT (chart_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  chart_type = EXCLUDED.chart_type,
  data_shape = EXCLUDED.data_shape,
  metric_focus = EXCLUDED.metric_focus,
  y_format_token = EXCLUDED.y_format_token,
  applies_to_verticals = EXCLUDED.applies_to_verticals,
  view_name_template = EXCLUDED.view_name_template,
  phase = EXCLUDED.phase;
