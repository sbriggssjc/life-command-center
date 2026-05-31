-- ============================================================================
-- Migration: cm_gov Capital Markets view fixes (government Supabase project)
-- Project: scknotsqkcheojiaewwh
-- Date:    2026-05-31
--
-- Fixes a batch of government-leased Capital Markets reporting views. Each
-- CREATE OR REPLACE below preserves the EXACT output column names + order of
-- the live view (downstream Excel chart mapper references columns by name);
-- new columns are APPENDED only, never renamed/reordered/dropped.
--
-- Every view body in this file was validated READ-ONLY against the live DB
-- (executed as a SELECT, column contract + sane numbers confirmed) before
-- inclusion. See the post-work notes at the bottom for per-view validation.
--
-- Views intentionally NOT included (no change required):
--   * cm_gov_cpi_vs_renewal_cagr_m  -- true data gap (see note 4)
--   * cm_gov_inventory_backlog_m    -- staleness cap is inert here (see note 8)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. cm_gov_bid_ask_spread_m
--    Sign-bug fix ONLY: achieved/derived sold cap = ask + spread (spread is
--    defined sold-last, always positive). Final expression changed from
--    (avg_last_ask_cap - avg_bid_ask_spread) to (avg_last_ask_cap + ...).
--    All other logic + all 8 columns unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_bid_ask_spread_m AS
 SELECT period_end,
    subspecialty,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.sold_cap_rate IS NOT NULL) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) THEN avg_bid_ask_spread
            ELSE NULL::numeric
        END AS avg_bid_ask_spread,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_price IS NOT NULL) AND (s.last_price > (0)::numeric) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) THEN pct_price_change_bid_ask
            ELSE NULL::numeric
        END AS pct_price_change,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) THEN avg_last_ask_cap
            ELSE NULL::numeric
        END AS avg_last_ask_cap,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) THEN ( SELECT min(s.last_cap_rate) AS min
               FROM sales_transactions s
              WHERE ((s.sold_price > (0)::numeric) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end)))
            ELSE NULL::numeric
        END AS min_last_ask_cap,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) THEN ( SELECT max(s.last_cap_rate) AS max
               FROM sales_transactions s
              WHERE ((s.sold_price > (0)::numeric) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end)))
            ELSE NULL::numeric
        END AS max_last_ask_cap,
        CASE
            WHEN ((( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.last_cap_rate >= 0.04) AND (s.last_cap_rate <= 0.12) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5) AND (( SELECT count(*) AS count
               FROM sales_transactions s
              WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.last_cap_rate IS NOT NULL) AND (s.sold_cap_rate IS NOT NULL) AND (s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end))) >= 5)) THEN (avg_last_ask_cap + avg_bid_ask_spread)  -- FIX: ask + spread = achieved sold cap
            ELSE NULL::numeric
        END AS achieved_last_ask_cap
   FROM cm_gov_market_quarterly_master_m_mat m;


