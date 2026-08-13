-- CM gov export: drop the duplicate "Closed Sales by Lease Term Remaining" chart
-- =====================================================================
-- The gov Capital Markets export carried TWO closed-sale cap-rate-by-lease-term
-- charts that render the same data as monthly TTM cohort lines:
--
--   * cap_rate_by_lease_term      (gov-only) — the value-of-firm-term 3-bucket
--     recut (6+ / 1.5-6 / sub-1.5), view cm_gov_cap_by_term_m.  KEEP.
--   * sold_cap_by_term_dot_plot   (gov + dialysis) — the legacy 4-cohort line
--     chart (10+ / 6-10 / <6 / Outside Firm), view cm_gov_sold_cap_by_term_dot.
--     A vestigial "dot_plot" (Round 28 scatter, redefined to 4 lines in Round
--     30) that duplicates the chart above for gov.
--
-- The 2026-08-13 3-bucket recut only touched cap_rate_by_lease_term, leaving the
-- dot-plot on the legacy buckets — so a gov export showed both a 3-bucket and a
-- 4-bucket copy of the same closed-sale term chart. Per Scott's call, remove the
-- legacy duplicate from the gov deliverable.
--
-- The chart is STILL the dialysis closed-sale term chart, so this only removes
-- `gov` from applies_to_verticals (dialysis keeps it). The chart's render code
-- (TAB_NAMES / CHART_COLUMNS / renderer cases) is untouched — dialysis still uses
-- it. The catalog is read per-request by the CM export, so this is live on the
-- next export with no redeploy.
--
-- Reversible: array_append(applies_to_verticals, 'gov').

UPDATE public.cm_chart_catalog
   SET applies_to_verticals = array_remove(applies_to_verticals, 'gov')
 WHERE chart_template_id = 'sold_cap_by_term_dot_plot'
   AND 'gov' = ANY(applies_to_verticals);
