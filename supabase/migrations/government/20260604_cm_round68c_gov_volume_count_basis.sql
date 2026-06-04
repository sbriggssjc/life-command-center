-- ============================================================================
-- Round 68-C — Government: volume = confirmed-transaction COUNT x avg deal size
--
-- Target: Government_DB (scknotsqkcheojiaewwh)
--
-- Methodology (Scott's Excel standard, 2026-06-04 chart review):
--   TTM volume = TTM count of ALL confirmed transactions (priced + price-undisclosed)
--                x average deal size of the PRICED subset for the same window.
-- The live views computed sum(sold_price) and excluded every price-undisclosed
-- sale from the count, badly understating gov volume in a market that is ~85%
-- non-disclosure (municipalities frequently never publish a price).
--
-- Count-basis correction (Scott, same review): a naive "count every row" basis is
-- ~4x inflated in 2025 because the CoStar sidebar re-captures the same listing many
-- times (2025 ran 5.6 rows/event vs 1.7-2.5x in prior years) and because
-- ownership-change stubs / SPE renames are owner-entity events, not sales. The
-- correct "confirmed transaction" basis:
--   1. EXCLUDE data_source LIKE 'ownership_change%'  (stubs + SPE renames)
--   2. EXCLUDE explicit duplicate / unmatched / portfolio-aggregate noise
--      (keep rows excluded ONLY for a missing price -- genuine non-disclosure)
--   3. DEDUP same-property rows within +/-90 days to ONE event (mirror of the dia
--      importer's per-property dedup; a property legitimately trading twice in a
--      TTM window stays two events). NULL-property rows each stay one event.
--   4. transaction_type allowlist guard so administrative deed noise can't inflate.
-- That basis collapses 2025's 5.63x row/event ratio back into the historical
-- 1.7-2.5x band, killing the fabricated 2025 volume boom.
--
-- Validated live before apply (Dec-2025 TTM, subspecialty='all'):
--   transaction_count_ttm  109 -> 174   (deduped confirmed transactions)
--   ttm_volume   $1,423.5M (sum) -> $2,690.8M  (174 x $15.46M priced-band avg)
--   ttm_volume_confirmed (NEW)   $974.4M  (sum(sold_price) deduped audit floor)
--   avg/cap/dom/buyer-mix columns: BYTE-IDENTICAL to pre-change baseline.
--
-- Per-year before/after count (calendar-year deduped events vs raw rows) -- the
-- dedup receipt; see PR body. 2025 collapse 5.63x, all prior years 1.7-2.5x.
--
-- Surgical design: modular helper view `cm_gov_confirmed_events_m` produces the
-- deduped event cohort; `cm_gov_confirmed_events_ttm_q` rolls it to a quarterly
-- TTM. master_m and cm_gov_market_quarterly LEFT JOIN them and swap ONLY the
-- count/volume/avg_deal columns (subspecialty='all'); every cap / DOM / buyer-mix
-- column keeps its existing priced pipeline byte-identical. New column
-- ttm_volume_confirmed appended at the end of master_m.
--
-- NOTE (G13 valuation index): Scott suspected this same row inflation drove the
-- valuation-index 2025 rise. Verified it does NOT -- cm_gov_valuation_index_m
-- averages NOI/SF over PRICED comps >=500 SF, and the inflation is in UNPRICED
-- sidebar rows (excluded there). The 2025 rise is small-sample (n=14 priced comps,
-- avg NOI/SF jumped to ~$20.9). Left for a min-n gate follow-up; not this round.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Deduped confirmed-transaction event cohort (one row per real sale event)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_confirmed_events_m AS
WITH src AS (
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    COALESCE(s.property_id::text, 'NOPID:' || s.sale_id::text) AS grp
  FROM public.sales_transactions s
  WHERE s.sale_date IS NOT NULL
    AND s.sale_date <= public.cm_last_completed_quarter_end()
    -- (1) ownership-change stubs / SPE renames are owner-entity events, not sales
    AND COALESCE(s.data_source, '') NOT LIKE 'ownership_change%'
    -- (4) market transaction-type allowlist (NULL allowed)
    AND (s.transaction_type IS NULL
         OR s.transaction_type = ANY (ARRAY['brokered','Investment','Owner-User','direct','Build-to-Suit']))
    -- (2) drop explicit duplicate / unmatched / portfolio-aggregate noise, but
    --     KEEP rows excluded only for a missing price (genuine non-disclosure)
    AND NOT COALESCE(
          (s.sales_exclusion_reason ILIKE '%duplicate%'
           OR s.sales_exclusion_reason ILIKE '%DQ2%'
           OR s.sales_exclusion_reason ILIKE '%no_government_identity%'
           OR s.sales_exclusion_reason ILIKE '%address_noise%'
           OR s.sales_exclusion_reason ILIKE '%NULL property_id%'
           OR s.sales_exclusion_reason ILIKE '%portfolio%'
           OR s.sales_exclusion_reason ILIKE '%per-property price%'),
          false)
    -- NULL-property rows can't be property-deduped; keep only legit disclosed
    -- (un-flagged) unmatched sales, drop flagged unmatched noise
    AND (s.property_id IS NOT NULL OR NOT COALESCE(s.exclude_from_market_metrics, false))
),
ordered AS (
  SELECT src.*,
    LAG(src.sale_date) OVER (PARTITION BY src.grp ORDER BY src.sale_date, src.sale_id) AS prev_date
  FROM src
),
flagged AS (
  SELECT ordered.*,
    CASE WHEN prev_date IS NULL OR (sale_date - prev_date) > 90 THEN 1 ELSE 0 END AS new_evt
  FROM ordered
),
clustered AS (
  SELECT flagged.*,
    SUM(new_evt) OVER (PARTITION BY grp ORDER BY sale_date, sale_id ROWS UNBOUNDED PRECEDING) AS evt_id
  FROM flagged
)
SELECT
  grp AS event_grp,
  evt_id,
  max(sale_date) AS event_date,               -- date by most-recent observation
  max(sold_price) FILTER (WHERE sold_price > 0) AS event_price,  -- NULL = non-disclosure
  (date_trunc('month',   max(sale_date)) + '1 mon -1 days'::interval)::date AS sale_month_end,
  (date_trunc('quarter', max(sale_date)) + '3 mons -1 days'::interval)::date AS sale_quarter_end
FROM clustered
GROUP BY grp, evt_id;

COMMENT ON VIEW public.cm_gov_confirmed_events_m IS
  'Round 68-C: deduped confirmed-transaction events for the gov capital-markets '
  'count/volume basis. Excludes ownership_change stubs, explicit dup/noise, and '
  'collapses same-property rows within +/-90 days. event_price NULL = non-disclosure.';

-- ---------------------------------------------------------------------------
-- 2. Quarterly TTM roll-up of the deduped events ('all' grain)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_confirmed_events_ttm_q AS
WITH q_anchors AS (
  SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
  FROM generate_series('2001-01-01'::date::timestamp with time zone,
                       cm_last_completed_quarter_end()::timestamp with time zone,
                       '3 mons'::interval) g(d)
),
per_q AS (
  SELECT sale_quarter_end AS period_end,
    count(*) AS q_count,
    sum(event_price) AS q_vol,
    sum(event_price) FILTER (WHERE event_price >= 100000 AND event_price <= 200000000) AS q_priced_sum,
    count(*)         FILTER (WHERE event_price >= 100000 AND event_price <= 200000000) AS q_priced_n
  FROM public.cm_gov_confirmed_events_m
  GROUP BY sale_quarter_end
),
joined AS (
  SELECT a.period_end,
    COALESCE(p.q_count, 0) AS q_count, p.q_vol,
    COALESCE(p.q_priced_sum, 0) AS q_priced_sum, COALESCE(p.q_priced_n, 0) AS q_priced_n
  FROM q_anchors a LEFT JOIN per_q p ON p.period_end = a.period_end
),
rolled AS (
  SELECT period_end, q_count, q_vol,
    sum(q_count)      OVER w AS ttm_count,
    sum(q_priced_sum) OVER w AS ttm_priced_sum,
    sum(q_priced_n)   OVER w AS ttm_priced_n
  FROM joined
  WINDOW w AS (ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
)
SELECT period_end, q_count, q_vol, ttm_count,
  CASE WHEN ttm_priced_n > 0 THEN ttm_priced_sum / ttm_priced_n ELSE NULL END AS ttm_avg_deal,
  CASE WHEN ttm_priced_n > 0 THEN ttm_count::numeric * (ttm_priced_sum / ttm_priced_n) ELSE NULL END AS ttm_volume
FROM rolled;

COMMENT ON VIEW public.cm_gov_confirmed_events_ttm_q IS
  'Round 68-C: quarterly trailing-12-month roll-up of cm_gov_confirmed_events_m. '
  'ttm_volume = ttm_count x priced-band avg deal size (count x avg method).';

COMMIT;

-- ===========================================================================
-- 3. master_m (monthly, subspecialty=all) -- swap count/volume columns to the
--    deduped basis; every other column unchanged; append ttm_volume_confirmed.
-- ===========================================================================
CREATE OR REPLACE VIEW public.cm_gov_market_quarterly_master_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id, s.property_id, s.sale_date,
            (date_trunc('month'::text, s.sale_date::timestamp with time zone) + '1 mon -1 days'::interval)::date AS sale_month_end,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS sale_quarter_end,
            s.sold_price,
            COALESCE(( SELECT crh.cap_rate FROM cap_rate_history crh
                  WHERE crh.property_id = s.property_id AND crh.event_date = s.sale_date AND crh.event_type = 'sale'::cap_rate_event_type AND crh.cap_rate IS NOT NULL
                  ORDER BY crh.created_at DESC LIMIT 1),
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                    ELSE COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END) AS cap_rate,
            s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate, s.last_price, s.is_northmarq, s.had_price_change,
            s.buyer_type, s.buyer, s.on_market_date,
                CASE WHEN lower(s.buyer_type) ~~ '%reit%'::text THEN 'reit'::text
                    WHEN lower(s.buyer_type) ~~ '%cross%'::text OR lower(s.buyer_type) ~~ '%foreign%'::text THEN 'cross_border'::text
                    WHEN lower(s.buyer_type) ~~ '%institution%'::text OR lower(s.buyer_type) = 'fund'::text THEN 'institutional'::text
                    WHEN lower(s.buyer_type) = ANY (ARRAY['user'::text, 'user/owner'::text, 'owner'::text]) THEN 'user_owner'::text
                    WHEN lower(s.buyer_type) = ANY (ARRAY['private'::text, 'individual'::text, 'company'::text]) THEN 'private'::text
                    WHEN s.buyer ~* '\y(state of|county of|city of|federal government|gsa|general services administration)\y'::text THEN 'user_owner'::text
                    WHEN s.buyer ~* '\y(reit|realty trust|property trust|realty income|easterly|four corners|netstreit|exchangeright|agree realty|spirit realty|store capital|vereit|national retail|getty realty|alpine income|w\.? ?p\.? carey|wpc|office properties trust|opi|government properties trust)\y'::text THEN 'reit'::text
                    WHEN s.buyer ~* '\y(net lease.{0,15}fund|capital management|asset management|insurance|massmutual|metlife|northwestern mutual|sumitomo|smbc|smfg|teachers|pension|sovereign|trust company)\y'::text THEN 'institutional'::text
                    WHEN s.buyer ~* '\yleasing\s*(and|&)?\s*finance\y'::text THEN 'institutional'::text
                    WHEN s.buyer ~* '\y(opportunity fund|income fund|investment fund|real estate fund|reit fund)\y'::text THEN 'institutional'::text
                    ELSE 'private'::text END AS buyer_class,
                CASE WHEN s.on_market_date IS NOT NULL AND s.sale_date >= s.on_market_date THEN s.sale_date - s.on_market_date ELSE NULL::integer END AS days_on_market,
                CASE WHEN s.last_price IS NOT NULL AND s.last_price > 0::numeric THEN s.sold_price / s.last_price ELSE NULL::numeric END AS pct_of_ask_val,
                CASE WHEN s.last_cap_rate IS NOT NULL AND s.sold_cap_rate IS NOT NULL THEN abs(s.last_cap_rate - s.sold_cap_rate) ELSE NULL::numeric END AS bid_ask_spread_bps,
            ( SELECT l.firm_term_years FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date IS NOT NULL AND l.expiration_date >= s.sale_date AND (l.commencement_date IS NULL OR l.commencement_date <= s.sale_date)
                  ORDER BY l.expiration_date DESC LIMIT 1) AS firm_term_years,
            ( SELECT l.government_type FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date IS NOT NULL AND l.expiration_date >= s.sale_date AND (l.commencement_date IS NULL OR l.commencement_date <= s.sale_date)
                  ORDER BY l.expiration_date DESC LIMIT 1) AS government_type
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
        ), ttm_per_month AS (
         SELECT m_1.period_end, cs.sale_id, cs.property_id, cs.sale_date, cs.sale_month_end, cs.sale_quarter_end, cs.sold_price, cs.cap_rate,
            cs.sold_cap_rate, cs.last_cap_rate, cs.initial_cap_rate, cs.last_price, cs.is_northmarq, cs.had_price_change, cs.buyer_type, cs.buyer,
            cs.on_market_date, cs.buyer_class, cs.days_on_market, cs.pct_of_ask_val, cs.bid_ask_spread_bps, cs.firm_term_years, cs.government_type
           FROM month_anchors m_1 JOIN closed_sales cs ON cs.sale_date > (m_1.period_end - '1 year'::interval)::date AND cs.sale_date <= m_1.period_end
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
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years >= 5::numeric AND ttm_per_month.firm_term_years < 10::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_5to10_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE ttm_per_month.firm_term_years IS NOT NULL AND ttm_per_month.firm_term_years > 0::numeric AND ttm_per_month.firm_term_years < 5::numeric AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_less5_year,
            avg(ttm_per_month.cap_rate) FILTER (WHERE (ttm_per_month.firm_term_years IS NULL OR ttm_per_month.firm_term_years <= 0::numeric) AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS cap_outside_firm,
            avg(ttm_per_month.cap_rate) FILTER (WHERE lower(ttm_per_month.government_type) = 'federal'::text AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS federal_cap,
            avg(ttm_per_month.cap_rate) FILTER (WHERE lower(ttm_per_month.government_type) = 'state'::text AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS state_cap,
            avg(ttm_per_month.cap_rate) FILTER (WHERE (lower(ttm_per_month.government_type) = ANY (ARRAY['municipal'::text, 'county'::text, 'city'::text, 'local'::text])) AND ttm_per_month.cap_rate >= 0.04 AND ttm_per_month.cap_rate <= 0.12) AS municipal_cap,
            avg(ttm_per_month.days_on_market) FILTER (WHERE ttm_per_month.days_on_market >= 0 AND ttm_per_month.days_on_market <= 1095) AS avg_dom,
            avg(ttm_per_month.pct_of_ask_val) FILTER (WHERE ttm_per_month.pct_of_ask_val >= 0.50 AND ttm_per_month.pct_of_ask_val <= 1.50) AS pct_of_ask,
            avg(ttm_per_month.bid_ask_spread_bps) FILTER (WHERE ttm_per_month.bid_ask_spread_bps IS NOT NULL) AS avg_bid_ask_spread,
            avg(ttm_per_month.last_cap_rate) FILTER (WHERE ttm_per_month.last_cap_rate >= 0.04 AND ttm_per_month.last_cap_rate <= 0.12) AS avg_last_ask_cap,
            count(*) FILTER (WHERE ttm_per_month.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_per_month.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change_bid_ask,
            sum(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.buyer_class = 'reit'::text) AS reit_volume,
            sum(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.buyer_class = 'cross_border'::text) AS cross_border_volume,
            sum(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.buyer_class = 'institutional'::text) AS institutional_volume,
            sum(ttm_per_month.sold_price) FILTER (WHERE ttm_per_month.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_volume,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'reit'::text) AS reit_count,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'cross_border'::text) AS cross_border_count,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'institutional'::text) AS institutional_count,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_count,
            count(*) FILTER (WHERE ttm_per_month.buyer_class = 'user_owner'::text) AS user_owner_count
           FROM ttm_per_month GROUP BY ttm_per_month.period_end
        ),
        -- Round 68-C: deduped confirmed-event aggregates drive count/volume only.
        ev_ttm AS (
         SELECT m.period_end, count(*) AS ev_count_ttm,
            avg(ev.event_price) FILTER (WHERE ev.event_price >= 100000::numeric AND ev.event_price <= 200000000::numeric) AS ev_avg_deal,
            sum(ev.event_price) AS ev_confirmed_vol,
            count(*)::numeric * avg(ev.event_price) FILTER (WHERE ev.event_price >= 100000::numeric AND ev.event_price <= 200000000::numeric) AS ev_ttm_volume
           FROM month_anchors m
             JOIN cm_gov_confirmed_events_m ev ON ev.event_date > (m.period_end - '1 year'::interval)::date AND ev.event_date <= m.period_end
          GROUP BY m.period_end
        ), ev_month AS (
         SELECT sale_month_end AS period_end, count(*) AS m_count, sum(event_price) AS m_vol FROM cm_gov_confirmed_events_m GROUP BY sale_month_end
        ), ev_quarter AS (
         SELECT sale_quarter_end AS quarter_end, count(*) AS q_count, sum(event_price) AS q_vol FROM cm_gov_confirmed_events_m GROUP BY sale_quarter_end
        )
 SELECT m.period_end,
    to_char(m.period_end::timestamp with time zone, '"Q"Q-YYYY'::text) AS fiscal_quarter,
    'all'::text AS subspecialty,
    ev.ev_count_ttm AS transaction_count_ttm,
    ev.ev_count_ttm AS transaction_count_ttm_no_sumitomo,
    ev.ev_avg_deal AS avg_deal_size,
    ev.ev_ttm_volume AS ttm_volume,
    ev.ev_ttm_volume AS ttm_volume_alt,
        CASE WHEN lag(ev.ev_ttm_volume, 12) OVER w > 0::numeric THEN (ev.ev_ttm_volume - lag(ev.ev_ttm_volume, 12) OVER w) / lag(ev.ev_ttm_volume, 12) OVER w ELSE NULL::numeric END AS yoy_change_pct,
    evq.q_vol AS quarterly_volume,
    evq.q_count AS quarterly_count,
    COALESCE(evm.m_vol, 0::numeric) AS monthly_volume,
    COALESCE(evm.m_count, 0::bigint) AS monthly_count,
        CASE WHEN ta.ttm_count >= 10 THEN ta.upper_quartile_cap ELSE NULL::double precision END AS upper_quartile_cap_ttm,
        CASE WHEN ta.ttm_count >= 10 THEN ta.lower_quartile_cap ELSE NULL::double precision END AS lower_quartile_cap_ttm,
        CASE WHEN ta.ttm_count >= 10 THEN ta.ttm_avg_cap_rate ELSE NULL::numeric END AS avg_cap_rate_ttm,
    ta.nm_avg_cap_ttm, ta.non_nm_avg_cap_ttm, ta.cap_10plus_year, ta.cap_5to10_year, ta.cap_less5_year, ta.cap_outside_firm,
    ta.federal_cap, ta.state_cap, ta.municipal_cap, ta.avg_dom, ta.pct_of_ask, ta.avg_bid_ask_spread, ta.avg_last_ask_cap, ta.pct_price_change_bid_ask,
    ta.private_volume, ta.reit_volume, ta.cross_border_volume, ta.institutional_volume,
    ta.private_count, ta.reit_count, ta.cross_border_count, ta.institutional_count, ta.user_owner_count,
    mr.treasury_10y_yield, mr.fed_funds_rate, mr.mortgage_30y_rate, mr.cpi_index, mr.unemployment_rate,
    lc.low_loan_constant, lc.high_loan_constant,
        CASE WHEN ta.ttm_count >= 10 THEN ta.median_quartile_cap ELSE NULL::double precision END AS median_quartile_cap_ttm,
    ev.ev_confirmed_vol AS ttm_volume_confirmed   -- NEW: sum(sold_price) deduped audit floor
   FROM month_anchors m
     LEFT JOIN ttm_agg ta ON ta.period_end = m.period_end
     LEFT JOIN ev_ttm ev ON ev.period_end = m.period_end
     LEFT JOIN ev_month evm ON evm.period_end = m.period_end
     LEFT JOIN ev_quarter evq ON evq.quarter_end = (date_trunc('quarter'::text, m.period_end::timestamp with time zone) + '3 mons -1 days'::interval)::date
     LEFT JOIN cm_gov_macro_rates_m mr ON mr.period_end = m.period_end
     LEFT JOIN cm_gov_loan_constant_m lc ON lc.period_end = m.period_end
  WINDOW w AS (ORDER BY m.period_end)
  ORDER BY m.period_end;

-- ===========================================================================
-- 4. cm_gov_market_quarterly (quarterly, multi-subspecialty) -- override the
--    'all' count/volume/avg columns from the deduped quarterly roll-up; every
--    per-agency subspecialty row and all cap/buyer columns are unchanged.
-- ===========================================================================
CREATE OR REPLACE VIEW public.cm_gov_market_quarterly AS
WITH orig AS (
 WITH closed_sales AS (
         SELECT s.sale_id, s.sale_date,
            (date_trunc('quarter'::text, s.sale_date::timestamp with time zone) + '3 mons -1 days'::interval)::date AS period_end,
            s.agency, s.government_type, s.sold_price,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS sold_cap_rate,
            s.is_northmarq, s.firm_term_years, s.buyer_type, s.buyer, s.days_on_market, s.pct_of_initial, s.bid_ask_spread, s.had_price_change
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND s.sale_date <= cm_last_completed_quarter_end()
        ), classified AS (
         SELECT cs.sale_id, cs.sale_date, cs.period_end, cs.agency, cs.government_type, cs.sold_price, cs.sold_cap_rate, cs.is_northmarq,
            cs.firm_term_years, cs.buyer_type, cs.buyer, cs.days_on_market, cs.pct_of_initial, cs.bid_ask_spread, cs.had_price_change,
                CASE WHEN lower(cs.buyer_type) ~~ '%reit%'::text THEN 'reit'::text
                    WHEN lower(cs.buyer_type) ~~ '%cross%'::text OR lower(cs.buyer_type) ~~ '%foreign%'::text THEN 'cross_border'::text
                    WHEN lower(cs.buyer_type) ~~ '%institution%'::text OR lower(cs.buyer_type) = 'fund'::text THEN 'institutional'::text
                    WHEN lower(cs.buyer_type) = ANY (ARRAY['user'::text, 'user/owner'::text, 'owner'::text]) THEN 'user_owner'::text
                    WHEN lower(cs.buyer_type) = ANY (ARRAY['private'::text, 'individual'::text, 'company'::text]) THEN 'private'::text
                    WHEN cs.buyer ~* '\y(state of|county of|city of|federal government|gsa|general services administration)\y'::text THEN 'user_owner'::text
                    WHEN cs.buyer ~* '\y(reit|realty trust|property trust|realty income|easterly|four corners|netstreit|exchangeright|agree realty|spirit realty|store capital|vereit|national retail|getty realty|alpine income|w\.? ?p\.? carey|wpc|office properties trust|opi|government properties trust)\y'::text THEN 'reit'::text
                    WHEN cs.buyer ~* '\y(net lease.{0,15}fund|capital management|asset management|insurance|massmutual|metlife|northwestern mutual|sumitomo|smbc|smfg|teachers|pension|sovereign|trust company)\y'::text THEN 'institutional'::text
                    WHEN cs.buyer ~* '\yleasing\s*(and|&)?\s*finance\y'::text THEN 'institutional'::text
                    WHEN cs.buyer ~* '\y(opportunity fund|income fund|investment fund|real estate fund|reit fund)\y'::text THEN 'institutional'::text
                    ELSE 'private'::text END AS buyer_class
           FROM closed_sales cs
        ), expanded AS (
         SELECT 'all'::text AS subspecialty, c.sale_id, c.sale_date, c.period_end, c.agency, c.government_type, c.sold_price, c.sold_cap_rate, c.is_northmarq, c.firm_term_years, c.buyer_type, c.buyer, c.days_on_market, c.pct_of_initial, c.bid_ask_spread, c.had_price_change, c.buyer_class FROM classified c
        UNION ALL
         SELECT lower(c.agency) AS subspecialty, c.sale_id, c.sale_date, c.period_end, c.agency, c.government_type, c.sold_price, c.sold_cap_rate, c.is_northmarq, c.firm_term_years, c.buyer_type, c.buyer, c.days_on_market, c.pct_of_initial, c.bid_ask_spread, c.had_price_change, c.buyer_class FROM classified c WHERE c.agency IS NOT NULL AND TRIM(BOTH FROM c.agency) <> ''::text
        ), quarterly_base AS (
         SELECT expanded.period_end, expanded.subspecialty, count(*) AS transaction_count, sum(expanded.sold_price) AS quarterly_volume, avg(expanded.sold_price) AS avg_deal_size,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL) AS cap_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND expanded.firm_term_years > 10::numeric) AS cap_10plus_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND expanded.firm_term_years > 5::numeric AND expanded.firm_term_years <= 10::numeric) AS cap_6to10_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND expanded.firm_term_years IS NOT NULL AND expanded.firm_term_years <= 5::numeric) AS cap_less5_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND expanded.firm_term_years IS NULL) AS cap_outside_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND lower(expanded.government_type) = 'federal'::text) AS fed_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND lower(expanded.government_type) = 'state'::text) AS state_n,
            count(*) FILTER (WHERE expanded.sold_cap_rate IS NOT NULL AND lower(expanded.government_type) = 'municipal'::text) AS muni_n,
            avg(expanded.sold_cap_rate) AS avg_cap_raw,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (expanded.sold_cap_rate::double precision)) AS upper_quartile_raw,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (expanded.sold_cap_rate::double precision)) AS lower_quartile_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE expanded.is_northmarq) AS nm_cap_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE NOT expanded.is_northmarq) AS non_nm_cap_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE expanded.firm_term_years > 10::numeric) AS cap_10plus_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE expanded.firm_term_years > 5::numeric AND expanded.firm_term_years <= 10::numeric) AS cap_6to10_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE expanded.firm_term_years IS NOT NULL AND expanded.firm_term_years <= 5::numeric) AS cap_less5_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE expanded.firm_term_years IS NULL) AS cap_outside_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE lower(expanded.government_type) = 'federal'::text) AS fed_cap_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE lower(expanded.government_type) = 'state'::text) AS state_cap_raw,
            avg(expanded.sold_cap_rate) FILTER (WHERE lower(expanded.government_type) = 'municipal'::text) AS muni_cap_raw,
            sum(expanded.sold_price) FILTER (WHERE expanded.buyer_class = 'reit'::text) AS reit_volume,
            sum(expanded.sold_price) FILTER (WHERE expanded.buyer_class = 'cross_border'::text) AS cross_border_volume,
            sum(expanded.sold_price) FILTER (WHERE expanded.buyer_class = 'institutional'::text) AS institutional_volume,
            sum(expanded.sold_price) FILTER (WHERE expanded.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_volume,
            count(*) FILTER (WHERE expanded.buyer_class = 'reit'::text) AS reit_count,
            count(*) FILTER (WHERE expanded.buyer_class = 'cross_border'::text) AS cross_border_count,
            count(*) FILTER (WHERE expanded.buyer_class = 'institutional'::text) AS institutional_count,
            count(*) FILTER (WHERE expanded.buyer_class = ANY (ARRAY['private'::text, 'user_owner'::text])) AS private_count,
            avg(expanded.days_on_market::numeric)::integer AS avg_dom, avg(expanded.pct_of_initial) AS pct_of_ask, avg(expanded.bid_ask_spread) AS avg_bid_ask_spread,
            count(*) FILTER (WHERE expanded.had_price_change)::numeric / NULLIF(count(*), 0)::numeric AS pct_price_change
           FROM expanded GROUP BY expanded.period_end, expanded.subspecialty
        ), guarded AS (
         SELECT quarterly_base.period_end, quarterly_base.subspecialty, quarterly_base.transaction_count, quarterly_base.quarterly_volume, quarterly_base.avg_deal_size,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.avg_cap_raw ELSE NULL::numeric END AS avg_cap_rate,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.upper_quartile_raw ELSE NULL::double precision END AS upper_quartile_cap,
                CASE WHEN quarterly_base.cap_n >= 3 THEN quarterly_base.lower_quartile_raw ELSE NULL::double precision END AS lower_quartile_cap,
                CASE WHEN quarterly_base.cap_10plus_n >= 3 THEN quarterly_base.cap_10plus_raw ELSE NULL::numeric END AS cap_10plus_year,
                CASE WHEN quarterly_base.cap_6to10_n >= 3 THEN quarterly_base.cap_6to10_raw ELSE NULL::numeric END AS cap_6to10_year,
                CASE WHEN quarterly_base.cap_less5_n >= 3 THEN quarterly_base.cap_less5_raw ELSE NULL::numeric END AS cap_less5_year,
                CASE WHEN quarterly_base.cap_outside_n >= 3 THEN quarterly_base.cap_outside_raw ELSE NULL::numeric END AS cap_outside_firm,
                CASE WHEN quarterly_base.fed_n >= 3 THEN quarterly_base.fed_cap_raw ELSE NULL::numeric END AS federal_cap,
                CASE WHEN quarterly_base.state_n >= 3 THEN quarterly_base.state_cap_raw ELSE NULL::numeric END AS state_cap,
                CASE WHEN quarterly_base.muni_n >= 3 THEN quarterly_base.muni_cap_raw ELSE NULL::numeric END AS municipal_cap,
            quarterly_base.nm_cap_raw AS nm_avg_cap, quarterly_base.non_nm_cap_raw AS non_nm_avg_cap,
            quarterly_base.private_volume, quarterly_base.reit_volume, quarterly_base.cross_border_volume, quarterly_base.institutional_volume,
            quarterly_base.private_count, quarterly_base.reit_count, quarterly_base.cross_border_count, quarterly_base.institutional_count,
            quarterly_base.avg_dom, quarterly_base.pct_of_ask, quarterly_base.avg_bid_ask_spread, quarterly_base.pct_price_change
           FROM quarterly_base
        ), with_ttm AS (
         SELECT g.period_end, g.subspecialty, g.transaction_count, g.quarterly_volume, g.avg_deal_size, g.avg_cap_rate, g.upper_quartile_cap, g.lower_quartile_cap,
            g.cap_10plus_year, g.cap_6to10_year, g.cap_less5_year, g.cap_outside_firm, g.federal_cap, g.state_cap, g.municipal_cap, g.nm_avg_cap, g.non_nm_avg_cap,
            g.private_volume, g.reit_volume, g.cross_border_volume, g.institutional_volume, g.private_count, g.reit_count, g.cross_border_count, g.institutional_count,
            g.avg_dom, g.pct_of_ask, g.avg_bid_ask_spread, g.pct_price_change,
            sum(g.quarterly_volume) OVER w_ttm AS ttm_volume, sum(g.transaction_count) OVER w_ttm AS ttm_count
           FROM guarded g WINDOW w_ttm AS (PARTITION BY g.subspecialty ORDER BY g.period_end ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
        )
 SELECT period_end, to_char(period_end::timestamp with time zone, '"Q"Q-YYYY'::text) AS fiscal_quarter, subspecialty,
    ttm_volume, ttm_count, quarterly_volume, transaction_count, avg_deal_size, avg_cap_rate, upper_quartile_cap, lower_quartile_cap, nm_avg_cap, non_nm_avg_cap,
    cap_10plus_year, cap_6to10_year, cap_less5_year, cap_outside_firm, federal_cap, state_cap, municipal_cap,
    private_volume, reit_volume, cross_border_volume, institutional_volume, private_count, reit_count, cross_border_count, institutional_count,
    avg_dom, pct_of_ask, avg_bid_ask_spread, pct_price_change
   FROM with_ttm
), eff AS (
  SELECT o.*,
    CASE WHEN o.subspecialty='all' THEN evq.ttm_count    ELSE o.ttm_count          END AS eff_ttm_count,
    CASE WHEN o.subspecialty='all' THEN evq.ttm_volume   ELSE o.ttm_volume         END AS eff_ttm_volume,
    CASE WHEN o.subspecialty='all' THEN evq.q_vol        ELSE o.quarterly_volume   END AS eff_quarterly_volume,
    CASE WHEN o.subspecialty='all' THEN evq.q_count      ELSE o.transaction_count  END AS eff_transaction_count,
    CASE WHEN o.subspecialty='all' THEN evq.ttm_avg_deal ELSE o.avg_deal_size      END AS eff_avg_deal_size
  FROM orig o LEFT JOIN cm_gov_confirmed_events_ttm_q evq ON evq.period_end = o.period_end
)
SELECT period_end, fiscal_quarter, subspecialty,
  eff_ttm_volume AS ttm_volume, eff_ttm_count AS ttm_count, eff_quarterly_volume AS quarterly_volume,
  eff_transaction_count AS transaction_count, eff_avg_deal_size AS avg_deal_size,
  avg_cap_rate, upper_quartile_cap, lower_quartile_cap, nm_avg_cap, non_nm_avg_cap,
  cap_10plus_year, cap_6to10_year, cap_less5_year, cap_outside_firm, federal_cap, state_cap, municipal_cap,
  private_volume, reit_volume, cross_border_volume, institutional_volume, private_count, reit_count, cross_border_count, institutional_count,
  avg_dom, pct_of_ask, avg_bid_ask_spread, pct_price_change,
  CASE WHEN lag(eff_ttm_volume,4) OVER w > 0::numeric THEN (eff_ttm_volume - lag(eff_ttm_volume,4) OVER w)/lag(eff_ttm_volume,4) OVER w ELSE NULL::numeric END AS yoy_change_pct
FROM eff
WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end);

-- ---------------------------------------------------------------------------
-- 5. Refresh the materialized mirror so count_ttm_m / volume_ttm_m / avg_deal_m
--    (which read the _mat) reflect the deduped basis. The existing refresh cron
--    keeps it current going forward.
-- ---------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.cm_gov_market_quarterly_master_m_mat;
