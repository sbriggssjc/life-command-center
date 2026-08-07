-- ============================================================================
-- CM Export Audit follow-up — register the remaining 2001-start SALES series in
-- cm_view_registry so display_from crops them to 2007-03-31 (Dialysis DB)
-- 2026-08-07
--
-- The first two display_from passes covered the front-page TTM sale series and
-- the listing-side series. Six sales-derived sheets were still un-registered, so
-- the exporter applied no crop and they shipped from 2001-01-31 (2-8 TTM deals
-- through 2004 — noise on the left edge) instead of the 2007-03-31 the rest of
-- the sale cohort clears:
--
--   Sheet                    chart_template_id            source
--   Data_Sold_Cap_by_Term    sold_cap_by_term_dot_plot    cm_dialysis_sold_cap_by_term_dot (real)
--   Data_Cost_Capital        cost_of_capital              cm_dialysis_cost_of_capital_m    (real)
--   Data_Returns_Idx         cash_leveraged_returns       cm_dialysis_returns_indexes_m    (real)
--   Data_Buyer_Pool_M        buyer_pool_monthly_count     __synthetic__ (reads master_m)
--   Data_Volume_Quarterly    quarterly_volume_bars        __synthetic__ (reads master_m)
--   Data_Pace_Cap_Expand     pace_of_cap_rate_expansion   __synthetic__ (reads cropped bases)
--
-- All six are the SAME TTM sale cohort as cm_dialysis_count_ttm_q, so they borrow
-- its density column (ttm_count) via n_source_view — one computed display_from
-- (2007-03-31, ttm_count>=25 for 4 consecutive quarters) governs the whole cohort,
-- identical to the front-page sale series seeded in the first pass.
--
-- Synthetic rows use the exporter's own '__synthetic__:<id>' marker as the PK
-- view_name (cm_compute_display_from reads n_source_view, NOT view_name, so the
-- marker is fine); resolveDisplayFrom() matches by chart_template_id. The exporter
-- applies the crop to synthetic series in capital-markets.js (synthCharts build).
--
-- Pace is registered for completeness; its YoY-lag construction already starts
-- ~2008, so the 2007-03-31 crop is a no-op on it (2008-01 is the correct start).
--
-- Idempotent (ON CONFLICT (view_name) DO UPDATE). Reversible (DELETE by view_name).
-- ============================================================================

INSERT INTO cm_view_registry
  (view_name, chart_template_id, vertical, data_shape, refresh_strategy, is_active,
   min_n_threshold, consecutive_periods, n_column, n_source_view, notes)
VALUES
  ('cm_dialysis_sold_cap_by_term_dot', 'sold_cap_by_term_dot_plot', 'dialysis', 'per_sale_snapshot', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Sales series — borrows TTM sale cohort count; crop where ttm_count>=25 for 4 q (2007-03-31).'),
  ('cm_dialysis_cost_of_capital_m', 'cost_of_capital', 'dialysis', 'time_series_quarterly_multi', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Sales series — borrows TTM sale cohort count; crop where ttm_count>=25 for 4 q (2007-03-31).'),
  ('cm_dialysis_returns_indexes_m', 'cash_leveraged_returns', 'dialysis', 'time_series_quarterly_dual_band', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Sales series — borrows TTM sale cohort count; crop where ttm_count>=25 for 4 q (2007-03-31).'),
  ('__synthetic__:buyer_pool_monthly_count', 'buyer_pool_monthly_count', 'dialysis', 'monthly_stacked_count', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Synthetic sales series (reads master_m); borrows TTM sale cohort count; crop 2007-03-31.'),
  ('__synthetic__:quarterly_volume_bars', 'quarterly_volume_bars', 'dialysis', 'quarterly_period_value', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Synthetic sales series (reads master_m); borrows TTM sale cohort count; crop 2007-03-31.'),
  ('__synthetic__:pace_of_cap_rate_expansion', 'pace_of_cap_rate_expansion', 'dialysis', 'monthly_pace_delta', 'live', true,
   25, 4, 'ttm_count', 'cm_dialysis_count_ttm_q', 'Synthetic sales series; inherits cropped base series. YoY-lag starts ~2008 so the 2007-03-31 crop is a no-op.')
ON CONFLICT (view_name) DO UPDATE SET
  chart_template_id   = EXCLUDED.chart_template_id,
  data_shape          = EXCLUDED.data_shape,
  min_n_threshold     = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column            = EXCLUDED.n_column,
  n_source_view       = EXCLUDED.n_source_view,
  notes               = EXCLUDED.notes;

SELECT cm_refresh_display_from() AS series_recomputed;
