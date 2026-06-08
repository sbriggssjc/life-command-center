-- =============================================================================
-- Round 73 Layer A — dia ASKING cap quartiles, active listings (#5)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). APPLIED LIVE 2026-06-08.
-- Receipts: reports/CM_ROUND73_LAYER_A_COHORT_RECEIPTS.md
--
-- ASKING-SIDE ONLY (reads cm_dialysis_active_listings_m). Separate from the
-- sold-side dot -- not touched.
--
-- The view grouped quartiles POINT-IN-TIME per month (no TTM pool), so the
-- core-10+ band rode on n_core = 2-8 listings/month (quartiles of 2-4 points =
-- noise) and the total upper quartile spiked when n_total fell to 12-17. FIX:
-- pool the quartile sample over a trailing 2-year window (same discipline as
-- #11/#14). n_total -> 317-1249, n_core -> 108-212; bands stable, core sits
-- cleanly inside/below total. Gates + uqc<=uqt guard + +/-2mo smoothing kept.
--
-- CAVEAT: a quartile pooled over listing-MONTHS weights by time-on-market
-- (a listing active N months contributes N rows) -- an acceptable, honest
-- reading of "asking caps visible on the market over the window"; quartiles
-- cannot be made smooth from 2-8 points without this pooling.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_m AS
 WITH ma AS (
   SELECT DISTINCT period_end FROM cm_dialysis_active_listings_m
 ), agg AS (
   SELECT m.period_end,
     count(*) FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS n_total,
     count(*) FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS n_core,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision))
       FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS uqt,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision))
       FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS lqt,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision))
       FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS uqc,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision))
       FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS lqc
   FROM ma m
     LEFT JOIN cm_dialysis_active_listings_m b
       ON b.period_end > (m.period_end - '2 years'::interval)::date AND b.period_end <= m.period_end
   GROUP BY m.period_end
 ), gated AS (
   SELECT agg.period_end,
     CASE WHEN agg.n_total >= 4 THEN agg.uqt ELSE NULL::double precision END AS uqt,
     CASE WHEN agg.n_total >= 4 THEN agg.lqt ELSE NULL::double precision END AS lqt,
     CASE WHEN agg.n_core >= 3 AND agg.uqc IS NOT NULL AND agg.uqt IS NOT NULL AND agg.uqc <= agg.uqt THEN agg.uqc ELSE NULL::double precision END AS uqc,
     CASE WHEN agg.n_core >= 3 AND agg.uqc IS NOT NULL AND agg.uqt IS NOT NULL AND agg.uqc <= agg.uqt THEN agg.lqc ELSE NULL::double precision END AS lqc
   FROM agg
 )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    avg(gated.uqt) OVER w AS upper_q_total,
    avg(gated.lqt) OVER w AS lower_q_total,
    avg(gated.uqc) OVER w AS upper_q_core,
    avg(gated.lqc) OVER w AS lower_q_core
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
  ORDER BY gated.period_end;
