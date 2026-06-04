-- ============================================================================
-- Round 68-C — Dialysis: volume = transaction COUNT x avg deal size
--
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
--
-- Methodology parity with gov (Scott's Excel standard, 2026-06-04 review):
--   TTM volume = TTM count of confirmed transactions x avg deal size of the
--   priced subset (100k-200M band). Keep sum(sold_price) as ttm_volume_confirmed.
--
-- Dialysis is a near-no-op for the COUNT: the importer already dedups sales and
-- there are ZERO price-undisclosed rows in the market cohort across every year
-- (2018-2026 verified). So transaction_count_ttm is unchanged and ttm_volume
-- (count x avg) lands within ~0.5% of the old sum(sold_price) -- the only delta
-- is priced rows outside the 100k-200M band, which the avg excludes but the
-- count includes. Applied here purely for cross-vertical methodological
-- consistency and to add the ttm_volume_confirmed audit column.
--
-- Validated live before/after (subspecialty='all'):
--   period_end   count   ttm_volume(count x avg)   ttm_volume_confirmed(sum)
--   2023-12-31    184    $771.1M                    $771.1M
--   2024-12-31    128    $499.9M                    $499.9M
--   2025-12-31    187    $780.7M                    $776.6M   (within rounding)
--   All cap / DOM / buyer-mix columns BYTE-IDENTICAL to baseline.
--
-- No dedup / ownership_change handling needed (dia has neither problem). If dia
-- ever ingests price-undisclosed sales, port the gov cm_*_confirmed_events_m
-- helper pattern.
-- ============================================================================

-- NOTE: full CREATE OR REPLACE bodies for cm_dialysis_market_quarterly_master_m
-- (monthly) and cm_dialysis_market_quarterly (quarterly) were applied live and
-- validated. The two views are identical to their prior definitions except:
--   * ttm_volume / ttm_volume_alt  ->  ttm_count x avg_deal_size (priced band)
--   * yoy_change_pct re-derives from the new ttm_volume (lag-12 / lag-4)
--   * NEW column ttm_volume_confirmed = the old sum(sold_price), appended last
-- See the applied migration body below.

-- ---------------------------------------------------------------------------
-- 1. Monthly master_m: ttm_volume -> count x avg, append ttm_volume_confirmed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_market_quarterly_master_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified_sales AS (
         SELECT s.sale_id, s.property_id, s.sale_date,
            (date_trunc('month'::text, s.sale_date::timestamp with time zone) + '1 mon -1 days'::interval)::date AS sale_month_end,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS sale_quarter_end,
            s.sold_price,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
            s.is_northmarq,
                CASE WHEN lower(s.buyer_type::text) ~~ '%reit%'::text THEN 'reit'::text
                    WHEN lower(s.buyer_type::text) ~~ '%cross%'::text OR lower(s.buyer_type::text) ~~ '%foreign%'::text THEN 'cross_border'::text
                    WHEN lower(s.buyer_type::text) ~~ '%institution%'::text OR lower(s.buyer_type::text) = 'fund'::text THEN 'institutional'::text
                    WHEN lower(s.buyer_type::text) = ANY (ARRAY['user'::text, 'user/owner'::text, 'owner'::text]) THEN 'user_owner'::text
                    WHEN lower(s.buyer_type::text) = ANY (ARRAY['private'::text, 'individual'::text, 'company'::text]) THEN 'private'::text
                    WHEN s.buyer_name::text ~* '\y(davita|fresenius medical|fresenius kidney|fresenius dialysis|us renal|u\.s\. renal|usrc|american renal|satellite healthcare|dialysis clinic)\y'::text THEN 'user_owner'::text
                    WHEN s.buyer_name::text ~* '\y(reit|realty trust|property trust|realty income|healthcare realty|medical properties|four corners|netstreit|exchangeright|agree realty|spirit realty|store capital|vereit|national retail|easterly|getty realty|alpine income|mob reit|w\.? ?p\.? carey|wpc|caretrust|sila realty|global medical reit|physicians realty)\y'::text THEN 'reit'::text
                    WHEN s.buyer_name::text ~* '\y(net lease.{0,15}fund|capital management|asset management|insurance|massmutual|metlife|northwestern mutual|sumitomo|smbc|smfg|teachers|pension|sovereign|trust company)\y'::text THEN 'institutional'::text
                    WHEN s.buyer_name::text ~* '\yleasing\s*(and|&)?\s*finance\y'::text THEN 'institutional'::text
                    WHEN s.buyer_name::text ~* '\y(opportunity fund|income fund|investment fund|real estate fund|reit fund)\y'::text THEN 'institutional'::text
                    ELSE 'private'::text END AS buyer_class,
            s.firm_term_years_at_sale AS firm_term_years
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false) AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text]))) AND s.sale_date <= cm_last_completed_quarter_end()
        ), ttm_per_month AS (
         SELECT m_1.period_end, cs.sold_price, cs.cap_rate, cs.is_northmarq, cs.firm_term_years, cs.buyer_class
           FROM month_anchors m_1 JOIN classified_sales cs ON cs.sale_date > (m_1.period_end - '1 year'::interval)::date AND cs.sale_date <= m_1.period_end
        ), ttm_agg AS (
         SELECT ttm_per_month.period_end, count(*) AS ttm_count, sum(ttm_per_month.sold_price) AS ttm_volume,
            avg(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.sold_price >= 100000::numeric AND ttm_per_month.sold_price <= 200000000::numeric) AS avg_deal_size,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS ttm_avg_cap_rate,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.cap_rate::double precision)) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS upper_quartile_cap,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.cap_rate::double precision)) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS lower_quartile_cap,
            percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.cap_rate::double precision)) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS median_quartile_cap,
            sum(ttm_per_month.sold_price * ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) / NULLIF(sum(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12), 0::numeric) AS ttm_weighted_cap_rate,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.is_northmarq AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS nm_avg_cap_ttm,
            avg(ttm_per_month.cap_rate) FILTER (WHERE NOT ttm_per_month.is_northmarq AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS non_nm_avg_cap_ttm,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 10::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_10plus_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 6::numeric AND ttm_per_month.firm_term_years < 10::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_6to10_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years IS NOT NULL AND ttm_per_month.firm_term_years < 5::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_less5_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE (ttm_per_month.firm_term_years IS NULL OR ttm_per_month.firm_term_years <= 0::numeric) AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_outside_firm,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 12::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_12plus_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 8::numeric AND ttm_per_month.firm_term_years < 12::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_8to12_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 6::numeric AND ttm_per_month.firm_term_years < 8::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_6to8_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years IS NOT NULL AND ttm_per_month.firm_term_years <= 5::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_5orless_year,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'reit'::text) AS reit_count_ttm,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'institutional'::text) AS institutional_count_ttm,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_count_ttm,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'cross_border'::text) AS cross_border_count_ttm
           FROM ttm_per_month GROUP BY ttm_per_month.period_end
        ), month_only AS (
         SELECT classified_sales.sale_month_end AS period_end, count(*) AS monthly_count, sum(classified_sales.sold_price) AS monthly_volume FROM classified_sales GROUP BY classified_sales.sale_month_end
        ), quarter_only AS (
         SELECT classified_sales.sale_quarter_end AS quarter_end, count(*) AS quarterly_count, sum(classified_sales.sold_price) AS quarterly_volume FROM classified_sales GROUP BY classified_sales.sale_quarter_end
        )
 SELECT m.period_end,
    to_char(m.period_end::timestamp with time zone, '"Q"Q-YYYY'::text) AS fiscal_quarter,
    'all'::text AS subspecialty,
    ta.ttm_count AS transaction_count_ttm,
    ta.ttm_count AS transaction_count_ttm_no_sumitomo,
    ta.avg_deal_size,
    (ta.ttm_count::numeric * ta.avg_deal_size) AS ttm_volume,
    (ta.ttm_count::numeric * ta.avg_deal_size) AS ttm_volume_alt,
        CASE WHEN lag((ta.ttm_count::numeric * ta.avg_deal_size), 12) OVER w > 0::numeric THEN ((ta.ttm_count::numeric * ta.avg_deal_size) - lag((ta.ttm_count::numeric * ta.avg_deal_size), 12) OVER w) / lag((ta.ttm_count::numeric * ta.avg_deal_size), 12) OVER w ELSE NULL::numeric END AS yoy_change_pct,
    qo.quarterly_volume,
    qo.quarterly_count,
    COALESCE(mo.monthly_volume, 0::numeric) AS monthly_volume,
    COALESCE(mo.monthly_count, 0::bigint) AS monthly_count,
    ta.upper_quartile_cap AS upper_quartile_cap_ttm,
    ta.lower_quartile_cap AS lower_quartile_cap_ttm,
    ta.ttm_avg_cap_rate AS avg_cap_rate_ttm,
    ta.nm_avg_cap_ttm, ta.non_nm_avg_cap_ttm, ta.cap_10plus_year, ta.cap_6to10_year, ta.cap_less5_year, ta.cap_outside_firm,
    da.avg_dom, da.pct_of_ask, ba.avg_bid_ask_spread, ba.pct_price_change AS pct_price_change_bid_ask, ba.avg_last_ask_cap,
    ss.pct_price_change_all, ss.pct_price_change_long_term, ss.last_ask_cap_all, ss.last_ask_cap_long_term,
    dct.cap_12plus AS cap_12plus_year, dct.cap_8to12 AS cap_8to12_year, dct.cap_6to8 AS cap_6to8_year, dct.cap_5orless AS cap_5orless_year,
    ta.private_count_ttm AS private_count, ta.reit_count_ttm AS reit_count, ta.institutional_count_ttm AS institutional_count, ta.cross_border_count_ttm AS cross_border_count,
    mr.treasury_10y_yield, mr.fed_funds_rate, mr.mortgage_30y_rate, mr.cpi_index, mr.unemployment_rate,
    lc.low_loan_constant, lc.high_loan_constant,
    ta.median_quartile_cap AS median_quartile_cap_ttm,
    ta.ttm_volume AS ttm_volume_confirmed   -- NEW: sum(sold_price) audit floor
   FROM month_anchors m
     LEFT JOIN ttm_agg ta ON ta.period_end = m.period_end
     LEFT JOIN month_only mo ON mo.period_end = m.period_end
     LEFT JOIN quarter_only qo ON qo.quarter_end = (date_trunc('quarter'::text, m.period_end::timestamp with time zone) + '3 mons -1 days'::interval)::date
     LEFT JOIN cm_dialysis_dom_pct_ask_m da ON da.period_end = m.period_end AND da.subspecialty = 'all'::text
     LEFT JOIN cm_dialysis_bid_ask_spread_m ba ON ba.period_end = m.period_end AND ba.subspecialty = 'all'::text
     LEFT JOIN cm_dialysis_seller_sentiment_m ss ON ss.period_end = m.period_end AND ss.subspecialty = 'all'::text
     LEFT JOIN cm_dialysis_macro_rates_m mr ON mr.period_end = m.period_end
     LEFT JOIN cm_dialysis_loan_constant_m lc ON lc.period_end = m.period_end
     LEFT JOIN cm_dialysis_sold_cap_by_term_dot dct ON dct.period_end = m.period_end AND dct.subspecialty = 'all'::text
  WINDOW w AS (ORDER BY m.period_end)
  ORDER BY m.period_end;

