-- Migration: dia — Round 68-A Task 3: rolling-3-quarter pooling for the 10+ core series
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- After Tasks 1+2 landed, the 10+ ("core", firm term >= 10y) asking-cap quartile
-- series still gaps on thin quarters. Two problems in the prior view:
--   1. The core quartiles had NO count gate — percentile_cont over 1-3 listings
--      emits a meaningless "quartile". Only the all-cohort total was gated (>=4).
--   2. With a proper n>=4 core gate, only 26/53 quarters have enough 10+ priced
--      listings in a single quarter.
--
-- Per Scott's Task 3 decision: pool the 10+ series ONLY over a rolling 3-quarter
-- window (keep the gate, widen the window); the all-cohort total series stays
-- single-quarter gated (it has the n, and pooling would smooth the headline away
-- from the master's behavior). The chart note must label the 10+ series
-- "3-mo pooled" (rolling 3-quarter). Coverage of a MEANINGFUL (n>=4) core
-- quartile rises 26 -> 34 / 53; the remaining gap is genuine (11 quarters have
-- zero 10+ priced listings even pooled; ~8 stay below n=4) and is documented,
-- not fabricated.
--
-- Column names/order/types preserved (CREATE OR REPLACE append-only rule):
-- period_end, subspecialty, upper_q_total, lower_q_total, upper_q_core,
-- lower_q_core — only upper_q_core/lower_q_core change (now pooled + gated).
-- Synthetic rows never reach this view: they carry NULL last_cap_rate and are
-- dropped by the band filter (inherited from active_listings_q).

CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_q AS
 WITH al AS (
   SELECT period_end, last_cap_rate, is_core_10plus
   FROM cm_dialysis_active_listings_q
 ), single AS (   -- single-quarter all-cohort quartiles (unchanged) + total gate
   SELECT al.period_end,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (al.last_cap_rate::double precision))
       FILTER (WHERE al.last_cap_rate >= 0.04 AND al.last_cap_rate <= 0.12) AS upper_q_total,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (al.last_cap_rate::double precision))
       FILTER (WHERE al.last_cap_rate >= 0.04 AND al.last_cap_rate <= 0.12) AS lower_q_total,
     count(*) FILTER (WHERE al.last_cap_rate IS NOT NULL) AS tot_n
   FROM al GROUP BY al.period_end
 ), core_pool AS (   -- rolling 3-quarter pooled 10+ core quartiles + pooled gate count
   SELECT p.period_end,
     percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (a.last_cap_rate::double precision))
       FILTER (WHERE a.is_core_10plus AND a.last_cap_rate >= 0.04 AND a.last_cap_rate <= 0.12) AS upper_q_core,
     percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (a.last_cap_rate::double precision))
       FILTER (WHERE a.is_core_10plus AND a.last_cap_rate >= 0.04 AND a.last_cap_rate <= 0.12) AS lower_q_core,
     count(*) FILTER (WHERE a.is_core_10plus AND a.last_cap_rate >= 0.04 AND a.last_cap_rate <= 0.12) AS core_pool_n
   FROM (SELECT DISTINCT period_end FROM al) p
   JOIN al a ON a.period_end <= p.period_end AND a.period_end > (p.period_end - interval '8 months')
   GROUP BY p.period_end
 )
 SELECT s.period_end,
   'all'::text AS subspecialty,
   s.upper_q_total,
   s.lower_q_total,
   CASE WHEN c.core_pool_n >= 4 THEN c.upper_q_core ELSE NULL::double precision END AS upper_q_core,
   CASE WHEN c.core_pool_n >= 4 THEN c.lower_q_core ELSE NULL::double precision END AS lower_q_core
 FROM single s
   LEFT JOIN core_pool c ON c.period_end = s.period_end
 WHERE s.tot_n >= 4
 ORDER BY s.period_end;
