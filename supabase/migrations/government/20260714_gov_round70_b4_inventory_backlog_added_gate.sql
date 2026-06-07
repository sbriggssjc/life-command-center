-- Migration: gov — Round 70 B4 (G35): gate the Market-Turnover "added to market"
-- count on the over-stamp parking tags. Project: government. Applied live.
-- Same intent as the dia B3 gate; gov uses inv_windows (UNION of available_listings
-- + sales_transactions). The available_listings branch is gated on the parking
-- tags; the sales branch is always addable (real sale-derived). Only added_ttm +
-- added_month are gated; active_count keeps parked rows. Shares the
-- cm_gov_new_to_market_q predicate. Verified: 2026 added_month -> 0/0/3,
-- active_count unchanged.
DO $r70b4g$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.cm_gov_inventory_backlog_m'::regclass);
  d := replace(d,
    '''1 year 6 mons''::interval))::date) AS e',
    '''1 year 6 mons''::interval))::date) AS e, (COALESCE(al.listing_date_source, ''''::text) <> ALL (ARRAY[''date_unknown_r70b34''::text, ''capture_date_fallback''::text, ''date_unknown''::text])) AS addable');
  d := replace(d, 'sales_transactions.sale_date AS e', 'sales_transactions.sale_date AS e, true AS addable');
  d := replace(d, '(w.s <= m.period_end))) AS added_ttm',   '(w.s <= m.period_end) AND w.addable)) AS added_ttm');
  d := replace(d, '(w.s <= m.period_end))) AS added_month', '(w.s <= m.period_end) AND w.addable)) AS added_month');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_inventory_backlog_m AS ' || d;
END $r70b4g$;
