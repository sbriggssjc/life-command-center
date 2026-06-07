-- Migration: dia — Round 70 B3 (D9): gate the Market-Turnover "added to market"
-- count on the over-stamp parking tags. Project: Dialysis_DB. Applied live.
--
-- The Market Turnover Monthly chart (template inventory_backlog; renderer reads
-- added_month / sold_month / net_to_market_month) gets its "added" bars from the
-- listing_date-driven eff_start counts inside cm_dialysis_inventory_backlog_m.
-- The 2026 over-stamped batch (parked as date_unknown_r70b34) was inflating the
-- added bars. Per Scott: gate the ADDED computation only; parked rows stay in
-- the active-universe/eff-window logic (active_count), since their off-market
-- anchor is real. Shares the cm_dialysis_new_to_market_q gate predicate
-- (one definition, two consumers).
--
-- Adds an `addable` flag to the eff CTE and ANDs it into added_ttm + added_month
-- only. Verified: 2026 added_month collapsed to 0/0/1 (was inflated), active_count
-- unchanged. As page-markers upgrade parked rows the added bars heal live.
DO $r70b3g$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.cm_dialysis_inventory_backlog_m'::regclass);
  d := replace(d,
    'COALESCE(al.sold_date, al.off_market_date) AS eff_end
           FROM available_listings al',
    'COALESCE(al.sold_date, al.off_market_date) AS eff_end,
            (COALESCE(al.listing_date_source, ''''::text) <> ALL (ARRAY[''date_unknown_r70b34''::text, ''capture_date_fallback''::text, ''date_unknown''::text])) AS addable
           FROM available_listings al');
  d := replace(d, '(e.eff_start <= m.period_end))) AS added_ttm',
                  '(e.eff_start <= m.period_end) AND e.addable)) AS added_ttm');
  d := replace(d, '(e.eff_start <= m.period_end))) AS added_month',
                  '(e.eff_start <= m.period_end) AND e.addable)) AS added_month');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS ' || d;
END $r70b3g$;