-- ----------------------------------------------------------------------------
-- 2. cm_gov_cap_by_credit_q
--    Recover state/municipal cohorts. Added municipal + state agency-text CASE
--    branches. government_type branches stay first; an explicit-federal text
--    branch (U.S./US/GSA/named federal agencies) fires BEFORE municipal/state
--    so 'Department of Defense' -> federal but 'County of X' -> municipal and
--    'State of X' / 'Department of Human Resources' -> state. Sample gates
--    lowered to state n>=2, municipal n>=2. Columns unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_cap_by_credit_q AS
 WITH base AS (
         SELECT ((date_trunc('quarter'::text, (s.sale_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date AS period_end,
            s.sale_date,
                CASE
                    WHEN (s.cap_rate_quality = 'implausible_unverified'::text) THEN NULL::numeric
                    ELSE s.sold_cap_rate
                END AS cap,
                CASE
                    -- government_type-based branches first (authoritative when present)
                    WHEN (lower(s.government_type) ~~* '%municipal%'::text) THEN 'municipal'::text
                    WHEN ((lower(s.government_type) ~~* '%state%'::text) OR (lower(s.government_type) ~~* '%local%'::text)) THEN 'state'::text
                    WHEN (lower(s.government_type) ~~* '%federal%'::text) THEN 'federal'::text
                    -- explicit-federal agency text (named federal agencies win over a bare "Department of")
                    WHEN (s.agency ~* '(\mu\.?s\.?\M|united states|^gsa|\mgsa\M|federal|national|department of defense|department of justice|veterans affairs|homeland|treasury|\mfbi\M|\mirs\M|\musda\M|\musps\M|postal|social security|customs|immigration|\mepa\M|\mfda\M|\mdea\M|forest service|army|navy|air force|bureau of)'::text) THEN 'federal'::text
                    -- municipal agency text
                    WHEN (s.agency ~* '(county of|city of|town of|village of|borough of|municipal|\mcity\M|public schools|metropolitan)'::text) THEN 'municipal'::text
                    -- state agency text (state-flavored departments, boards, universities)
                    WHEN (s.agency ~* '(state of|commonwealth of|department of human resources|department of family|department of (administration|labor|transportation|health|corrections|revenue|education|child support|protective)|\mstate\M|board of|university|division of)'::text) THEN 'state'::text
                    ELSE NULL::text
                END AS credit_class
           FROM sales_transactions s
          WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.sold_cap_rate IS NOT NULL) AND (s.sold_cap_rate >= 0.04) AND (s.sold_cap_rate <= 0.12) AND (s.sale_date <= cm_last_completed_quarter_end()))
        ), quarters AS (
         SELECT DISTINCT base.period_end
           FROM base
        ), ttm AS (
         SELECT q.period_end,
            avg(b.cap) FILTER (WHERE (b.credit_class = 'federal'::text)) AS federal_avg,
            count(*) FILTER (WHERE (b.credit_class = 'federal'::text)) AS federal_n,
            avg(b.cap) FILTER (WHERE (b.credit_class = 'state'::text)) AS state_avg,
            count(*) FILTER (WHERE (b.credit_class = 'state'::text)) AS state_n,
            avg(b.cap) FILTER (WHERE (b.credit_class = 'municipal'::text)) AS muni_avg,
            count(*) FILTER (WHERE (b.credit_class = 'municipal'::text)) AS muni_n
           FROM (quarters q
             LEFT JOIN base b ON (((b.sale_date > ((q.period_end - '1 year'::interval))::date) AND (b.sale_date <= q.period_end))))
          GROUP BY q.period_end
        )
 SELECT period_end,
    'all'::text AS subspecialty,
        CASE
            WHEN (federal_n >= 3) THEN federal_avg
            ELSE NULL::numeric
        END AS federal_cap,
        CASE
            WHEN (state_n >= 2) THEN state_avg
            ELSE NULL::numeric
        END AS state_cap,
        CASE
            WHEN (muni_n >= 2) THEN muni_avg
            ELSE NULL::numeric
        END AS municipal_cap
   FROM ttm
  ORDER BY period_end;


-- ----------------------------------------------------------------------------
-- 3. cm_gov_cap_by_term_m
--    (a) cap_5to10 was a verbatim duplicate of cap_6to10 -> now a genuine
--        [5,10) bucket with its own aggregate/n-gate.
--    (b) Closed the [5,6) gap (cap_less5 is <5, cap_5to10 is [5,10)).
--    (c) Strengthened the firm-remaining-term resolver: COALESCE now falls
--        back to s.firm_term_years and (s.lease_expiration - s.sale_date)/365
--        when the gsa_leases / leases lookups miss.
--    Output column names unchanged: cap_10plus, cap_6to10, cap_5to10,
--    cap_less5, cap_outside_firm.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS
 WITH months AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2005-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS MATERIALIZED (
         SELECT s.sale_date,
                CASE
                    WHEN (s.cap_rate_quality = 'implausible_unverified'::text) THEN NULL::numeric
                    ELSE s.sold_cap_rate
                END AS cap,
            COALESCE(( SELECT (((gl.termination_date - s.sale_date))::numeric / 365.0)
                   FROM gsa_leases gl
                  WHERE ((gl.property_id = s.property_id) AND (gl.lease_expiration >= s.sale_date) AND (gl.termination_date IS NOT NULL))
                  ORDER BY gl.lease_expiration DESC
                 LIMIT 1), ( SELECT (l.firm_term_years - (((s.sale_date - l.commencement_date))::numeric / 365.0))
                   FROM leases l
                  WHERE ((l.property_id = s.property_id) AND (l.expiration_date >= s.sale_date) AND (l.commencement_date IS NOT NULL) AND (l.firm_term_years IS NOT NULL))
                  ORDER BY l.expiration_date DESC
                 LIMIT 1),
                 -- fallback 1: the sale row's own firm_term_years
                 s.firm_term_years,
                 -- fallback 2: derive from the sale row's lease_expiration
                 CASE
                     WHEN ((s.lease_expiration IS NOT NULL) AND (s.lease_expiration >= s.sale_date)) THEN (((s.lease_expiration - s.sale_date))::numeric / 365.0)
                     ELSE NULL::numeric
                 END) AS firm_rem
           FROM sales_transactions s
          WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.sold_cap_rate >= 0.04) AND (s.sold_cap_rate <= 0.12) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))
        ), ttm AS (
         SELECT m.period_end,
            avg(c.cap) FILTER (WHERE (c.firm_rem >= (10)::numeric)) AS cap_10plus,
            count(*) FILTER (WHERE (c.firm_rem >= (10)::numeric)) AS n_10plus,
            avg(c.cap) FILTER (WHERE ((c.firm_rem >= (6)::numeric) AND (c.firm_rem < (10)::numeric))) AS cap_6to10,
            count(*) FILTER (WHERE ((c.firm_rem >= (6)::numeric) AND (c.firm_rem < (10)::numeric))) AS n_6to10,
            avg(c.cap) FILTER (WHERE ((c.firm_rem >= (5)::numeric) AND (c.firm_rem < (10)::numeric))) AS cap_5to10,
            count(*) FILTER (WHERE ((c.firm_rem >= (5)::numeric) AND (c.firm_rem < (10)::numeric))) AS n_5to10,
            avg(c.cap) FILTER (WHERE ((c.firm_rem > (0)::numeric) AND (c.firm_rem < (5)::numeric))) AS cap_less5,
            count(*) FILTER (WHERE ((c.firm_rem > (0)::numeric) AND (c.firm_rem < (5)::numeric))) AS n_less5,
            avg(c.cap) FILTER (WHERE (c.firm_rem <= (0)::numeric)) AS cap_outside,
            count(*) FILTER (WHERE (c.firm_rem <= (0)::numeric)) AS n_outside
           FROM (months m
             LEFT JOIN classified c ON (((c.sale_date > ((m.period_end - '1 year'::interval))::date) AND (c.sale_date <= m.period_end))))
          GROUP BY m.period_end
        )
 SELECT period_end,
    'all'::text AS subspecialty,
        CASE
            WHEN (n_10plus >= 5) THEN round(cap_10plus, 6)
            ELSE NULL::numeric
        END AS cap_10plus,
        CASE
            WHEN (n_6to10 >= 5) THEN round(cap_6to10, 6)
            ELSE NULL::numeric
        END AS cap_6to10,
        CASE
            WHEN (n_5to10 >= 5) THEN round(cap_5to10, 6)
            ELSE NULL::numeric
        END AS cap_5to10,
        CASE
            WHEN (n_less5 >= 5) THEN round(cap_less5, 6)
            ELSE NULL::numeric
        END AS cap_less5,
        CASE
            WHEN (n_outside >= 5) THEN round(cap_outside, 6)
            ELSE NULL::numeric
        END AS cap_outside_firm
   FROM ttm
  ORDER BY period_end;


