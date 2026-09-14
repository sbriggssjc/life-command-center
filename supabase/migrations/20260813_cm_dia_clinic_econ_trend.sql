-- ============================================================================
-- cm_dialysis_clinic_econ_trend_y — annual reconciled economics, avg per clinic
-- ----------------------------------------------------------------------------
-- Feeds the dialysis Capital Markets export chart
-- "Revenue, Cost & Profit per Clinic" (chart_template_id
-- `clinic_econ_revenue_census`):
--
--   * Stacked bars (primary axis): average OPERATING COST + average OPERATING
--     PROFIT per clinic, which sum to the average REVENUE per clinic.
--   * Dot overlay (secondary axis): average PATIENT CENSUS per clinic.
--
-- Grain = fiscal year (HCRIS cost-report basis, the reconciled truth model
-- `dialysis_econ_reconciled_v1`; see Dialysis repo CLAUDE.md). There is NO
-- monthly / trailing-12-month reconciled series — the underlying HCRIS cost
-- reports are annual — so the honest cadence is one point per fiscal year.
--
-- Full-population years only: the HAVING count(*) >= 1000 gate drops the
-- sparse, incomplete early-filer tail (fiscal 2025 ~61 clinics, 2026 ~721)
-- whose averages skew to a misleading negative operating profit because only a
-- biased subset of operators has filed their cost report yet. As those years
-- fill in on later HCRIS ingests they will clear the gate and appear
-- automatically — no code change needed.
--
-- Reconciled revenue == cost + operating profit at the row level (operating
-- profit is defined as revenue - cost), so the stacked bar total exactly
-- equals avg_revenue_per_clinic by construction.
--
-- Additive / reversible (DROP VIEW). SECURITY INVOKER (default). Read per
-- request by the CM export (no-store) — live immediately, no deploy needed.
-- Applied live to dia (zqzrriwuavgrquhisnoa) 2026-08-13.
-- ============================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_clinic_econ_trend_y AS
SELECT
  s.fiscal_year::int                            AS year,
  'all'::text                                   AS subspecialty,
  count(*)::int                                 AS clinic_count,
  round(avg(s.reconciled_revenue))              AS avg_revenue_per_clinic,
  round(avg(s.cost))                            AS avg_operating_cost_per_clinic,
  round(avg(s.reconciled_operating_profit))     AS avg_operating_profit_per_clinic,
  round(avg(s.reconciled_census)::numeric, 1)   AS avg_patient_census_per_clinic
FROM public.v_clinic_econ_series s
WHERE s.reconciled_revenue IS NOT NULL
GROUP BY s.fiscal_year
HAVING count(*) >= 1000
ORDER BY s.fiscal_year;

GRANT SELECT ON public.cm_dialysis_clinic_econ_trend_y TO anon, authenticated, service_role;

COMMENT ON VIEW public.cm_dialysis_clinic_econ_trend_y IS
  'Annual avg-per-clinic reconciled economics (revenue = operating cost + operating profit) + avg patient census, full-population fiscal years only. Feeds the CM export clinic_econ_revenue_census combo chart.';
