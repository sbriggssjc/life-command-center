-- T4c Item 3 — gov: repoint the supply-side TIMING / RAMP series to the SINGLE
-- canonical market-entry date `available_listings.on_market_date` (was listing_date,
-- which carried fake ingest-clock dates).  Applied live to gov (scknotsqkcheojiaewwh)
-- 2026-06-24.
--
-- Doctrine (Scott, 2026-06-24): on_market_date drives the FLOW/timing + the historical
-- active-over-time SPAN (each listing active across on_market_date -> off_market_date).
-- The point-in-time CURRENT available STOCK count stays on the freshness gate and lives
-- in cm_gov_available_by_term_summary / cm_gov_available_cap_dot (off_market_date IS NULL),
-- which are NOT touched here.
--
-- Held rows (on_market_date IS NULL, the unrecoverable artifact set) drop off the time
-- axis (de-surge); dated rows plot at their real month.  NO listing_date fallback — that
-- is the whole point (on_market_date already materializes the synthetic/sale-anchor/
-- historical dates).  Reversible: re-create the prior bodies
-- (COALESCE(listing_date, ...-196d) anchors; sentinel/addable on listing_date(_source)).
--
-- cm_gov_market_turnover_m   : eff_start -> on_market_date span (active-over-time)
-- cm_gov_inventory_backlog_m : inv_windows branch1 -> on_market_date; addable + sentinel
--                              keyed on on_market_date(_source); added/ramp series
-- cm_gov_new_to_market_q     : new-to-market grouped on on_market_date quarter

CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
 WITH months AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2005-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), sentinel_dates AS (
         SELECT al.on_market_date AS d
           FROM available_listings al
          WHERE ((al.on_market_date IS NOT NULL) AND (al.listing_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (NOT COALESCE(al.exclude_from_listing_metrics, false)))
          GROUP BY al.on_market_date
         HAVING (count(*) >= 20)
        ), eff AS (
         SELECT al.listing_id,
            al.property_id,
            al.on_market_date AS eff_start,
            al.off_market_date AS eff_end
           FROM available_listings al
          WHERE ((NOT COALESCE(al.exclude_from_listing_metrics, false)) AND (al.on_market_date IS NOT NULL) AND (NOT ((al.off_market_date IS NOT NULL) AND (al.off_market_date <= al.on_market_date))) AND ((al.listing_source = 'synthetic_from_sale'::text) OR (NOT (al.on_market_date IN ( SELECT sentinel_dates.d FROM sentinel_dates)))))
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS ttm_sales,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 mon'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS monthly_sales,
            ( SELECT count(DISTINCT e.property_id) AS count
                   FROM eff e
                  WHERE ((e.eff_start IS NOT NULL) AND (e.eff_start <= m.period_end) AND ((e.eff_end IS NULL) OR (e.eff_end > m.period_end)) AND ((m.period_end - e.eff_start) <= 1095))) AS active_count
           FROM months m
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    ttm_sales AS ttm_sales_count,
    (active_count + ttm_sales) AS market_universe,
    ((ttm_sales)::numeric / (NULLIF((active_count + ttm_sales), 0))::numeric) AS turnover_rate,
    NULLIF(active_count, 0) AS active_count,
    ttm_sales AS annual_sales_rate,
        CASE
            WHEN ((active_count > 0) AND (ttm_sales > 0)) THEN (((active_count)::numeric * (12)::numeric) / (ttm_sales)::numeric)
            ELSE NULL::numeric
        END AS months_of_supply,
    monthly_sales AS monthly_sales_count
   FROM base
  ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_inventory_backlog_m AS
 WITH months AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2014-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), sentinel_dates AS (
         SELECT available_listings.on_market_date AS d
           FROM available_listings
          WHERE ((available_listings.on_market_date IS NOT NULL) AND (NOT COALESCE(available_listings.exclude_from_listing_metrics, false)))
          GROUP BY available_listings.on_market_date
         HAVING (count(*) >= 20)
        ), inv_windows AS (
         SELECT al.property_id,
            al.on_market_date AS s,
            COALESCE(al.off_market_date, ((al.on_market_date + '1 year 6 mons'::interval))::date) AS e,
            (COALESCE(al.on_market_date_source, ''::text) <> ALL (ARRAY['date_unknown_r70b34'::text, 'capture_date_fallback'::text, 'date_unknown'::text, 'unestablished'::text])) AS addable
           FROM available_listings al
          WHERE ((al.on_market_date IS NOT NULL) AND (NOT COALESCE(al.exclude_from_listing_metrics, false)) AND (NOT (al.on_market_date IN ( SELECT sentinel_dates.d
                   FROM sentinel_dates))))
        UNION ALL
         SELECT sales_transactions.property_id,
            COALESCE(sales_transactions.on_market_date, ((sales_transactions.sale_date - make_interval(days => sales_transactions.days_on_market)))::date) AS s,
            sales_transactions.sale_date AS e,
            true AS addable
           FROM sales_transactions
          WHERE ((sales_transactions.sold_price > (0)::numeric) AND (sales_transactions.sale_date IS NOT NULL) AND (NOT COALESCE(sales_transactions.exclude_from_market_metrics, false)) AND ((sales_transactions.on_market_date IS NOT NULL) OR ((sales_transactions.days_on_market IS NOT NULL) AND (sales_transactions.days_on_market > 0))))
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(DISTINCT w.property_id) AS count
                   FROM inv_windows w
                  WHERE ((w.s <= m.period_end) AND ((w.e IS NULL) OR (w.e > m.period_end)))) AS active_count,
            ( SELECT count(DISTINCT w.property_id) AS count
                   FROM inv_windows w
                  WHERE ((w.s > ((m.period_end - '1 year'::interval))::date) AND (w.s <= m.period_end) AND w.addable)) AS added_ttm,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS sold_ttm,
            ( SELECT count(DISTINCT w.property_id) AS count
                   FROM inv_windows w
                  WHERE ((w.s >= (date_trunc('month'::text, (m.period_end)::timestamp with time zone))::date) AND (w.s <= m.period_end) AND w.addable)) AS added_month,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date >= (date_trunc('month'::text, (m.period_end)::timestamp with time zone))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS sold_month
           FROM months m
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    active_count,
    added_ttm,
    sold_ttm,
    sold_ttm AS ttm_sales,
        CASE
            WHEN (sold_ttm > 0) THEN (((active_count)::numeric * (12)::numeric) / (sold_ttm)::numeric)
            ELSE NULL::numeric
        END AS months_of_supply,
    added_month,
    sold_month,
    (added_month - sold_month) AS net_to_market_month
   FROM base
  ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_new_to_market_q AS
 SELECT ((date_trunc('quarter'::text, (on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date AS period_end,
    'all'::text AS subspecialty,
    count(*) FILTER (WHERE (COALESCE(on_market_date_source, ''::text) <> ALL (ARRAY['date_unknown_r70b34'::text, 'capture_date_fallback'::text, 'date_unknown'::text, 'unestablished'::text]))) AS new_listings,
    count(*) AS new_listings_raw_incl_unknown
   FROM ( SELECT al.on_market_date,
            al.on_market_date_source
           FROM available_listings al
          WHERE (al.comp_scope IS DISTINCT FROM 'market_offuniverse'::text)) src
  WHERE ((on_market_date IS NOT NULL) AND (on_market_date >= '2013-01-01'::date) AND (on_market_date <= cm_last_completed_quarter_end()))
  GROUP BY (((date_trunc('quarter'::text, (on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date)
  ORDER BY (((date_trunc('quarter'::text, (on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date);

COMMENT ON COLUMN public.available_listings.on_market_date IS 'AUTHORITATIVE market-entry date — read this for all timing/DOM/added/ramp series (cm_* views, exports, cap-markets calcs). NULL = unknown, exclude from time series. Sourced from evidence only (on-market/DOM/email/platform/SF/sale-anchor), never the ingest clock. (T4c Item 3, 2026-06-24)';
COMMENT ON COLUMN public.available_listings.listing_date IS 'RAW capture date (may be ingest-clock/fake) — audit/reversibility only; do NOT use for market timing. on_market_date is the canonical market-entry field. (T4c Item 3, 2026-06-24)';