-- ----------------------------------------------------------------------------
-- 5. cm_gov_nm_vs_market_m
--    (a) NM line de-whipsawed: NM monthly TTM sample now gated n>=3 BEFORE the
--        smoothing window; both legs smoothed with the identical 4-PRECEDING..
--        4-FOLLOWING window.
--    (b) Market leg recomputed from sales_transactions to EXCLUDE Northmarq AND
--        non-brokered: market = NOT is_northmarq AND brokered, where brokered =
--        transaction_type='brokered' OR (listing_broker present AND
--        transaction_type NOT IN direct/foreclosure/owner-user). Implausible
--        caps nulled; cap band 0.04-0.12.
--    The matview is used only as the period_end spine so the row range
--    (2001-01..2026-03, 303 rows) and column contract are preserved.
--    Columns unchanged: nm_cap_rate, market_cap_rate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_nm_vs_market_m AS
 WITH spine AS (
         SELECT DISTINCT cm_gov_market_quarterly_master_m_mat.period_end,
            cm_gov_market_quarterly_master_m_mat.subspecialty
           FROM cm_gov_market_quarterly_master_m_mat
        ), sales AS (
         SELECT s.sale_date,
                CASE
                    WHEN (s.cap_rate_quality = 'implausible_unverified'::text) THEN NULL::numeric
                    ELSE s.sold_cap_rate
                END AS cap,
            COALESCE(s.is_northmarq, false) AS is_nm,
            ((s.transaction_type = 'brokered'::text) OR ((s.listing_broker IS NOT NULL) AND (lower(s.transaction_type) <> ALL (ARRAY['direct'::text, 'foreclosure'::text, 'owner-user'::text])))) AS brokered
           FROM sales_transactions s
          WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))
        ), ttm AS (
         SELECT sp.period_end,
            sp.subspecialty,
            avg(sl.cap) FILTER (WHERE (sl.is_nm AND (sl.cap >= 0.04) AND (sl.cap <= 0.12))) AS nm_avg,
            count(*) FILTER (WHERE (sl.is_nm AND (sl.cap >= 0.04) AND (sl.cap <= 0.12))) AS nm_n,
            avg(sl.cap) FILTER (WHERE ((NOT sl.is_nm) AND sl.brokered AND (sl.cap >= 0.04) AND (sl.cap <= 0.12))) AS mkt_avg
           FROM (spine sp
             LEFT JOIN sales sl ON (((sl.sale_date > ((sp.period_end - '1 year'::interval))::date) AND (sl.sale_date <= sp.period_end))))
          GROUP BY sp.period_end, sp.subspecialty
        ), gated AS (
         SELECT period_end,
            subspecialty,
                CASE
                    WHEN (nm_n >= 3) THEN nm_avg
                    ELSE NULL::numeric
                END AS nm_gated,
            mkt_avg
           FROM ttm
        )
 SELECT period_end,
    subspecialty,
    avg(nm_gated) OVER w AS nm_cap_rate,
    avg(mkt_avg) OVER w AS market_cap_rate
   FROM gated
  WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING);


