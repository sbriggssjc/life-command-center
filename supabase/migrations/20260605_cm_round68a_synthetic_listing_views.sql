-- Migration: dia CM chart views — Round 68-A synthetic-listing include/exclude rules
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- Round 68 batch 2 (R68-A), Task 2 view layer. Task 2 synthesizes price-less
-- listing rows from unlinked sold deals (data_source='synthetic_from_sale',
-- status='sold', is_active=false, listing_date = sale_date - median DOM,
-- off_market_date = sale_date, sale_transaction_id linked, NULL prices/caps).
--
-- DOCTRINE (see docs/round68a/R68A_VIEW_MATRIX.md):
--   * COUNT / ACTIVE-UNIVERSE views INCLUDE synthetic rows — they represent a
--     real marketing window (the deal WAS on the market before it sold).
--   * PRICE / DOM / CAP views EXCLUDE synthetic rows — synthetic carries no
--     real ask price, price-change history, or asking cap. Guard:
--       AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'
--
-- SAFETY PROPERTY asserted by this migration: data_source='synthetic_from_sale'
-- can reach ZERO price/DOM/cap-derived charts. The 6 price/DOM/cap views below
-- carry the explicit guard. The cap/price children that build on the active-
-- listings views (asking_cap_quartiles_active_*, asking_cap_by_term_m,
-- available_cap_dot, on_market_snapshot_q) are cap/price-safe WITHOUT a guard
-- because they FILTER on last_cap_rate/last_price IS NOT NULL and synthetic rows
-- carry NULL there — documented in the matrix, not edited here.
--
-- Column names / order / types are preserved exactly (CREATE OR REPLACE VIEW is
-- append-only — see CLAUDE.md BD gotcha #1). Only the WHERE/JOIN guards change.
--
-- This migration is idempotent and data-independent: it is safe to apply BEFORE
-- the synthetic rows land (the guards just match zero rows until then). Retires
-- nothing from R66r — the sentinel-date hack stays, but is taught to ignore
-- synthetic rows so a synthetic date-cluster can never be mistaken for a batch
-- import artifact.

-- ===========================================================================
-- INCLUDE #1/#2 — Active Listings (active-universe count + cap/DOM children)
-- Synthetic rows are status='sold'/is_active=false, so the status disjunction
-- must explicitly admit them; the existing (sold_date IS NULL OR sold_date >
-- period_end) guard already restricts them to their pre-sale marketing window.
-- days_on_market is NULLed for synthetic so no downstream "active DOM" consumer
-- can pick up an imputed value (the cap/price columns are already NULL).
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2010-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            al.last_price,
            COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
            al.initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::integer
                 ELSE q.period_end - al.listing_date END AS days_on_market,
            al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id AND l.is_active = true AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])) AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM month_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end AND (al.sold_date IS NULL OR al.sold_date > q.period_end) AND (al.off_market_date IS NOT NULL AND al.off_market_date > q.period_end OR al.off_market_date IS NULL AND COALESCE(al.last_seen, al.url_last_checked, al.last_verified_at::date, al.listing_date) >= (q.period_end - '120 days'::interval)::date) AND (al.is_active = true OR al.data_source = 'synthetic_from_sale' OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
             LEFT JOIN properties p ON p.property_id = al.property_id
        )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id,
    active_pairs.property_id,
    active_pairs.listing_date,
    active_pairs.days_on_market,
    active_pairs.last_price,
    active_pairs.last_cap_rate,
    active_pairs.initial_price,
    active_pairs.had_price_change,
    active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus
   FROM active_pairs;

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2013-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            al.last_price,
            COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
            al.initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::integer
                 ELSE q.period_end - al.listing_date END AS days_on_market,
            al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id AND l.is_active = true AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])) AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM quarter_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end) AND (al.sold_date IS NULL OR al.sold_date > q.period_end) AND (al.is_active = true OR al.data_source = 'synthetic_from_sale' OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
             LEFT JOIN properties p ON p.property_id = al.property_id
        )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id,
    active_pairs.property_id,
    active_pairs.listing_date,
    active_pairs.days_on_market,
    active_pairs.last_price,
    active_pairs.last_cap_rate,
    active_pairs.initial_price,
    active_pairs.had_price_change,
    active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
        CASE
            WHEN active_pairs.operator ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.operator ~~* '%fresenius%'::text OR active_pairs.operator ~~* '%fmc%'::text OR active_pairs.operator ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.operator ~~* '%u.s. renal%'::text OR active_pairs.operator ~~* '%us renal%'::text OR active_pairs.operator ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.operator IS NOT NULL AND TRIM(BOTH FROM active_pairs.operator) <> ''::text THEN 'Other'::text
            WHEN active_pairs.seller_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.seller_name ~~* '%fresenius%'::text OR active_pairs.seller_name ~~* '%fmc%'::text OR active_pairs.seller_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.seller_name ~~* '%u.s. renal%'::text OR active_pairs.seller_name ~~* '%us renal%'::text OR active_pairs.seller_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.tenant::text ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.tenant::text ~~* '%fresenius%'::text OR active_pairs.tenant::text ~~* '%fmc%'::text OR active_pairs.tenant::text ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.tenant::text ~~* '%u.s. renal%'::text OR active_pairs.tenant::text ~~* '%us renal%'::text OR active_pairs.tenant::text ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.building_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.building_name ~~* '%fresenius%'::text OR active_pairs.building_name ~~* '%fmc%'::text OR active_pairs.building_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.building_name ~~* '%u.s. renal%'::text OR active_pairs.building_name ~~* '%us renal%'::text OR active_pairs.building_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.true_owner_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.true_owner_name ~~* '%fresenius%'::text OR active_pairs.true_owner_name ~~* '%fmc%'::text OR active_pairs.true_owner_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.true_owner_name ~~* '%u.s. renal%'::text OR active_pairs.true_owner_name ~~* '%us renal%'::text OR active_pairs.true_owner_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN (active_pairs.seller_name IS NULL OR TRIM(BOTH FROM active_pairs.seller_name) = ''::text) AND (active_pairs.tenant IS NULL OR TRIM(BOTH FROM active_pairs.tenant) = ''::text) AND (active_pairs.building_name IS NULL OR TRIM(BOTH FROM active_pairs.building_name) = ''::text) AND (active_pairs.true_owner_name IS NULL OR TRIM(BOTH FROM active_pairs.true_owner_name) = ''::text) THEN 'Unknown'::text
            ELSE 'Other'::text
        END AS tenant_bucket,
    active_pairs.operator
   FROM active_pairs;

