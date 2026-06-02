-- Migration: gov renewal CAGR — per-lease CAGR (deck p.32) replaces the
-- market-average 5-yr-lag cagr_5yr on the charts.
-- Project: government (scknotsqkcheojiaewwh). Applied to prod 2026-06-02 via MCP.
--
-- PROBLEM (charts "Renewal Rent Growth" + "CPI vs Renewal CAGR"):
--   cm_gov_renewal_rent_growth_m.cagr_5yr =
--     power(ttm_avg_renewal_rent_psf / lag(ttm_avg_renewal_rent_psf, 60 mo), 1/5) - 1
--   This is a MARKET-AVERAGE growth metric that needs 5 years of prior market
--   history. gsa_lease_events 'renewed' rows start Feb-2013, so the first value
--   is Feb-2018 — the line can't plot 2014-2017 at all. It is also conceptually
--   different from the deck's PER-LEASE renewal spread (new rate vs the prior
--   rate at the SAME building), so the curve shape doesn't match the deck.
--
-- DECK DEFINITION (p.32, verbatim intent):
--   "the average compound annual growth rate (CAGR) for all renewed GSA leases
--   during the past twelve months ... comparing the new lease rate to the
--   previous rate in place at the same building before renewal ... considers the
--   time elapsed between the initial lease commencement and the renewal rent."
--   Light-blue dots / dark line = TTM average; quartile bars = upper/lower
--   quartile of that per-lease CAGR.
--
-- EXPLORATION (proving the prior rate is recoverable before building):
--   * lease_effective on gsa_lease_events is the CONSTANT initial commencement
--     date for a lease (e.g. 2002-01-01 across every event of LNJ22906).
--   * Renewal rate = annual_rent/lease_rsf at the 'renewed' event.
--   * Prior/original rate is recovered by self-join on lease_number to the
--     lease's earliest valid-rent event (any event_type). Coverage of a
--     recoverable prior rate is ~99.9% of renewals from 2014 on (2013 is 53%
--     — no history before Feb-2013).
--   Three year-elapsed variants were tested:
--     A  prior-event rate / elapsed-since-initial-commencement → ~0.1-0.9%
--        (collapses to ~0: a small final step over a 20-yr denominator).
--     B  prior-event rate / elapsed-since-prior-event          → 2-9%, noisy
--        (that's a YoY escalation, not a renewal spread).
--     C  earliest-observed rate / elapsed-since-earliest-observed → flat ~1-1.5%
--        and EXISTS back to 2014. This is the deck's full-life renewal CAGR and
--        is internally consistent (rate and elapsed both anchored at the same
--        earliest-observable point, which equals the initial commencement for
--        leases that began within the event-history window).
--   Chosen = Variant C, with a 1.0-yr elapsed floor and winsorization to
--   [-10%, +20%] to damp short-window / tiny-base outliers. Result: TTM avg
--   0.8-1.5% (1.00% avg since 2016), matching deck p.32 within tenths.
--
-- CENSORING NOTE: gsa_lease_events starts Feb-2013. For leases that commenced
-- earlier, the earliest-observed rate is a censored proxy for the true
-- commencement rate. Renewals whose earliest observable rent IS the renewal
-- itself (no prior rate) are excluded from the per-lease average — we do NOT
-- fabricate a prior rate. Residual exclusion ~0.1% of renewals from 2014 on.
--
-- cagr_5yr is RETAINED (appended-after columns only) for any other consumers;
-- the charts now read cagr_per_lease.

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
   SELECT e.event_date, e.lease_rsf, e.annual_rent,
     e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_type = 'renewed'::text
     AND e.event_date IS NOT NULL AND e.lease_rsf > 0 AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = e.event_date AND s.event_type = 'renewed'::text))
 ), valid_events AS (              -- any event w/ a sane rent_psf (commencement source)
   SELECT e.lease_number, e.event_date, e.event_type,
     e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_date IS NOT NULL AND e.lease_rsf > 0 AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric
 ), firsts AS (                    -- earliest observed (≈ initial commencement) rate
   SELECT DISTINCT ON (lease_number) lease_number, event_date AS first_date, rent_psf AS first_psf
   FROM valid_events ORDER BY lease_number, event_date
 ), renewals_pl AS (              -- deduped 'renewed' events (drop exact dup rows)
   SELECT DISTINCT v.lease_number, v.event_date, v.rent_psf
   FROM valid_events v
   WHERE v.event_type = 'renewed'::text
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = v.event_date AND s.event_type = 'renewed'::text))
 ), per_lease AS (
   SELECT r.event_date,
     GREATEST(LEAST(
       power(r.rent_psf / f.first_psf,
             1.0 / GREATEST((r.event_date - f.first_date)::numeric / 365.25, 1.0)) - 1::numeric,
       0.20), -0.10) AS per_lease_cagr
   FROM renewals_pl r
   JOIN firsts f ON f.lease_number = r.lease_number AND f.first_date < r.event_date
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
 ), pl_per_month AS (
   SELECT m.period_end, p.per_lease_cagr
   FROM month_anchors m
   JOIN per_lease p ON p.event_date > (m.period_end - '1 year'::interval)::date
                   AND p.event_date <= m.period_end
 ), ttm_agg AS (
   SELECT ttm_per_month.period_end,
     avg(ttm_per_month.rent_psf) AS ttm_avg_renewal_rent_psf,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.rent_psf::double precision)) AS upper_quartile_rpsf,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (ttm_per_month.rent_psf::double precision)) AS lower_quartile_rpsf,
     count(*) AS renewal_count
   FROM ttm_per_month GROUP BY ttm_per_month.period_end
 ), q_agg AS (
   SELECT q_per_month.period_end,
     avg(q_per_month.rent_psf) AS quarterly_avg_renewal_rent_psf,
     count(*) AS quarterly_renewal_count
   FROM q_per_month GROUP BY q_per_month.period_end
 ), pl_agg AS (
   SELECT pl_per_month.period_end,
     avg(pl_per_month.per_lease_cagr) AS cagr_per_lease,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (pl_per_month.per_lease_cagr::double precision)) AS cagr_per_lease_uq,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (pl_per_month.per_lease_cagr::double precision)) AS cagr_per_lease_lq
   FROM pl_per_month GROUP BY pl_per_month.period_end
 )
 SELECT t.period_end,
   q.quarterly_avg_renewal_rent_psf AS avg_renewal_rent_psf,
   t.ttm_avg_renewal_rent_psf,
   t.upper_quartile_rpsf,
   t.lower_quartile_rpsf,
   CASE WHEN lag(t.ttm_avg_renewal_rent_psf, 60) OVER (ORDER BY t.period_end) > 0::numeric
        THEN power(t.ttm_avg_renewal_rent_psf / lag(t.ttm_avg_renewal_rent_psf, 60) OVER (ORDER BY t.period_end), 1.0/5.0) - 1::numeric
        ELSE NULL::numeric END AS cagr_5yr,
   t.renewal_count,
   pl.cagr_per_lease,
   pl.cagr_per_lease_uq,
   pl.cagr_per_lease_lq
 FROM ttm_agg t
 LEFT JOIN q_agg q ON q.period_end = t.period_end
 LEFT JOIN pl_agg pl ON pl.period_end = t.period_end
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
     e.lease_rsf, e.annual_rent, e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_type = 'renewed'::text
     AND e.event_date IS NOT NULL AND e.lease_rsf > 0 AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = e.event_date AND s.event_type = 'renewed'::text))
 ), valid_events AS (
   SELECT e.lease_number, e.event_date, e.event_type,
     e.annual_rent / e.lease_rsf::numeric AS rent_psf
   FROM gsa_lease_events e
   WHERE e.event_date IS NOT NULL AND e.lease_rsf > 0 AND e.annual_rent > 0::numeric
     AND e.annual_rent / e.lease_rsf::numeric >= 5::numeric
     AND e.annual_rent / e.lease_rsf::numeric <= 100::numeric
 ), firsts AS (
   SELECT DISTINCT ON (lease_number) lease_number, event_date AS first_date, rent_psf AS first_psf
   FROM valid_events ORDER BY lease_number, event_date
 ), renewals_pl AS (
   SELECT DISTINCT v.lease_number, v.event_date, v.rent_psf
   FROM valid_events v
   WHERE v.event_type = 'renewed'::text
     AND NOT (EXISTS ( SELECT 1 FROM sentinels s
                        WHERE s.event_date = v.event_date AND s.event_type = 'renewed'::text))
 ), per_lease AS (
   SELECT r.event_date,
     GREATEST(LEAST(
       power(r.rent_psf / f.first_psf,
             1.0 / GREATEST((r.event_date - f.first_date)::numeric / 365.25, 1.0)) - 1::numeric,
       0.20), -0.10) AS per_lease_cagr
   FROM renewals_pl r
   JOIN firsts f ON f.lease_number = r.lease_number AND f.first_date < r.event_date
 ), quarterly AS (
   SELECT renewal_quarters.period_end,
     avg(renewal_quarters.rent_psf) AS avg_renewal_rent_psf,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (renewal_quarters.rent_psf::double precision)) AS upper_quartile_rpsf,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (renewal_quarters.rent_psf::double precision)) AS lower_quartile_rpsf,
     count(*) AS renewal_count
   FROM renewal_quarters GROUP BY renewal_quarters.period_end
 ), with_ttm AS (
   SELECT quarterly.period_end, quarterly.avg_renewal_rent_psf,
     quarterly.upper_quartile_rpsf, quarterly.lower_quartile_rpsf, quarterly.renewal_count,
     avg(quarterly.avg_renewal_rent_psf) OVER w_ttm AS ttm_avg_renewal_rent_psf
   FROM quarterly
   WINDOW w_ttm AS (ORDER BY quarterly.period_end ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
 ), pl_agg AS (
   SELECT qd.period_end,
     avg(p.per_lease_cagr) AS cagr_per_lease,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (p.per_lease_cagr::double precision)) AS cagr_per_lease_uq,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (p.per_lease_cagr::double precision)) AS cagr_per_lease_lq
   FROM (SELECT DISTINCT period_end FROM quarterly) qd
   JOIN per_lease p ON p.event_date > (qd.period_end - '1 year'::interval)::date
                   AND p.event_date <= qd.period_end
   GROUP BY qd.period_end
 )
 SELECT w.period_end, w.avg_renewal_rent_psf, w.ttm_avg_renewal_rent_psf,
   w.upper_quartile_rpsf, w.lower_quartile_rpsf,
   CASE WHEN lag(w.ttm_avg_renewal_rent_psf, 20) OVER (ORDER BY w.period_end) > 0::numeric
        THEN power(w.ttm_avg_renewal_rent_psf / lag(w.ttm_avg_renewal_rent_psf, 20) OVER (ORDER BY w.period_end), 1.0/5.0) - 1::numeric
        ELSE NULL::numeric END AS cagr_5yr,
   w.renewal_count,
   pl.cagr_per_lease, pl.cagr_per_lease_uq, pl.cagr_per_lease_lq
 FROM with_ttm w
 LEFT JOIN pl_agg pl ON pl.period_end = w.period_end
 ORDER BY w.period_end;

