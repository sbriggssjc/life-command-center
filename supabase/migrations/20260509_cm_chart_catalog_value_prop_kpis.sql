-- Tier 4 of parity audit: Value Proposition Results KPI block.
-- First chart_template using chart_type='kpi_block'. Establishes the new
-- pattern; future KPI blocks (What's New, Trend Watch) will follow this
-- contract.
--
-- Companion view migrations:
--   GovernmentProject 20260509_cm_gov_value_prop_kpis
--   DialysisProject   20260509_cm_dialysis_value_prop_kpis
--
-- Both views return one row per (period_end x tile) for 3 tiles:
--   1. Avg NOI            (single primary_value, no NM split)
--   2. Avg Cap Rate       (primary + NM/Non-NM splits)
--   3. Avg Sales Price    (primary + NM/Non-NM splits)
--
-- Frontend tile-grid renderer picks the latest period_end (or as_of supplied)
-- and renders the tiles side-by-side. When nm_value + non_nm_value are
-- populated the renderer shows a split-comparison layout; otherwise just the
-- primary_value.

INSERT INTO public.cm_chart_catalog (
  chart_template_id, name, chart_type, data_shape, metric_focus,
  y_format_token, applies_to_verticals, view_name_template, phase
) VALUES (
  'value_proposition_results',
  'Value Proposition Results — KPI Block',
  'kpi_block',
  'kpi_tile_grid',
  'nm_attribution_kpi',
  'mixed',
  ARRAY['gov','dialysis'],
  'cm_{vertical}_value_prop_kpis',
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
