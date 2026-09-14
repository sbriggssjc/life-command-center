-- =============================================================================
-- 20260813140000_cm_catalog_dia_reconciled_econ_charts.sql  (LCC Opps)
-- Capital-markets catalog rows for the reconciled dialysis facility-economics
-- charts. Applied live to LCC Opps xengecqvemvfknjvbvrq 2026-08-13.
--
-- Native chart specs: api/_shared/cm-native-chart-injector.js (both in
-- NATIVE_CHART_TEMPLATES). Data-tab column contracts: api/_shared/cm-excel-export.js
-- (CHART_COLUMNS + TAB_NAMES). SQL views (Dialysis_DB): cm_dialysis_scale_curve /
-- cm_dialysis_operator_benchmark (view_name_template substitutes {vertical}).
-- chart_template_id must match byte-for-byte across all four surfaces.
-- =============================================================================

INSERT INTO public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token,
   applies_to_verticals, view_name_template, phase, notes)
VALUES
  ('dia_facility_scale_curve',
   'Facility Scale Economics — Cost & Margin by Volume',
   'BarChart', 'categorical_snapshot_combo', 'facility_scale_economics', 'percent_one_decimal',
   ARRAY['dialysis'], 'cm_{vertical}_scale_curve', 6,
   'Reconciled facility economics (dialysis_econ_reconciled_v1): median EBITDA margin (bar) by annual treatment-volume band; Data tab also carries cost/treatment + operating margin. The scale-economics story.'),
  ('dia_operator_ebitda_benchmark',
   'Operator Benchmark — EBITDA Margin by Operator',
   'BarChart', 'categorical_snapshot', 'operator_benchmark', 'percent_one_decimal',
   ARRAY['dialysis'], 'cm_{vertical}_operator_benchmark', 6,
   'Reconciled facility EBITDA margin by operator (dialysis_econ_reconciled_v1); DaVita/Fresenius reconcile to their 10-K filings.')
ON CONFLICT (chart_template_id) DO UPDATE
  SET name=EXCLUDED.name, chart_type=EXCLUDED.chart_type, data_shape=EXCLUDED.data_shape,
      metric_focus=EXCLUDED.metric_focus, y_format_token=EXCLUDED.y_format_token,
      applies_to_verticals=EXCLUDED.applies_to_verticals, view_name_template=EXCLUDED.view_name_template,
      phase=EXCLUDED.phase, notes=EXCLUDED.notes;
