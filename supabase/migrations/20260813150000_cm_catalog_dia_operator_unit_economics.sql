-- =============================================================================
-- 20260813150000_cm_catalog_dia_operator_unit_economics.sql  (LCC Opps)
-- Capital-markets catalog row for the Operator Unit Economics DataTable page.
-- Applied live to LCC Opps xengecqvemvfknjvbvrq 2026-08-13.
--
-- DataTable (no native chart). Column contract: api/_shared/cm-excel-export.js
-- (CHART_COLUMNS.dia_operator_unit_economics + TAB_NAMES). SQL view (Dialysis_DB):
-- cm_dialysis_operator_unit_economics. Sits with Industry Participants (phase 4).
-- =============================================================================
INSERT INTO public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token,
   applies_to_verticals, view_name_template, phase, notes)
VALUES
  ('dia_operator_unit_economics',
   'Operator Unit Economics — Per-Clinic Operating Statistics',
   'DataTable', 'ranked_list', 'operator_unit_economics', NULL,
   ARRAY['dialysis'], 'cm_{vertical}_operator_unit_economics', 4,
   'Unit-level (per-clinic) operating statistics by major operator from the reconciled model (dialysis_econ_reconciled_v1): avg treatments/patients/revenue/EBITDA per clinic, revenue & cost per treatment, operating & EBITDA margin. Sits with Industry Participants; DaVita/Fresenius reconcile to their 10-K.')
ON CONFLICT (chart_template_id) DO UPDATE
  SET name=EXCLUDED.name, chart_type=EXCLUDED.chart_type, data_shape=EXCLUDED.data_shape,
      metric_focus=EXCLUDED.metric_focus, y_format_token=EXCLUDED.y_format_token,
      applies_to_verticals=EXCLUDED.applies_to_verticals, view_name_template=EXCLUDED.view_name_template,
      phase=EXCLUDED.phase, notes=EXCLUDED.notes;
