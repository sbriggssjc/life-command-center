-- Capital Markets — monthly cadence templates (deliverable p.33-35).
--
-- Companion to DialysisProject 20260514_cm_dialysis_monthly_views which adds
-- the 3 monthly TTM views: cm_dialysis_dom_pct_ask_m, cm_dialysis_bid_ask_spread_m,
-- cm_dialysis_seller_sentiment_m.
--
-- This migration:
--   1. Adds a `cadence` column to cm_chart_catalog ('quarterly' / 'monthly' /
--      'annual'). Backfilled from data_shape patterns. The frontend uses this
--      to pick a date-label formatter (Q1 '25 vs Jan '25 vs 2025) and the
--      API uses it to derive the time-axis sort column.
--
--   2. Adds 3 new chart_template_ids for the monthly dialysis variants:
--        dom_and_pct_of_ask_monthly
--        bid_ask_spread_monthly
--        seller_sentiment_monthly
--      Each is dialysis-only (gov's deliverable uses quarterly cadence
--      for these same metrics). Phase 6 — separates them from the
--      quarterly originals (phase 1) and the inventory templates (phase 5).

-- ────────────────────────────────────────────────────────────────────
-- 1. Add cadence column with default 'quarterly'
-- ────────────────────────────────────────────────────────────────────
alter table public.cm_chart_catalog
  add column if not exists cadence text not null default 'quarterly'
    check (cadence in ('quarterly', 'monthly', 'annual'));

comment on column public.cm_chart_catalog.cadence is
  'Time-axis cadence for the chart''s underlying view. The frontend uses '
  'this to pick a date-label formatter (Q1 ''25 vs Jan ''25 vs 2025) and '
  'the API uses it to derive the time-axis sort column (period_end vs '
  'year). Backfilled from data_shape on existing rows.';

-- Backfill cadence from data_shape patterns
update public.cm_chart_catalog
set cadence = case
  when data_shape ilike '%yearly%'  then 'annual'
  when data_shape ilike '%monthly%' then 'monthly'
  else 'quarterly'
end
where cadence = 'quarterly';

-- ────────────────────────────────────────────────────────────────────
-- 2. Insert monthly dialysis chart_template_ids
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.cm_chart_catalog (
  chart_template_id, name, chart_type, data_shape, metric_focus,
  y_format_token, applies_to_verticals, view_name_template, phase, cadence
) VALUES
  ('dom_and_pct_of_ask_monthly',
   'Days on Market & % of Ask (Monthly TTM)',
   'BarChart',
   'time_series_monthly_dual',
   'closed_dom_pct_ask',
   'integer_count',
   ARRAY['dialysis'],
   'cm_{vertical}_dom_pct_ask_m',
   6,
   'monthly'),

  ('bid_ask_spread_monthly',
   'Bid-Ask Spread (Monthly TTM)',
   'BarChart',
   'time_series_monthly_combo',
   'bid_ask_spread',
   'percent_basis_points',
   ARRAY['dialysis'],
   'cm_{vertical}_bid_ask_spread_m',
   6,
   'monthly'),

  ('seller_sentiment_monthly',
   'Seller Sentiment (Monthly TTM)',
   'BarChart',
   'time_series_monthly_combo',
   'seller_sentiment',
   'percent_basis_points',
   ARRAY['dialysis'],
   'cm_{vertical}_seller_sentiment_m',
   6,
   'monthly')
ON CONFLICT (chart_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  chart_type = EXCLUDED.chart_type,
  data_shape = EXCLUDED.data_shape,
  metric_focus = EXCLUDED.metric_focus,
  y_format_token = EXCLUDED.y_format_token,
  applies_to_verticals = EXCLUDED.applies_to_verticals,
  view_name_template = EXCLUDED.view_name_template,
  phase = EXCLUDED.phase,
  cadence = EXCLUDED.cadence;