-- Repoint the CPI-vs-Renewal-CAGR charts (monthly + quarterly) from the
-- market-average cagr_5yr to the deck's per-lease renewal CAGR.
CREATE OR REPLACE VIEW public.cm_gov_cpi_vs_renewal_cagr_m AS
 WITH cpi AS (
   SELECT (date_trunc('month', economic_indicators.observation_date::timestamptz) + '1 mon -1 days'::interval)::date AS period_end,
     avg(economic_indicators.value::numeric) AS cpi_index
   FROM economic_indicators
   WHERE economic_indicators.series_id = 'CPIAUCSL'::text AND economic_indicators.observation_date IS NOT NULL
   GROUP BY ((date_trunc('month', economic_indicators.observation_date::timestamptz) + '1 mon -1 days'::interval)::date)
 ), cpi_yoy AS (
   SELECT c_1.period_end, c_1.cpi_index,
     CASE WHEN lag(c_1.cpi_index, 12) OVER (ORDER BY c_1.period_end) > 0::numeric
          THEN (c_1.cpi_index - lag(c_1.cpi_index, 12) OVER (ORDER BY c_1.period_end)) / lag(c_1.cpi_index, 12) OVER (ORDER BY c_1.period_end)
          ELSE NULL::numeric END AS cpi_yoy_change
   FROM cpi c_1
 )
 SELECT c.period_end, c.cpi_yoy_change AS cpi_change,
   rrg.cagr_per_lease AS gsa_renewal_cagr
 FROM cpi_yoy c
 LEFT JOIN cm_gov_renewal_rent_growth_m rrg ON rrg.period_end = c.period_end
 WHERE c.period_end >= '2005-01-01'::date
 ORDER BY c.period_end;