-- ===========================================================================
-- INCLUDE #3 — Market Turnover (active universe + TTM turnover rate)
-- Synthetic rows flow in via the eff CTE automatically. The sentinel-date hack
-- (R66r) is taught to (a) compute the >=15/day clusters from NON-synthetic rows
-- only and (b) never drop a synthetic row even if its imputed date coincides
-- with a real sentinel cluster.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_market_turnover_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.data_source = 'synthetic_from_sale' OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)
          AND (m.period_end - e.eff_start) <= 1095) AS active_count
   FROM months m
 )
 SELECT base.period_end,
   'all'::text AS subspecialty,
   base.ttm_sales AS ttm_sales_count,
   base.active_count + base.ttm_sales AS market_universe,
   base.ttm_sales::numeric / NULLIF(base.active_count + base.ttm_sales, 0)::numeric AS turnover_rate,
   base.active_count,
   base.ttm_sales AS annual_sales_rate,
   CASE WHEN base.ttm_sales > 0 THEN base.active_count::numeric * 12::numeric / base.ttm_sales::numeric
        ELSE NULL::numeric END AS months_of_supply
 FROM base
 ORDER BY base.period_end;

-- ===========================================================================
-- INCLUDE #4 — Inventory Backlog (active + added-to-market, sold, MoS)
-- Same sentinel handling as Market Turnover.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY listing_date HAVING count(*) >= 15
 ), eff AS (
   SELECT al.listing_id,
     COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
     COALESCE(al.sold_date, al.off_market_date) AS eff_end
   FROM available_listings al
   WHERE NOT (al.sold_date IS NOT NULL AND al.listing_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.listing_date IS NULL OR al.data_source = 'synthetic_from_sale' OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 ), base AS (
   SELECT m.period_end,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)) AS active_count,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start IS NOT NULL AND e.eff_start > (m.period_end - '1 year'::interval)::date AND e.eff_start <= m.period_end) AS added_ttm,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm,
     ( SELECT count(*) FROM eff e
        WHERE e.eff_start >= date_trunc('month', m.period_end::timestamptz)::date AND e.eff_start <= m.period_end) AS added_month,
     ( SELECT count(*) FROM sales_transactions s
        WHERE s.sale_date >= date_trunc('month', m.period_end::timestamptz)::date AND s.sale_date <= m.period_end
          AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_month
   FROM months m
 )
 SELECT base.period_end,
   'all'::text AS subspecialty,
   base.active_count,
   base.added_ttm,
   base.sold_ttm,
   base.sold_ttm AS ttm_sales,
   CASE WHEN base.sold_ttm > 0 THEN base.active_count::numeric * 12::numeric / base.sold_ttm::numeric
        ELSE NULL::numeric END AS months_of_supply,
   base.added_month,
   base.sold_month,
   base.added_month - base.sold_month AS net_to_market_month
 FROM base
 ORDER BY base.period_end;

