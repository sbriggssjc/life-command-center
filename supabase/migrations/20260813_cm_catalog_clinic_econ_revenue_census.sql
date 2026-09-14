-- ============================================================================
-- CM chart catalog — register the dialysis "Revenue, Cost & Profit per Clinic"
-- combo chart (chart_template_id `clinic_econ_revenue_census`).
-- ----------------------------------------------------------------------------
-- Runtime source of truth for the CM export chart list (LCC Opps
-- xengecqvemvfknjvbvrq). The JS side (cm-excel-export / cm-native-chart-injector
-- / cm-chart-image-renderer) keys every layer off chart_template_id.
--
--   data_shape 'stacked_bar_yearly' → timeAxisColumnFor() orders by `year`
--     and the image renderer's isAnnual window applies.
--   cadence 'annual' → not 'monthly', so no monthly-window crop.
--   view_name_template → cm_dialysis_clinic_econ_trend_y (dia only).
--
-- Idempotent (ON CONFLICT). Applied live to LCC Opps 2026-08-13.
-- ============================================================================

INSERT INTO public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus,
   y_format_token, applies_to_verticals, subspecialty_friendly,
   view_name_template, phase, cadence, notes)
VALUES
  ('clinic_econ_revenue_census',
   'Revenue, Cost & Profit per Clinic',
   'BarChart',
   'stacked_bar_yearly',
   'revenue_cost_profit',
   'currency_dollars',
   ARRAY['dialysis']::text[],
   false,
   'cm_{vertical}_clinic_econ_trend_y',
   5,
   'annual',
   'Annual avg-per-clinic reconciled economics. Stacked bars = operating cost + operating profit (= revenue) on the primary axis; dot overlay = avg patient census on the secondary axis. HCRIS reconciled-truth basis, full-population fiscal years only (2011-2024).')
ON CONFLICT (chart_template_id) DO UPDATE SET
  name                 = EXCLUDED.name,
  chart_type           = EXCLUDED.chart_type,
  data_shape           = EXCLUDED.data_shape,
  metric_focus         = EXCLUDED.metric_focus,
  y_format_token       = EXCLUDED.y_format_token,
  applies_to_verticals = EXCLUDED.applies_to_verticals,
  subspecialty_friendly= EXCLUDED.subspecialty_friendly,
  view_name_template   = EXCLUDED.view_name_template,
  phase                = EXCLUDED.phase,
  cadence              = EXCLUDED.cadence,
  notes                = EXCLUDED.notes;
