-- R4-B: server-side summary for the dialysis "Clinic Financial Estimates"
-- overview widget.
--
-- The widget previously loaded ~36K is_latest clinic_financial_estimates rows
-- client-side (37 keyset pages through the data-query edge function) just to
-- compute five headline averages, so it spun "Loading..." for minutes and
-- often never resolved inside a session. This view pre-aggregates the
-- highest-confidence estimate per existing clinic into ONE row.
--
-- Mirrors renderFinancialMetricsInner(): best = DISTINCT ON (medicare_id) by
-- confidence_score among is_latest rows, kept only for clinics still present in
-- medicare_clinics (the "no longer in CMS inventory" filter). EBITDA falls back
-- to estimated_operating_profit, matching the renderer.
--
-- Idempotent: CREATE OR REPLACE VIEW.

CREATE OR REPLACE VIEW public.v_clinic_financial_overview AS
WITH best AS (
  SELECT DISTINCT ON (e.medicare_id)
    e.medicare_id, e.estimated_annual_revenue, e.estimated_annual_profit,
    e.estimated_ebitda, e.estimated_operating_profit, e.confidence_score
  FROM clinic_financial_estimates e
  WHERE e.is_latest = true
  ORDER BY e.medicare_id, e.confidence_score DESC NULLS LAST
),
existing AS (
  SELECT b.* FROM best b
  WHERE EXISTS (SELECT 1 FROM medicare_clinics mc WHERE mc.medicare_id = b.medicare_id)
),
src AS (
  SELECT jsonb_object_agg(s.src, s.cnt) AS source_breakdown
  FROM (
    SELECT COALESCE(estimate_source, 'unknown') AS src, count(*) AS cnt
    FROM clinic_financial_estimates WHERE is_latest = true GROUP BY 1
  ) s
)
SELECT
  (SELECT count(*) FROM existing) AS clinics_estimated,
  (SELECT count(*) FROM existing WHERE estimated_annual_revenue > 0) AS with_revenue,
  (SELECT COALESCE(sum(estimated_annual_revenue),0) FROM existing WHERE estimated_annual_revenue > 0) AS total_revenue,
  (SELECT round(avg(estimated_annual_revenue)) FROM existing WHERE estimated_annual_revenue > 0) AS avg_revenue,
  (SELECT count(*) FROM existing WHERE estimated_annual_profit > 0) AS with_profit,
  (SELECT COALESCE(sum(estimated_annual_profit),0) FROM existing WHERE estimated_annual_profit > 0) AS total_profit,
  (SELECT round(avg(estimated_annual_profit)) FROM existing WHERE estimated_annual_profit > 0) AS avg_profit,
  (SELECT count(*) FROM existing WHERE COALESCE(estimated_ebitda, estimated_operating_profit) > 0) AS with_ebitda,
  (SELECT round(avg(COALESCE(estimated_ebitda, estimated_operating_profit))) FROM existing WHERE COALESCE(estimated_ebitda, estimated_operating_profit) > 0) AS avg_ebitda,
  (SELECT count(*) FROM medicare_clinics) AS total_clinic_universe,
  (SELECT source_breakdown FROM src) AS source_breakdown;
