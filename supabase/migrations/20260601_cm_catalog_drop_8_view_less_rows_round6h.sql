-- =====================================================================
-- Round 6h — Drop 8 catalog rows whose backing views don't exist.
--
-- Documented in deltas-doc Item #21 since Round 5d (2026-05-08). User
-- picked path 1 (delete) over path 2 (build views) on 2026-05-09 after
-- the view-existence audit confirmed no Round 6f/6g regressions.
--
-- Rationale: keeping these rows in the catalog produces empty tabs in
-- every export. Dropping them removes 8 empty tabs and shrinks the
-- audit allow-list from 11 → 1 entry (only market_share_pie_ttm
-- remains, deferred until its view's label-quality issue is fixed).
--
-- Already applied to LCC Opps (xengecqvemvfknjvbvrq, 2026-05-09) via
-- the Supabase MCP.
-- =====================================================================

delete from public.cm_chart_catalog
  where chart_template_id in (
    'available_cap_rate_scatter',
    'cap_rate_yoy_change',
    'dom_price_adjustments',
    'listings_count_q',
    'nm_share_of_market',
    'ppsf_box_quarterly',
    'predicted_cap_rate',
    'rent_survey_yearly'
  );