CREATE OR REPLACE VIEW public.cm_gov_cpi_vs_renewal_cagr AS
 WITH cpi AS (
   SELECT (date_trunc('quarter', economic_indicators.observation_date::timestamptz) + '3 mons'::interval - '1 day'::interval)::date AS period_end,
     avg(economic_indicators.value::numeric) AS cpi_index
   FROM economic_indicators
   WHERE economic_indicators.series_id = 'CPIAUCSL'::text
   GROUP BY ((date_trunc('quarter', economic_indicators.observation_date::timestamptz) + '3 mons'::interval - '1 day'::interval)::date)
 ), cpi_yoy AS (
   SELECT cpi.period_end, cpi.cpi_index,
     CASE WHEN lag(cpi.cpi_index, 4) OVER (ORDER BY cpi.period_end) > 0::numeric
          THEN (cpi.cpi_index - lag(cpi.cpi_index, 4) OVER (ORDER BY cpi.period_end)) / lag(cpi.cpi_index, 4) OVER (ORDER BY cpi.period_end)
          ELSE NULL::numeric END AS cpi_yoy_change
   FROM cpi
 )
 SELECT c.period_end, c.cpi_yoy_change AS cpi_change,
   rrg.cagr_per_lease AS gsa_renewal_cagr
 FROM cpi_yoy c
 LEFT JOIN cm_gov_renewal_rent_growth_q rrg ON rrg.period_end = c.period_end
 WHERE c.period_end >= '2010-01-01'::date
 ORDER BY c.period_end;
