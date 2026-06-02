-- Migration: cm_gov_cap_by_term_q — R66k rebuild onto the unified term ladder
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02.
--
-- PROBLEM (chart "Cap Rate by Remaining Lease Term", tab Data_Cap_by_Term):
--   The view read pre-gated per-quarter cohort columns out of the giant shared
--   view cm_gov_market_quarterly, which resolves firm term from ONLY the raw
--   sales_transactions.firm_term_years column. That column is populated for just
--   ~30% of gov sales, so 70.5% of cap-known sales fell into "Outside Firm" and
--   the three real cohorts (10+/6-10/<5) were starved → tangled, spiky lines and
--   a deep "Outside Firm" plunge. No TTM pooling and no smoothing made it worse.
--
--   Meanwhile cm_gov_sold_cap_by_term_dot (R66i) already used a 4-tier resolution
--   LADDER (gsa_leases.termination_date → leases.firm_term_years-elapsed →
--   sales_transactions.firm_term_years → sales_transactions.lease_expiration),
--   reaching ~82% coverage. The two gov term charts were inconsistent.
--
-- FIX: rebuild cm_gov_cap_by_term_q self-contained on the SAME R66i ladder,
--   quarterly grain, TTM-pooled (trailing 12 months), n>=3 cohort gate, and a
--   +/-1 quarter centered smoothing — mirroring the dot view's methodology.
--   Result (2015+ window): "Outside Firm" share 70.5% -> 13.2%; all four cohorts
--   continuous (~43/45 quarters pass the gate); every line sits in a tight,
--   readable 5.9-7.6% band with no plunges.
--
-- Column names/types are preserved (period_end, subspecialty, cap_10plus,
-- cap_6to10, cap_less5, cap_outside_firm) so CREATE OR REPLACE keeps the
-- dependent view v_property_value_signal valid.

CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_q AS
 WITH quarters AS (
   SELECT (date_trunc('quarter', g.d) + interval '3 mons -1 days')::date AS period_end
   FROM generate_series('2005-01-01'::date::timestamptz,
                        cm_last_completed_quarter_end()::timestamptz,
                        interval '3 mons') g(d)
 ), classified AS MATERIALIZED (
   SELECT s.sale_date,
     CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
          ELSE s.sold_cap_rate END AS cap,
     COALESCE(
       (SELECT (gl.termination_date - s.sale_date)::numeric / 365.0
          FROM gsa_leases gl
         WHERE gl.property_id = s.property_id
           AND gl.lease_expiration >= s.sale_date
           AND gl.termination_date IS NOT NULL
         ORDER BY gl.lease_expiration DESC LIMIT 1),
       (SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric / 365.0
          FROM leases l
         WHERE l.property_id = s.property_id
           AND l.expiration_date >= s.sale_date
           AND l.commencement_date IS NOT NULL
           AND l.firm_term_years IS NOT NULL
         ORDER BY l.expiration_date DESC LIMIT 1),
       s.firm_term_years,
       CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date
            THEN (s.lease_expiration - s.sale_date)::numeric / 365.0
            ELSE NULL::numeric END
     ) AS firm_rem
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL
     AND s.sold_price > 0::numeric
     AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
 ), ttm AS (
   SELECT q.period_end,
     avg(c.cap) FILTER (WHERE c.firm_rem > 10::numeric)                              AS c10,
     count(*)   FILTER (WHERE c.firm_rem > 10::numeric)                              AS n10,
     avg(c.cap) FILTER (WHERE c.firm_rem > 5::numeric AND c.firm_rem <= 10::numeric) AS c610,
     count(*)   FILTER (WHERE c.firm_rem > 5::numeric AND c.firm_rem <= 10::numeric) AS n610,
     avg(c.cap) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 5::numeric)   AS c5,
     count(*)   FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 5::numeric)   AS n5,
     avg(c.cap) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL)              AS cout,
     count(*)   FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL)              AS nout
   FROM quarters q
   LEFT JOIN classified c
     ON c.sale_date > (q.period_end - interval '1 year')::date
    AND c.sale_date <= q.period_end
   GROUP BY q.period_end
 ), gated AS (
   SELECT period_end,
     CASE WHEN n10  >= 3 THEN c10  END AS cap_10plus_g,
     CASE WHEN n610 >= 3 THEN c610 END AS cap_6to10_g,
     CASE WHEN n5   >= 3 THEN c5   END AS cap_less5_g,
     CASE WHEN nout >= 3 THEN cout END AS cap_outside_g
   FROM ttm
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   avg(cap_10plus_g)  OVER w AS cap_10plus,
   avg(cap_6to10_g)   OVER w AS cap_6to10,
   avg(cap_less5_g)   OVER w AS cap_less5,
   avg(cap_outside_g) OVER w AS cap_outside_firm
 FROM gated
 WINDOW w AS (ORDER BY period_end ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
 ORDER BY period_end;