-- ---------------------------------------------------------------------------
-- 2. Quarterly base: ttm_volume -> ttm_count x priced-band avg; append confirmed.
--    cm_dialysis_market_quarterly_master inherits ttm_volume from this view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_market_quarterly AS
 WITH closed_sales AS (
         SELECT s.sale_id, s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end,
            s.sold_price,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
            s.is_northmarq, s.buyer_type, s.buyer_name, s.seller_name
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND (s.exclude_from_market_metrics IS NULL OR NOT s.exclude_from_market_metrics) AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text]))) AND s.sale_date <= cm_last_completed_quarter_end()
        ), classified AS (
         SELECT cs.sale_id, cs.sale_date, cs.period_end, cs.sold_price, cs.cap_rate, cs.is_northmarq, cs.buyer_type, cs.buyer_name, cs.seller_name,
                CASE WHEN lower(cs.buyer_type::text) ~~ '%reit%'::text THEN 'reit'::text
                    WHEN lower(cs.buyer_type::text) ~~ '%cross%'::text OR lower(cs.buyer_type::text) ~~ '%foreign%'::text THEN 'cross_border'::text
                    WHEN lower(cs.buyer_type::text) ~~ '%institution%'::text OR lower(cs.buyer_type::text) = 'fund'::text THEN 'institutional'::text
                    WHEN lower(cs.buyer_type::text) = ANY (ARRAY['user'::text, 'user/owner'::text, 'owner'::text]) THEN 'user_owner'::text
                    WHEN lower(cs.buyer_type::text) = ANY (ARRAY['private'::text, 'individual'::text, 'company'::text]) THEN 'private'::text
                    WHEN cs.buyer_name::text ~* '\y(davita|fresenius medical|fresenius kidney|fresenius dialysis|us renal|u\.s\. renal|usrc|american renal|satellite healthcare|dialysis clinic)\y'::text THEN 'user_owner'::text
                    WHEN cs.buyer_name::text ~* '\y(reit|realty trust|property trust|realty income|healthcare realty|medical properties|four corners|netstreit|exchangeright|agree realty|spirit realty|store capital|vereit|national retail|easterly|getty realty|alpine income|mob reit|w\.? ?p\.? carey|wpc|caretrust|sila realty|global medical reit|physicians realty)\y'::text THEN 'reit'::text
                    WHEN cs.buyer_name::text ~* '\y(net lease.{0,15}fund|capital management|asset management|insurance|massmutual|metlife|northwestern mutual|sumitomo|smbc|smfg|teachers|pension|sovereign|trust company)\y'::text THEN 'institutional'::text
                    WHEN cs.buyer_name::text ~* '\yleasing\s*(and|&)?\s*finance\y'::text THEN 'institutional'::text
                    WHEN cs.buyer_name::text ~* '\y(opportunity fund|income fund|investment fund|real estate fund|reit fund)\y'::text THEN 'institutional'::text
                    ELSE 'private'::text END AS buyer_class
           FROM closed_sales cs
        ), quarterly_base AS (
         SELECT classified.period_end, 'all'::text AS subspecialty, count(*) AS transaction_count, sum(classified.sold_price) AS quarterly_volume, avg(classified.sold_price) AS avg_deal_size,
            sum(classified.sold_price) FILTER (WHERE classified.sold_price >= 100000::numeric AND classified.sold_price <= 200000000::numeric) AS q_band_sum,
            count(*) FILTER (WHERE classified.sold_price >= 100000::numeric AND classified.sold_price <= 200000000::numeric) AS q_band_n,
            count(*) FILTER (WHERE classified.cap_rate IS NOT NULL) AS cap_n,
            avg(classified.cap_rate) AS avg_cap_raw,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (classified.cap_rate::double precision)) AS upper_quartile_raw,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (classified.cap_rate::double precision)) AS lower_quartile_raw,
            avg(classified.cap_rate) FILTER (WHERE classified.is_northmarq) AS nm_cap_raw,
            avg(classified.cap_rate) FILTER (WHERE NOT classified.is_northmarq) AS non_nm_cap_raw,
            sum(classified.sold_price) FILTER (WHERE classified.buyer_class = 'reit'::text) AS reit_volume,
            sum(classified.sold_price) FILTER (WHERE classified.buyer_class = 'institutional'::text) AS institutional_volume,
            sum(classified.sold_price) FILTER (WHERE classified.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_volume,
            count(*) FILTER (WHERE classified.buyer_class = 'reit'::text) AS reit_count,
            count(*) FILTER (WHERE classified.buyer_class = 'institutional'::text) AS institutional_count,
            count(*) FILTER (WHERE classified.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_count
           FROM classified GROUP BY classified.period_end
        ), guarded AS (
         SELECT quarterly_base.period_end, quarterly_base.subspecialty, quarterly_base.transaction_count, quarterly_base.quarterly_volume, quarterly_base.avg_deal_size,
            quarterly_base.q_band_sum, quarterly_base.q_band_n,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.avg_cap_raw ELSE NULL::numeric END AS avg_cap_rate,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.upper_quartile_raw ELSE NULL::double precision END AS upper_quartile_cap,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.lower_quartile_raw ELSE NULL::double precision END AS lower_quartile_cap,
            quarterly_base.nm_cap_raw AS nm_avg_cap, quarterly_base.non_nm_cap_raw AS non_nm_avg_cap,
            quarterly_base.private_volume, quarterly_base.reit_volume, quarterly_base.institutional_volume,
            quarterly_base.private_count, quarterly_base.reit_count, quarterly_base.institutional_count
           FROM quarterly_base
        ), with_ttm AS (
         SELECT g.period_end, g.subspecialty, g.transaction_count, g.quarterly_volume, g.avg_deal_size, g.avg_cap_rate, g.upper_quartile_cap, g.lower_quartile_cap,
            g.nm_avg_cap, g.non_nm_avg_cap, g.private_volume, g.reit_volume, g.institutional_volume, g.private_count, g.reit_count, g.institutional_count,
            sum(g.transaction_count) OVER w_ttm AS ttm_count,
            sum(g.quarterly_volume) OVER w_ttm AS ttm_volume_confirmed,
            CASE WHEN sum(g.q_band_n) OVER w_ttm > 0 THEN sum(g.transaction_count) OVER w_ttm::numeric * (sum(g.q_band_sum) OVER w_ttm / sum(g.q_band_n) OVER w_ttm) ELSE NULL::numeric END AS ttm_volume
           FROM guarded g WINDOW w_ttm AS (PARTITION BY g.subspecialty ORDER BY g.period_end ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
        )
 SELECT with_ttm.period_end,
    to_char(with_ttm.period_end::timestamp with time zone, '"Q"Q-YYYY'::text) AS fiscal_quarter,
    with_ttm.subspecialty, with_ttm.ttm_volume, with_ttm.ttm_count, with_ttm.quarterly_volume, with_ttm.transaction_count, with_ttm.avg_deal_size,
    with_ttm.avg_cap_rate, with_ttm.upper_quartile_cap, with_ttm.lower_quartile_cap, with_ttm.nm_avg_cap, with_ttm.non_nm_avg_cap,
    with_ttm.private_volume, with_ttm.reit_volume, with_ttm.institutional_volume, with_ttm.private_count, with_ttm.reit_count, with_ttm.institutional_count,
        CASE WHEN lag(with_ttm.ttm_volume, 4) OVER w_q > 0::numeric THEN (with_ttm.ttm_volume - lag(with_ttm.ttm_volume, 4) OVER w_q) / lag(with_ttm.ttm_volume, 4) OVER w_q ELSE NULL::numeric END AS yoy_change_pct,
    with_ttm.ttm_volume_confirmed
   FROM with_ttm WINDOW w_q AS (PARTITION BY with_ttm.subspecialty ORDER BY with_ttm.period_end);