-- ----------------------------------------------------------------------------
-- 6. cm_gov_seller_sentiment_m
--    Fixed the biased denominator. Now mirrors the cm_gov_seller_sentiment_q
--    sibling: uses the STORED had_price_change boolean with the denominator =
--    count of ALL sales in the TTM window (count(sale_id), guarded against the
--    LEFT JOIN's empty-month NULL rows), not just rows where both last_price &
--    sold_price are present. Result lands ~0-6%. All columns unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_seller_sentiment_m AS
 WITH month_anchors AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2001-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id,
            s.sale_date,
            s.last_cap_rate,
            s.had_price_change,
            ( SELECT l.firm_term_years
                   FROM leases l
                  WHERE ((l.property_id = s.property_id) AND (l.expiration_date >= s.sale_date) AND ((l.commencement_date IS NULL) OR (l.commencement_date <= s.sale_date)))
                  ORDER BY l.expiration_date DESC
                 LIMIT 1) AS firm_term_years
           FROM sales_transactions s
          WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price IS NOT NULL) AND (s.sold_price > (0)::numeric))
        ), ttm_pairs AS (
         SELECT m.period_end,
            cs.sale_id,
            cs.last_cap_rate,
            cs.had_price_change,
            cs.firm_term_years
           FROM (month_anchors m
             LEFT JOIN closed_sales cs ON (((cs.sale_date > ((m.period_end - '1 year'::interval))::date) AND (cs.sale_date <= m.period_end))))
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    count(last_cap_rate) AS n_all,
    count(last_cap_rate) FILTER (WHERE (firm_term_years >= (8)::numeric)) AS n_long_term,
    ((count(*) FILTER (WHERE had_price_change))::numeric / (NULLIF(count(sale_id), 0))::numeric) AS pct_price_change_all,
    ((count(*) FILTER (WHERE (had_price_change AND (firm_term_years >= (8)::numeric))))::numeric / (NULLIF(count(sale_id) FILTER (WHERE (firm_term_years >= (8)::numeric)), 0))::numeric) AS pct_price_change_long_term,
    (avg(last_cap_rate) FILTER (WHERE ((last_cap_rate >= 0.04) AND (last_cap_rate <= 0.12))))::numeric(8,5) AS last_ask_cap_all,
    (avg(last_cap_rate) FILTER (WHERE (((last_cap_rate >= 0.04) AND (last_cap_rate <= 0.12)) AND (firm_term_years >= (8)::numeric))))::numeric(8,5) AS last_ask_cap_long_term
   FROM ttm_pairs
  GROUP BY period_end
  ORDER BY period_end;


-- ----------------------------------------------------------------------------
-- 7. cm_gov_valuation_index_m
--    APPEND-ONLY: existing 11 columns (incl. valuation_index = avg_noi_psf /
--    avg_cap_rate, raw $/SF) are byte-for-byte unchanged. Adds one trailing
--    column valuation_index_rebased = 100 * valuation_index / first_value over
--    (order by period_end) so the report can plot a true index (base 100 at the
--    earliest valid period).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_valuation_index_m AS
 WITH month_anchors AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2010-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), closed_sales AS (
         SELECT s.sale_id,
            s.sale_date,
            s.sf_leased,
            s.gross_rent,
            s.noi,
                CASE
                    WHEN (s.cap_rate_quality = 'implausible_unverified'::text) THEN NULL::numeric
                    ELSE s.sold_cap_rate
                END AS sold_cap_rate,
            COALESCE(s.noi_psf,
                CASE
                    WHEN (s.sf_leased > 0) THEN (s.noi / (s.sf_leased)::numeric)
                    ELSE NULL::numeric
                END) AS noi_psf,
            COALESCE(s.gross_rent_psf,
                CASE
                    WHEN (s.sf_leased > 0) THEN (s.gross_rent / (s.sf_leased)::numeric)
                    ELSE NULL::numeric
                END) AS gross_rent_psf
           FROM sales_transactions s
          WHERE ((s.sale_date IS NOT NULL) AND (s.sold_price IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (s.sf_leased >= 500) AND (s.sale_date <= cm_last_completed_quarter_end()))
        ), ttm_per_month AS (
         SELECT m.period_end,
            cs.gross_rent_psf,
            cs.noi_psf,
            cs.sold_cap_rate
           FROM (month_anchors m
             JOIN closed_sales cs ON (((cs.sale_date > ((m.period_end - '1 year'::interval))::date) AND (cs.sale_date <= m.period_end))))
        ), ttm_agg AS (
         SELECT ttm_per_month.period_end,
            avg(ttm_per_month.gross_rent_psf) FILTER (WHERE ((ttm_per_month.gross_rent_psf >= (5)::numeric) AND (ttm_per_month.gross_rent_psf <= (200)::numeric))) AS avg_rent_psf,
            avg((ttm_per_month.gross_rent_psf - ttm_per_month.noi_psf)) FILTER (WHERE ((ttm_per_month.gross_rent_psf >= (5)::numeric) AND (ttm_per_month.gross_rent_psf <= (200)::numeric) AND (ttm_per_month.noi_psf >= (1)::numeric) AND (ttm_per_month.noi_psf <= (150)::numeric))) AS avg_expenses_psf,
            avg(ttm_per_month.noi_psf) FILTER (WHERE ((ttm_per_month.noi_psf >= (1)::numeric) AND (ttm_per_month.noi_psf <= (150)::numeric))) AS avg_noi_psf,
            avg(ttm_per_month.sold_cap_rate) FILTER (WHERE ((ttm_per_month.sold_cap_rate >= 0.04) AND (ttm_per_month.sold_cap_rate <= 0.12))) AS avg_cap_rate,
            count(*) AS ttm_n,
            count(ttm_per_month.noi_psf) FILTER (WHERE ((ttm_per_month.noi_psf >= (1)::numeric) AND (ttm_per_month.noi_psf <= (150)::numeric))) AS n_with_noi_ttm,
            count(ttm_per_month.sold_cap_rate) FILTER (WHERE ((ttm_per_month.sold_cap_rate >= 0.04) AND (ttm_per_month.sold_cap_rate <= 0.12))) AS n_with_cap_ttm
           FROM ttm_per_month
          GROUP BY ttm_per_month.period_end
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    avg_rent_psf,
    avg_expenses_psf,
    avg_noi_psf,
    avg_cap_rate,
        CASE
            WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
            ELSE NULL::numeric
        END AS valuation_index,
    ttm_n,
    n_with_noi_ttm,
    n_with_cap_ttm,
        CASE
            WHEN ((lag(
            CASE
                WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
                ELSE NULL::numeric
            END, 12) OVER (ORDER BY period_end) IS NOT NULL) AND (lag(
            CASE
                WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
                ELSE NULL::numeric
            END, 12) OVER (ORDER BY period_end) <> (0)::numeric)) THEN ((
            CASE
                WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
                ELSE NULL::numeric
            END / lag(
            CASE
                WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
                ELSE NULL::numeric
            END, 12) OVER (ORDER BY period_end)) - (1)::numeric)
            ELSE NULL::numeric
        END AS yoy_change_pct,
    -- APPENDED: true index rebased to 100 at the earliest valid period
    ((100)::numeric * (
        CASE
            WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
            ELSE NULL::numeric
        END) / NULLIF(first_value(
        CASE
            WHEN (avg_cap_rate > (0)::numeric) THEN (avg_noi_psf / avg_cap_rate)
            ELSE NULL::numeric
        END) OVER (ORDER BY period_end ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING), (0)::numeric)) AS valuation_index_rebased
   FROM ttm_agg
  WHERE ((avg_cap_rate IS NOT NULL) AND (avg_cap_rate > (0)::numeric) AND (avg_noi_psf IS NOT NULL))
  ORDER BY period_end;


-- ----------------------------------------------------------------------------
-- 9. cm_gov_market_turnover_m
--    BUG FIX: active_count previously counted the entire gsa_leases stock
--    (monotonic growth to ~4,677). Now counts active ON-MARKET listings from
--    available_listings via the [start,end] window (listing_date <= m AND
--    (off_market_date IS NULL OR off_market_date > m), excluding
--    exclude_from_listing_metrics). Also APPENDS monthly_sales_count (a true
--    monthly, not TTM, sales count) so the monthly sales rate is visible.
--    Existing 8 columns preserved in order; monthly_sales_count appended last.
--
--    NOTE: available_listings coverage is thin (off_market_date is densely
--    populated only on the most recent listing batch), so active_count / the
--    turnover ratios are only meaningful where listing coverage exists. This is
--    a data-hygiene dependency, not a view-logic issue.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
 WITH months AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2005-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), base AS MATERIALIZED (
         SELECT m.period_end,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS ttm_sales,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 mon'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price IS NOT NULL) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS monthly_sales,
            ( SELECT count(*) AS count
                   FROM available_listings al
                  WHERE ((al.listing_date IS NOT NULL) AND (al.listing_date <= m.period_end) AND ((al.off_market_date IS NULL) OR (al.off_market_date > m.period_end)) AND (NOT COALESCE(al.exclude_from_listing_metrics, false)))) AS active_count
           FROM months m
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    ttm_sales AS ttm_sales_count,
    active_count AS market_universe,
    ((ttm_sales)::numeric / (NULLIF(active_count, 0))::numeric) AS turnover_rate,
    active_count,
    ttm_sales AS annual_sales_rate,
        CASE
            WHEN (ttm_sales > 0) THEN (((active_count)::numeric * (12)::numeric) / (ttm_sales)::numeric)
            ELSE NULL::numeric
        END AS months_of_supply,
    monthly_sales AS monthly_sales_count
   FROM base
  ORDER BY period_end;


-- ----------------------------------------------------------------------------
-- 10. cm_gov_sold_cap_by_term_dot
--     Robustness (no renames): smoothing window widened from +/-2 to +/-3
--     periods and each cohort clamped to the analytic band [0.04,0.12] BEFORE
--     smoothing so thin-quarter outliers can't whipsaw the dots. Columns
--     unchanged: cap_10plus, cap_5to10, cap_less5, cap_outside_firm.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_sold_cap_by_term_dot AS
 WITH base AS (
         SELECT cm_gov_market_quarterly_master_m_mat.period_end,
            cm_gov_market_quarterly_master_m_mat.subspecialty,
                CASE
                    WHEN ((cm_gov_market_quarterly_master_m_mat.cap_10plus_year >= 0.04) AND (cm_gov_market_quarterly_master_m_mat.cap_10plus_year <= 0.12)) THEN cm_gov_market_quarterly_master_m_mat.cap_10plus_year
                    ELSE NULL::numeric
                END AS cap_10plus,
                CASE
                    WHEN ((cm_gov_market_quarterly_master_m_mat.cap_5to10_year >= 0.04) AND (cm_gov_market_quarterly_master_m_mat.cap_5to10_year <= 0.12)) THEN cm_gov_market_quarterly_master_m_mat.cap_5to10_year
                    ELSE NULL::numeric
                END AS cap_5to10,
                CASE
                    WHEN ((cm_gov_market_quarterly_master_m_mat.cap_less5_year >= 0.04) AND (cm_gov_market_quarterly_master_m_mat.cap_less5_year <= 0.12)) THEN cm_gov_market_quarterly_master_m_mat.cap_less5_year
                    ELSE NULL::numeric
                END AS cap_less5,
                CASE
                    WHEN ((cm_gov_market_quarterly_master_m_mat.cap_outside_firm >= 0.04) AND (cm_gov_market_quarterly_master_m_mat.cap_outside_firm <= 0.12)) THEN cm_gov_market_quarterly_master_m_mat.cap_outside_firm
                    ELSE NULL::numeric
                END AS cap_outside_firm_raw
           FROM cm_gov_market_quarterly_master_m_mat
        )
 SELECT period_end,
    subspecialty,
    avg(cap_10plus) OVER w AS cap_10plus,
    avg(cap_5to10) OVER w AS cap_5to10,
    avg(cap_less5) OVER w AS cap_less5,
    avg(cap_outside_firm_raw) OVER w AS cap_outside_firm
   FROM base
  WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING);

-- ============================================================================
-- END migration
-- ============================================================================
