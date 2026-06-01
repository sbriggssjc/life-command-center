-- Migration: cm_gov_sold_cap_by_term_dot — R66i unify onto the 4-tier ladder (audit #7)
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-01.
-- Was reading the matview's leases-only cohorts (~59.7%). Now self-contained on the
-- SAME 4-tier ladder as cm_gov_cap_by_term_m (~82%), as-of-sale, n>=3, +-3 smoothing.
CREATE OR REPLACE VIEW public.cm_gov_sold_cap_by_term_dot AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2005-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), classified AS MATERIALIZED (
   SELECT s.sale_date,
     CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
     COALESCE(
       (SELECT (gl.termination_date - s.sale_date)::numeric/365.0 FROM gsa_leases gl
         WHERE gl.property_id=s.property_id AND gl.lease_expiration>=s.sale_date AND gl.termination_date IS NOT NULL
         ORDER BY gl.lease_expiration DESC LIMIT 1),
       (SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric/365.0 FROM leases l
         WHERE l.property_id=s.property_id AND l.expiration_date>=s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
         ORDER BY l.expiration_date DESC LIMIT 1),
       s.firm_term_years,
       CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration>=s.sale_date THEN (s.lease_expiration - s.sale_date)::numeric/365.0 END
     ) AS firm_rem
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price > 0 AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
     AND NOT COALESCE(s.exclude_from_market_metrics,false)
 ), ttm AS (
   SELECT m.period_end,
     avg(c.cap) FILTER (WHERE c.firm_rem >= 10)                    AS cap_10plus_raw,  count(*) FILTER (WHERE c.firm_rem >= 10)                    AS n_10plus,
     avg(c.cap) FILTER (WHERE c.firm_rem >= 5 AND c.firm_rem < 10) AS cap_5to10_raw,   count(*) FILTER (WHERE c.firm_rem >= 5 AND c.firm_rem < 10) AS n_5to10,
     avg(c.cap) FILTER (WHERE c.firm_rem > 0 AND c.firm_rem < 5)   AS cap_less5_raw,   count(*) FILTER (WHERE c.firm_rem > 0 AND c.firm_rem < 5)   AS n_less5,
     avg(c.cap) FILTER (WHERE c.firm_rem <= 0)                     AS cap_outside_raw, count(*) FILTER (WHERE c.firm_rem <= 0)                     AS n_outside
   FROM months m
   LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
   GROUP BY m.period_end
 ), gated AS (
   SELECT period_end,
     CASE WHEN n_10plus  >= 3 THEN cap_10plus_raw  END AS cap_10plus_g,
     CASE WHEN n_5to10   >= 3 THEN cap_5to10_raw   END AS cap_5to10_g,
     CASE WHEN n_less5   >= 3 THEN cap_less5_raw   END AS cap_less5_g,
     CASE WHEN n_outside >= 3 THEN cap_outside_raw END AS cap_outside_g
   FROM ttm
 )
 SELECT period_end, 'all'::text AS subspecialty,
   avg(cap_10plus_g)  OVER w AS cap_10plus,
   avg(cap_5to10_g)   OVER w AS cap_5to10,
   avg(cap_less5_g)   OVER w AS cap_less5,
   avg(cap_outside_g) OVER w AS cap_outside_firm
 FROM gated WINDOW w AS (ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
 ORDER BY period_end;
