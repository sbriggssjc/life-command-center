-- =====================================================================
-- Round 8 — Re-point 15 chart_template_ids from quarterly per-view
-- (cm_<vertical>_<chart>_q) to monthly _m wrapper views. The wrappers
-- read from master_m but expose only the renderer-needed columns,
-- which bypasses the gov master_m runtime fetch bug that has been
-- preventing the monthly TTM mapper from firing in production.
--
-- Applied to LCC Opps (xengecqvemvfknjvbvrq).
-- =====================================================================

update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_volume_ttm_m', cadence='monthly'
  where chart_template_id = 'volume_ttm_by_quarter';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_cap_ttm_m', cadence='monthly'
  where chart_template_id = 'cap_rate_ttm_by_quarter';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_count_ttm_m', cadence='monthly'
  where chart_template_id = 'transaction_count_ttm';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_avg_deal_m', cadence='monthly'
  where chart_template_id = 'avg_deal_size';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_yoy_change_m', cadence='monthly'
  where chart_template_id = 'yoy_volume_change';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_cap_quartile_m', cadence='monthly'
  where chart_template_id = 'cap_rate_top_bottom_quartile';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_nm_vs_market_m', cadence='monthly'
  where chart_template_id = 'nm_vs_market_cap';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_cap_by_term_m', cadence='monthly'
  where chart_template_id = 'cap_rate_by_lease_term';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_cap_by_credit_m', cadence='monthly'
  where chart_template_id = 'cap_rate_by_credit';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_dom_pct_ask_m', cadence='monthly'
  where chart_template_id = 'dom_and_pct_of_ask';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_bid_ask_spread_m', cadence='monthly'
  where chart_template_id = 'bid_ask_spread';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_seller_sentiment_m', cadence='monthly'
  where chart_template_id = 'seller_sentiment';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_cost_of_capital_m', cadence='monthly'
  where chart_template_id = 'cost_of_capital';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_returns_indexes_m', cadence='monthly'
  where chart_template_id = 'cash_leveraged_returns';
update public.cm_chart_catalog set
  view_name_template = 'cm_{vertical}_net_lease_spread_m', cadence='monthly'
  where chart_template_id = 'net_lease_spread';