-- ===========================================================================
-- INCLUDE #5 — Available Market Size (count_total + count_core_10plus)
-- Synthetic flow in via the listing_date window join. avg_cap_* are unaffected:
-- synthetic carry NULL cap, excluded by the 0.04-0.12 band filter. Sentinel
-- handling mirrors the turnover views.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS
 WITH quarter_anchors AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY listing_date HAVING count(*) >= 15
 ), marketed AS (
   SELECT q.period_end,
     al.listing_id,
     COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS cap,
     (( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
          FROM leases l
         WHERE l.property_id = al.property_id AND l.is_active = true
           AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text]))
           AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
         ORDER BY l.lease_expiration DESC LIMIT 1)) >= 10::numeric AS is_core
   FROM quarter_anchors q
   JOIN available_listings al ON al.listing_date IS NOT NULL
     AND al.listing_date > (q.period_end - '1 year'::interval)::date
     AND al.listing_date <= q.period_end
     AND NOT (al.sold_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.data_source = 'synthetic_from_sale' OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 )
 SELECT marketed.period_end,
   'all'::text AS subspecialty,
   count(*) AS count_total,
   count(*) FILTER (WHERE marketed.is_core) AS count_core_10plus,
   avg(marketed.cap) FILTER (WHERE marketed.cap >= 0.04 AND marketed.cap <= 0.12) AS avg_cap_total,
   CASE WHEN count(*) FILTER (WHERE marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12) >= 3
        THEN avg(marketed.cap) FILTER (WHERE marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12)
        ELSE NULL::numeric END AS avg_cap_core_10plus
 FROM marketed
 GROUP BY marketed.period_end
 HAVING count(*) >= 5
 ORDER BY marketed.period_end;

