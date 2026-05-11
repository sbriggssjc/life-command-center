-- =====================================================================
-- Round 9 — Chart-name wording updates from the 2026-05-11 export
-- feedback. User: "It should just be an average" — the master_m
-- mapper has emitted a simple TTM average since Round 6b
-- (the `ttm_weighted_cap_rate` field name is retained for backwards
-- compatibility but the math is a simple mean). The "by Quarter"
-- suffix is also stale now that all four of these charts are sourced
-- from monthly _m wrapper views (Round 8).
--
-- Applied to LCC Opps (xengecqvemvfknjvbvrq).
-- =====================================================================

update public.cm_chart_catalog set
  name = 'Cap Rate — TTM Avg'
  where chart_template_id = 'cap_rate_ttm_by_quarter';

update public.cm_chart_catalog set
  name = 'Sales Volume — TTM'
  where chart_template_id = 'volume_ttm_by_quarter';

update public.cm_chart_catalog set
  name = 'Transaction Count — TTM'
  where chart_template_id = 'transaction_count_ttm';

update public.cm_chart_catalog set
  name = 'Average Deal Size — TTM'
  where chart_template_id = 'avg_deal_size';
