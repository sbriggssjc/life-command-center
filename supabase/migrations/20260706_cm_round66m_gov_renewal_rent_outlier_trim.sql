-- Migration: cm_gov_renewal_rent_growth_m / _q — R66m outlier trim (audit)
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02.
--
-- PROBLEM (chart "Renewal Rent Growth", tab Data_Renewal_Growth):
--   Renewal rent/SF = annual_rent / lease_rsf on gsa_lease_events 'renewed'
--   rows, averaged with NO outlier trim. Among 13,345 recent renewals the
--   mean was $38.47 while the median was $29.94, the p99 was $237/SF and the
--   max was $3,198/SF (parking/antenna/storage leases and RSF unit errors).
--   These extreme highs dragged the TTM mean to $54.76 — ABOVE its own upper
--   quartile ($42.81) and well past the deck's ~$41 peak — and made the chart
--   spike toward $60. The 5-yr CAGR (built on that inflated mean) read 10.6%
--   vs the deck's low-single-digit renewal growth.
--
-- FIX: restrict rent_psf to a sane [$5, $100]/SF band in both the monthly and
--   quarterly views (also add the >1000/day sentinel-date exclusion to _q for
--   parity with _m). Trimmed TTM avg lands at a stable $31-32/SF across 2024-26
--   (matching the deck), the mean no longer exceeds the quartiles, and the CAGR
--   falls back to a realistic magnitude.
--
--   NOTE: cagr_5yr remains a MARKET-AVERAGE growth metric (5-yr CAGR of the TTM
--   trimmed mean), which is conceptually different from the deck's PER-LEASE
--   "new rate vs prior rate at the same building" CAGR. The per-lease version
--   needs prior-rate linkage that gsa_lease_events does not currently carry
--   (no prior_rent column); that is queued as a separate data-capture task.
--
-- Column names/types preserved so CREATE OR REPLACE is non-breaking.

CREATE OR REPLACE VIEW public.cm_gov_renewal_rent_growth_m AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2010-01-01'::date::timestamptz,
                        cm_last_completed_quarter_end()::timestamptz,
                        '1 mon'::interval) g(d)
 ), sentinels AS (
   SELECT event_date, event_type
   FROM gsa_lease_events
   WHERE event_date IS NOT NULL
   GROUP BY event_date, event_type
   HAVING count(*) > 1000
 ), renewals AS (
   SELECT e.event_date,
     e.lease_rsf,
     e.annual_rent,
     e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_type = 'renewed'::text
     AND e.event_date IS NOT NULL
     AND e.lease_rsf > 0
     AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric        -- R66m trim
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric      -- R66m trim
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = e.event_date AND s.event_type = 'renewed'::text))
 ), ttm_per_month AS (
   SELECT m.period_end, r.rent_psf
   FROM month_anchors m
   JOIN renewals r ON r.event_date > (m.period_end - '1 year'::interval)::date
                  AND r.event_date <= m.period_end
 ), q_per_month AS (
   SELECT m.period_end, r.rent_psf
   FROM month_anchors m
   JOIN renewals r ON r.event_date > (m.period_end - '3 mons'::interval)::date
                  AND r.event_date <= m.period_end
 ), ttm_agg AS (
   SELECT ttm_per_month.period_end,
     avg(ttm_per_month.rent_psf) AS ttm_avg_renewal_rent_psf,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.rent_psf::double precision)) AS upper_quartile_rpsf,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.rent_psf::double precision)) AS lower_quartile_rpsf,
     count(*) AS renewal_count
   FROM ttm_per_month
   GROUP BY ttm_per_month.period_end
 ), q_agg AS (
   SELECT q_per_month.period_end,
     avg(q_per_month.rent_psf) AS quarterly_avg_renewal_rent_psf,
     count(*) AS quarterly_renewal_count
   FROM q_per_month
   GROUP BY q_per_month.period_end
 )
 SELECT t.period_end,
   q.quarterly_avg_renewal_rent_psf AS avg_renewal_rent_psf,
   t.ttm_avg_renewal_rent_psf,
   t.upper_quartile_rpsf,
   t.lower_quartile_rpsf,
   CASE WHEN lag(t.ttm_avg_renewal_rent_psf, 60) OVER (ORDER BY t.period_end) > 0::numeric
        THEN power(t.ttm_avg_renewal_rent_psf / lag(t.ttm_avg_renewal_rent_psf, 60) OVER (ORDER BY t.period_end), 1.0/5.0) - 1::numeric
        ELSE NULL::numeric END AS cagr_5yr,
   t.renewal_count
 FROM ttm_agg t
 LEFT JOIN q_agg q ON q.period_end = t.period_end
 ORDER BY t.period_end;

CREATE OR REPLACE VIEW public.cm_gov_renewal_rent_growth_q AS
 WITH sentinels AS (
   SELECT event_date, event_type
   FROM gsa_lease_events
   WHERE event_date IS NOT NULL
   GROUP BY event_date, event_type
   HAVING count(*) > 1000
 ), renewal_quarters AS (
   SELECT (date_trunc('quarter', e.event_date) + '3 mons'::interval - '1 day'::interval)::date AS period_end,
     e.lease_rsf,
     e.annual_rent,
     e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_type = 'renewed'::text
     AND e.event_date IS NOT NULL
     AND e.lease_rsf > 0
     AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric        -- R66m trim
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric      -- R66m trim
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = e.event_date AND s.event_type = 'renewed'::text))
 ), quarterly AS (
   SELECT renewal_quarters.period_end,
     avg(renewal_quarters.rent_psf) AS avg_renewal_rent_psf,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (renewal_quarters.rent_psf::double precision)) AS upper_quartile_rpsf,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (renewal_quarters.rent_psf::double precision)) AS lower_quartile_rpsf,
     count(*) AS renewal_count
   FROM renewal_quarters
   GROUP BY renewal_quarters.period_end
 ), with_ttm AS (
   SELECT quarterly.period_end,
     quarterly.avg_renewal_rent_psf,
     quarterly.upper_quartile_rpsf,
     quarterly.lower_quartile_rpsf,
     quarterly.renewal_count,
     avg(quarterly.avg_renewal_rent_psf) OVER w_ttm AS ttm_avg_renewal_rent_psf
   FROM quarterly
   WINDOW w_ttm AS (ORDER BY quarterly.period_end ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
 )
 SELECT period_end,
   avg_renewal_rent_psf,
   ttm_avg_renewal_rent_psf,
   upper_quartile_rpsf,
   lower_quartile_rpsf,
   CASE WHEN lag(ttm_avg_renewal_rent_psf, 20) OVER (ORDER BY period_end) > 0::numeric
        THEN power(ttm_avg_renewal_rent_psf / lag(ttm_avg_renewal_rent_psf, 20) OVER (ORDER BY period_end), 1.0/5.0) - 1::numeric
        ELSE NULL::numeric END AS cagr_5yr,
   renewal_count
 FROM with_ttm
 ORDER BY period_end;
