-- Capital Markets — register Industry Participants operator landscape (dialysis p.10)
-- 2026-05-29. Ranked DataTable. Underlying view cm_dialysis_industry_participants
-- on Dialysis_DB (migration 20260529150000_cm_dialysis_industry_participants.sql).
-- Export columns + Data_Industry_Part tab wired in
-- api/_shared/cm-excel-export.js. dialysis-only.
INSERT INTO public.cm_chart_catalog
  (chart_template_id, name, chart_type, data_shape, metric_focus, y_format_token,
   applies_to_verticals, subspecialty_friendly, view_name_template, phase, cadence)
VALUES
  ('industry_participants', 'Industry Participants — Operator Landscape', 'DataTable',
   'ranked_list', 'operator_landscape', 'integer_count', '{dialysis}', false,
   'cm_{vertical}_industry_participants', 4, 'quarterly')
ON CONFLICT (chart_template_id) DO NOTHING;