-- ===========================================================================
-- EXCLUDE #1/#2 — DOM & % of Ask (monthly + quarterly)
-- THE GENUINE LEAK: this view filters on sold_price>0 (which synthetic rows
-- carry) and computes DOM = sold_date - listing_date (both set on synthetic).
-- Without the guard, synthetic rows would inject an imputed median DOM into the
-- real DOM distribution. Guard added to every available_listings reference.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, CURRENT_DATE::timestamp with time zone, '1 mon'::interval) g(d)
        ), sold AS (
         SELECT m.period_end,
            al.sold_date - al.listing_date AS dom,
                CASE
                    WHEN al.initial_price > 0::numeric AND al.sold_price > 0::numeric THEN al.sold_price / al.initial_price
                    ELSE NULL::numeric
                END AS ratio
           FROM month_anchors m
             LEFT JOIN available_listings al ON COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND al.sold_date > (m.period_end - '1 year'::interval)::date AND al.sold_date <= m.period_end AND al.listing_date IS NOT NULL AND al.sold_price IS NOT NULL AND al.sold_price > 0::numeric
        ), agg AS (
         SELECT sold.period_end,
            count(*) FILTER (WHERE sold.dom >= 0 AND sold.dom <= 730) AS n_sales,
            avg(sold.dom) FILTER (WHERE sold.dom >= 0 AND sold.dom <= 730) AS avg_dom_raw,
            avg(sold.ratio) FILTER (WHERE sold.ratio IS NOT NULL AND sold.ratio >= 0.5 AND sold.ratio < 1.0) AS pct_raw,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (sold.dom::double precision)) FILTER (WHERE sold.dom >= 0 AND sold.dom <= 730) AS mdom_raw,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (sold.ratio::double precision)) FILTER (WHERE sold.ratio IS NOT NULL AND sold.ratio >= 0.5 AND sold.ratio < 1.0) AS mpct_raw
           FROM sold
          GROUP BY sold.period_end
        ), gated AS (
         SELECT agg.period_end,
            agg.n_sales,
                CASE
                    WHEN agg.n_sales >= 10 THEN agg.avg_dom_raw
                    ELSE NULL::numeric
                END AS dom_g,
                CASE
                    WHEN agg.n_sales >= 10 THEN agg.pct_raw
                    ELSE NULL::numeric
                END AS pct_g,
                CASE
                    WHEN agg.n_sales >= 10 THEN agg.mdom_raw
                    ELSE NULL::double precision
                END AS mdom_g,
                CASE
                    WHEN agg.n_sales >= 10 THEN agg.mpct_raw
                    ELSE NULL::double precision
                END AS mpct_g
           FROM agg
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    gated.n_sales,
    avg(gated.dom_g) OVER w::numeric(10,1) AS avg_dom,
    avg(gated.pct_g) OVER w::numeric(8,5) AS pct_of_ask,
    avg(gated.mdom_g) OVER w::numeric(10,1) AS median_dom,
    avg(gated.mpct_g) OVER w::numeric(8,5) AS median_pct_of_ask
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
  ORDER BY gated.period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_q AS
 WITH quarter_anchors AS (
         SELECT DISTINCT (date_trunc('quarter'::text, available_listings.sold_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end
           FROM available_listings
          WHERE available_listings.sold_date IS NOT NULL AND available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale' AND available_listings.listing_date IS NOT NULL AND available_listings.last_price IS NOT NULL AND available_listings.last_price > 0::numeric AND available_listings.sold_price IS NOT NULL AND available_listings.sold_price > 0::numeric
        ), ttm_sold_filtered AS (
         SELECT q.period_end,
            al.sold_date - al.listing_date AS days_on_market,
            al.sold_price / NULLIF(al.last_price, 0::numeric) AS pct_of_ask
           FROM quarter_anchors q
             JOIN available_listings al ON COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND al.sold_date > (q.period_end - '1 year'::interval)::date AND al.sold_date <= q.period_end AND al.listing_date IS NOT NULL AND al.last_price IS NOT NULL AND al.last_price > 0::numeric AND al.sold_price IS NOT NULL AND al.sold_price > 0::numeric AND (al.sold_date - al.listing_date) >= 0 AND (al.sold_date - al.listing_date) <= 1095 AND (al.sold_price::numeric / al.last_price::numeric) >= 0.50 AND (al.sold_price::numeric / al.last_price::numeric) <= 1.50
        )
 SELECT ttm_sold_filtered.period_end,
    'all'::text AS subspecialty,
    count(*) AS n_sales,
    avg(ttm_sold_filtered.days_on_market)::numeric(10,1) AS avg_dom,
    avg(ttm_sold_filtered.pct_of_ask)::numeric(8,5) AS pct_of_ask
   FROM ttm_sold_filtered
  GROUP BY ttm_sold_filtered.period_end
  ORDER BY ttm_sold_filtered.period_end;

-- ===========================================================================
-- EXCLUDE #3/#4 — Bid-Ask Spread (monthly + quarterly)
-- Synthetic carry NULL caps/prices (naturally excluded), but the guard is added
-- so the safety assertion holds structurally even if a future writer stamps a
-- cap onto a synthetic row.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_bid_ask_spread_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, CURRENT_DATE::timestamp with time zone, '1 mon'::interval) g(d)
        ), ttm_sold AS (
         SELECT m.period_end,
                CASE
                    WHEN al.last_cap_rate IS NOT NULL AND al.cap_rate IS NOT NULL THEN abs(al.last_cap_rate - al.cap_rate)
                    ELSE NULL::numeric
                END AS bid_ask_spread_bps,
                CASE
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                    ELSE NULL::boolean
                END AS had_price_change,
            al.last_cap_rate AS last_ask_cap
           FROM month_anchors m
             LEFT JOIN available_listings al ON COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND al.sold_date > (m.period_end - '1 year'::interval)::date AND al.sold_date <= m.period_end
        ), agg AS (
         SELECT ttm_sold.period_end,
            count(*) FILTER (WHERE ttm_sold.bid_ask_spread_bps IS NOT NULL) AS n_with_spread,
            avg(ttm_sold.bid_ask_spread_bps) AS avg_bid_ask_spread_raw,
            count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL) AS n_with_pricing,
            count(*) FILTER (WHERE ttm_sold.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change_raw,
            avg(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS avg_last_ask_cap_raw,
            min(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS min_last_ask_cap_raw,
            max(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS max_last_ask_cap_raw,
            count(*) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS n_with_last_cap
           FROM ttm_sold
          GROUP BY ttm_sold.period_end
        ), gated AS (
         SELECT agg.period_end,
            'all'::text AS subspecialty,
            agg.n_with_spread,
                CASE
                    WHEN agg.n_with_spread >= 5 THEN agg.avg_bid_ask_spread_raw
                    ELSE NULL::numeric
                END::numeric(8,5) AS avg_bid_ask_spread,
            agg.n_with_pricing,
                CASE
                    WHEN agg.n_with_pricing >= 5 THEN agg.pct_price_change_raw
                    ELSE NULL::numeric
                END AS pct_price_change,
                CASE
                    WHEN agg.n_with_last_cap >= 5 THEN agg.avg_last_ask_cap_raw
                    ELSE NULL::numeric
                END::numeric(8,5) AS avg_last_ask_cap,
                CASE
                    WHEN agg.n_with_last_cap >= 5 THEN agg.min_last_ask_cap_raw
                    ELSE NULL::numeric
                END::numeric(8,5) AS min_last_ask_cap,
                CASE
                    WHEN agg.n_with_last_cap >= 5 THEN agg.max_last_ask_cap_raw
                    ELSE NULL::numeric
                END::numeric(8,5) AS max_last_ask_cap
           FROM agg
        )
 SELECT gated.period_end,
    gated.subspecialty,
    gated.n_with_spread,
    gated.avg_bid_ask_spread,
    gated.n_with_pricing,
    gated.pct_price_change,
    gated.avg_last_ask_cap,
    gated.min_last_ask_cap,
    gated.max_last_ask_cap,
        CASE
            WHEN gated.avg_last_ask_cap IS NOT NULL AND gated.avg_bid_ask_spread IS NOT NULL THEN gated.avg_last_ask_cap + gated.avg_bid_ask_spread
            ELSE NULL::numeric
        END::numeric(8,5) AS achieved_last_ask_cap
   FROM gated
  ORDER BY gated.period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_bid_ask_spread_q AS
 WITH quarter_anchors AS (
         SELECT DISTINCT (date_trunc('quarter'::text, available_listings.sold_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end
           FROM available_listings
          WHERE available_listings.sold_date IS NOT NULL AND available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale'
        ), ttm_sold AS (
         SELECT q.period_end,
                CASE
                    WHEN al.last_cap_rate IS NOT NULL AND al.cap_rate IS NOT NULL THEN abs(al.last_cap_rate - al.cap_rate)
                    ELSE NULL::numeric
                END AS bid_ask_spread_bps,
                CASE
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                    ELSE NULL::boolean
                END AS had_price_change,
            al.last_cap_rate AS last_ask_cap
           FROM quarter_anchors q
             JOIN available_listings al ON COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND al.sold_date > (q.period_end - '1 year'::interval)::date AND al.sold_date <= q.period_end
        ), agg AS (
         SELECT ttm_sold.period_end,
            count(*) FILTER (WHERE ttm_sold.bid_ask_spread_bps IS NOT NULL) AS n_with_spread,
            avg(ttm_sold.bid_ask_spread_bps)::numeric(8,5) AS avg_bid_ask_spread,
            count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL) AS n_with_pricing,
            count(*) FILTER (WHERE ttm_sold.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change,
            avg(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12)::numeric(8,5) AS avg_last_ask_cap_raw,
            count(*) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS n_with_last_cap
           FROM ttm_sold
          GROUP BY ttm_sold.period_end
        )
 SELECT agg.period_end,
    'all'::text AS subspecialty,
    agg.n_with_spread,
    agg.avg_bid_ask_spread,
    agg.n_with_pricing,
    agg.pct_price_change,
        CASE
            WHEN agg.n_with_last_cap >= 5 THEN agg.avg_last_ask_cap_raw
            ELSE NULL::numeric(8,5)
        END AS avg_last_ask_cap
   FROM agg
  ORDER BY agg.period_end;

-- ===========================================================================
-- EXCLUDE #5/#6 — Seller Sentiment (monthly + quarterly)
-- Sales-keyed: reads the linked listing's price-change + last_ask_cap via
-- sale_transaction_id. Synthetic rows are created only for previously-UNLINKED
-- sales, so a sale has either a real listing OR a synthetic one, never both.
-- Without the guard the LIMIT-1 correlated subquery would resolve to the
-- synthetic row (NULL price-change, NULL cap) — numerically already filtered
-- out, but the guard makes the exclusion structural and future-proof.
-- ===========================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_seller_sentiment_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id,
            s.property_id,
            s.sale_date,
            s.sold_price,
            s.firm_term_years_at_sale AS firm_term_years,
            ( SELECT
                        CASE
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                            ELSE NULL::boolean
                        END AS "case"
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS had_price_change,
            ( SELECT al.last_cap_rate
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS last_cap_rate
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), ttm_pairs AS (
         SELECT m.period_end,
            cs.firm_term_years,
            cs.had_price_change,
            cs.last_cap_rate
           FROM month_anchors m
             LEFT JOIN closed_sales cs ON cs.sale_date > (m.period_end - '1 year'::interval)::date AND cs.sale_date <= m.period_end
        ), agg AS (
         SELECT ttm_pairs.period_end,
            count(ttm_pairs.last_cap_rate) AS n_all,
            count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) AS n_long_term,
                CASE
                    WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL) >= 3 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL), 0)::numeric
                    ELSE NULL::numeric
                END AS pct_pc_all,
                CASE
                    WHEN count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric) >= 3 THEN count(*) FILTER (WHERE ttm_pairs.had_price_change AND ttm_pairs.firm_term_years >= 10::numeric)::numeric / NULLIF(count(*) FILTER (WHERE ttm_pairs.had_price_change IS NOT NULL AND ttm_pairs.firm_term_years >= 10::numeric), 0)::numeric
                    ELSE NULL::numeric
                END AS pct_pc_lt,
                CASE
                    WHEN count(ttm_pairs.last_cap_rate) >= 3 THEN avg(ttm_pairs.last_cap_rate)
                    ELSE NULL::numeric
                END AS cap_all_raw,
                CASE
                    WHEN count(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric) >= 3 THEN avg(ttm_pairs.last_cap_rate) FILTER (WHERE ttm_pairs.firm_term_years >= 10::numeric)
                    ELSE NULL::numeric
                END AS cap_lt_raw
           FROM ttm_pairs
          GROUP BY ttm_pairs.period_end
        )
 SELECT agg.period_end,
    'all'::text AS subspecialty,
    agg.n_all,
    agg.n_long_term,
    agg.pct_pc_all AS pct_price_change_all,
    agg.pct_pc_lt AS pct_price_change_long_term,
    avg(agg.cap_all_raw) OVER w::numeric(8,5) AS last_ask_cap_all,
    avg(agg.cap_lt_raw) OVER w::numeric(8,5) AS last_ask_cap_long_term
   FROM agg
  WINDOW w AS (ORDER BY agg.period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
  ORDER BY agg.period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_seller_sentiment_q AS
 WITH closed_sales AS (
         SELECT s.sale_id,
            s.property_id,
            s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end,
            s.sold_price,
            s.firm_term_years_at_sale AS firm_term_years,
            ( SELECT
                        CASE
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                            WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                            ELSE NULL::boolean
                        END AS "case"
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS had_price_change,
            ( SELECT al.last_cap_rate
                   FROM available_listings al
                  WHERE al.sale_transaction_id = s.sale_id AND al.data_source IS DISTINCT FROM 'synthetic_from_sale' AND COALESCE(al.status, ''::text::character varying)::text !~~* '%supersed%'::text
                 LIMIT 1) AS last_cap_rate
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
        )
 SELECT closed_sales.period_end,
    'all'::text AS subspecialty,
    count(*) AS n_all,
    count(*) FILTER (WHERE closed_sales.firm_term_years >= 8::numeric) AS n_long_term,
    count(*) FILTER (WHERE closed_sales.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change_all,
    count(*) FILTER (WHERE closed_sales.had_price_change AND closed_sales.firm_term_years >= 8::numeric)::numeric / NULLIF(count(*) FILTER (WHERE closed_sales.had_price_change IS NOT NULL AND closed_sales.firm_term_years >= 8::numeric), 0)::numeric AS pct_price_change_long_term,
    avg(closed_sales.last_cap_rate)::numeric(8,5) AS last_ask_cap_all,
    avg(closed_sales.last_cap_rate) FILTER (WHERE closed_sales.firm_term_years >= 8::numeric)::numeric(8,5) AS last_ask_cap_long_term
   FROM closed_sales
  GROUP BY closed_sales.period_end
 HAVING count(*) > 0
  ORDER BY closed_sales.period_end;
