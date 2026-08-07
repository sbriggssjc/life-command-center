-- ============================================================================
-- CM Export Audit follow-up — register listing-side series in cm_view_registry
-- with display_from thresholds, + canonical page-43 DOM annotation (items 2 & 3)
-- Dialysis DB (zqzrriwuavgrquhisnoa) — 2026-08-07
--
-- The first display_from pass (20260807_cm_view_registry_display_from.sql)
-- covered the front-page 2001-start SALE series only. This registers the
-- LISTING-side series (audit Part D second half: pre-~2017 listing under-
-- capture) so their sparse early history is cropped too.
--
-- Density gate for listing series = the active-listing COUNT, floor 50 for 4
-- consecutive periods. Series that carry their own count use it; the rest
-- borrow a count series of matching cadence via n_source_view:
--   * monthly  → cm_dialysis_market_turnover_m.active_count
--   * quarterly→ cm_dialysis_available_market_size_q.count_total
-- Box/whisker rent uses n_leases>=5; bid-ask uses n_with_spread>=10.
--
-- cm_view_registry PK is view_name, so each row is keyed by its view; the
-- exporter resolves the row whose view_name matches the chart's exported view
-- (so a chart with both _m and _q rows crops on the cadence it actually reads).
-- Idempotent (ON CONFLICT (view_name) DO UPDATE). Reversible (DELETE by view).
-- ============================================================================

INSERT INTO cm_view_registry
  (view_name, chart_template_id, vertical, data_shape, refresh_strategy, is_active,
   min_n_threshold, consecutive_periods, n_column, n_source_view, notes)
VALUES
  -- Own-count listing series --------------------------------------------------
  ('cm_dialysis_market_turnover_m', 'market_turnover', 'dialysis', 'monthly_ttm', 'live', true,
   50, 4, 'active_count', NULL, 'Listing series — crop where active_count>=50 for 4 mo.'),
  ('cm_dialysis_inventory_backlog_m', 'inventory_backlog', 'dialysis', 'monthly', 'live', true,
   50, 4, 'active_count', NULL, 'Listing series — crop where active_count>=50 for 4 mo.'),
  ('cm_dialysis_available_market_size_q', 'available_market_size_combo', 'dialysis', 'time_series_quarterly_combo', 'live', true,
   50, 4, 'count_total', NULL, 'Listing series — crop where count_total>=50 for 4 q.'),
  -- Borrowed-count listing series (no own count column) -----------------------
  ('cm_dialysis_dom_price_change_active_m', 'dom_price_change_active', 'dialysis', 'time_series_quarterly_combo', 'live', true,
   50, 4, 'active_count', 'cm_dialysis_market_turnover_m', 'Listing series — borrows market_turnover_m.active_count (exported view).'),
  ('cm_dialysis_dom_price_change_active_q', 'dom_price_change_active', 'dialysis', 'time_series_quarterly_combo', 'live', true,
   50, 4, 'count_total', 'cm_dialysis_available_market_size_q', 'Listing series — quarterly sibling; borrows available_market_size_q.count_total.'),
  ('cm_dialysis_asking_cap_quartiles_active_m', 'asking_cap_quartiles_active', 'dialysis', 'time_series_quarterly_quartile', 'live', true,
   50, 4, 'active_count', 'cm_dialysis_market_turnover_m', 'Listing series — borrows market_turnover_m.active_count (exported view).'),
  ('cm_dialysis_asking_cap_quartiles_active_q', 'asking_cap_quartiles_active', 'dialysis', 'time_series_quarterly_quartile', 'live', true,
   50, 4, 'count_total', 'cm_dialysis_available_market_size_q', 'Listing series — quarterly sibling; borrows available_market_size_q.count_total.'),
  ('cm_dialysis_asking_cap_by_term_m', 'asking_cap_by_term_dot_plot', 'dialysis', 'time_series', 'live', true,
   50, 4, 'active_count', 'cm_dialysis_market_turnover_m', 'Listing series — borrows total active_count (bucket counts are subsets).'),
  -- Density-column series -----------------------------------------------------
  ('cm_dialysis_rent_box_q', 'rent_psf_box_quarterly', 'dialysis', 'time_series_quarterly_ohlc', 'live', true,
   5, 4, 'n_leases', NULL, 'Box/whisker — crop where n_leases>=5 for 4 q.'),
  ('cm_dialysis_bid_ask_spread_m', 'bid_ask_spread', 'dialysis', 'time_series_quarterly', 'live', true,
   10, 4, 'n_with_spread', NULL, 'Bid-ask — crop where n_with_spread>=10 for 4 mo.'),
  ('cm_dialysis_valuation_index_m', 'valuation_index', 'dialysis', 'time_series_quarterly_indexed', 'live', true,
   25, 4, 'ttm_n', NULL, 'Sale-derived valuation index — crop where ttm_n>=25 for 4 mo.'),
  -- Item 3 — canonical page-43 DOM / %-of-ask basis annotation -----------------
  ('cm_dialysis_dom_pct_ask_m', 'dom_and_pct_of_ask', 'dialysis', 'time_series_quarterly', 'live', true,
   25, 4, 'n_sales', NULL,
   'CANONICAL page-43 series: sale price as % of ORIGINAL LIST (sold_price/initial_price), TTM. This is the report basis; exporter labels it "% of Original List".'),
  ('cm_dialysis_dom_pct_ask_q', 'dom_and_pct_of_ask', 'dialysis', 'time_series_quarterly', 'live', false,
   NULL, 4, NULL, NULL,
   'NON-CANONICAL fork: sale price as % of LAST ask (sold_price/last_price). Explicitly labeled "% of Last Ask"; NOT used by the report. is_active=false + no threshold so it never crops or exports.')
ON CONFLICT (view_name) DO UPDATE SET
  chart_template_id   = EXCLUDED.chart_template_id,
  data_shape          = EXCLUDED.data_shape,
  min_n_threshold     = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column            = EXCLUDED.n_column,
  n_source_view       = EXCLUDED.n_source_view,
  notes               = EXCLUDED.notes;

SELECT cm_refresh_display_from() AS series_recomputed;
