-- Tier 3 about-Northmarq positioning — 3 new chart_template_id rows.
-- Companions:
--   GovernmentProject migration 20260508_cm_gov_tier3_positioning
--     adds cm_nm_buyer_distribution_q + cm_nm_track_record_by_buyer_type_q
--   DialysisProject migration 20260508_cm_dialysis_notable_transactions
--     adds cm_dialysis_notable_transactions
--
-- The two NM-positioning views on gov are named cm_nm_*_q (no vertical prefix)
-- because they show NM's transaction history, not gov-specific market data.
-- Their view_name_template uses no {vertical} placeholder — the dispatcher in
-- api/capital-markets.js applies it verbatim.
--
-- The dialysis Notable Transactions view follows the standard cm_{vertical}
-- naming so its template uses '{vertical}' substitution.
--
-- Tier 3 #7 (nm_cross_asset_class) is intentionally not in this migration —
-- it requires RCA broker-level data that we don't currently load from the
-- TrendTracker aggregate exports. Separate workstream when broker-dimension
-- RCA data is available.

INSERT INTO public.cm_chart_catalog (
  chart_template_id, name, chart_type, data_shape, metric_focus,
  y_format_token, applies_to_verticals, view_name_template, phase
) VALUES
(
  'nm_buyer_distribution',
  'NM Buyer Distribution — Top States (TTM)',
  'DataTable',
  'ranked_geographic',
  'buyer_geography',
  'currency_dollars',
  ARRAY['gov'],
  'cm_nm_buyer_distribution_q',
  3
),
(
  'nm_track_record_buyer_type',
  'NM Track Record by Buyer Type (TTM)',
  'DataTable',
  'ranked_list',
  'buyer_pool_attribution',
  'mixed',
  ARRAY['gov'],
  'cm_nm_track_record_by_buyer_type_q',
  3
),
(
  'nm_notable_transactions',
  'NM Notable Healthcare Transactions',
  'DataTable',
  'ranked_list',
  'transaction_history',
  'currency_dollars',
  ARRAY['dialysis'],
  'cm_{vertical}_notable_transactions',
  3
)
ON CONFLICT (chart_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  chart_type = EXCLUDED.chart_type,
  data_shape = EXCLUDED.data_shape,
  metric_focus = EXCLUDED.metric_focus,
  y_format_token = EXCLUDED.y_format_token,
  applies_to_verticals = EXCLUDED.applies_to_verticals,
  view_name_template = EXCLUDED.view_name_template,
  phase = EXCLUDED.phase;
