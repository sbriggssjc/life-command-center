-- ============================================================================
-- Round 68-E (G12) — retitle the two all-time data tables mislabeled "(TTM)"
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq) — public.cm_chart_catalog
--
-- Scott's 2026-06-04 review: Top Buyers / Top Sellers tables are labeled
-- "(TTM)" but the underlying views aggregate ALL-TIME totals (confirmed in
-- docs/capital-markets/ROUND66_DATA_AUDIT_2026-06-01.md). Title fix only --
-- Scott explicitly asked for a relabel, not a re-window.
-- ============================================================================

UPDATE public.cm_chart_catalog
SET name = replace(name, '(TTM)', '(All-Time)')
WHERE chart_template_id IN ('top_buyers_table', 'top_sellers_table');
