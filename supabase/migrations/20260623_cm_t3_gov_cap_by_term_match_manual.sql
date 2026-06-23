-- T3 / Option 1 (2026-06-23) — make the gov cap-by-lease-term export move like
-- the historical manual gov workbook (Government Master / All Charts cols:
-- "10+/6-10/<5/Outside Firm Year Cap (ttm)" = AVERAGE of SOLD CAP by remaining
-- firm term, trailing-12mo, no floor, no moving average).
--
-- Root cause of "the manual chart moves but the export is flat": the prior
-- `cm_gov_cap_by_term_m` (Round 69 smoothing + Round 76 a2 median) used
-- percentile_disc(0.5) MEDIAN over a 2-YEAR window with an n>=5 density floor AND
-- a 7-month centered moving average. The gov master snapshot proves the manual
-- uses MEAN ("Average Cap Rate (ttm)") over a trailing-TWELVE-month window with
-- none of that smoothing. This rebuild matches the manual:
--   * percentile_disc(0.5) -> avg()  (mean, like the manual AVERAGEIFS)
--   * 2-year window -> trailing-12-month
--   * remove the n>=5 floor and the 7-month centered MA
-- KEPT: the firm_rem COALESCE ladder (firm_term_years_at_sale -> gsa_leases
-- termination -> leases firm term -> lease_expiration) — strictly better than the
-- manual's single TERM column (rescues ~648 otherwise-null sales); the cohort
-- boundaries; the [0.04,0.12] cap band; sold_cap_rate as the cap field (gov has no
-- cap_rate_final); implausible_unverified -> NULL.
--
-- Same output columns/types/order (period_end, subspecialty, cap_10plus,
-- cap_6to10, cap_5to10, cap_less5, cap_outside_firm); no dependents. Cohorts with
-- no sales in a thin TTM month return NULL (a gap) — exactly the manual's
-- AVERAGEIFS #DIV/0! behavior. Verified live: month-over-month movement restored
-- to 8.3/7.8/5.4 bps (10+/6-10/<5). Reversible: re-apply Round 69/76-a2.
-- Applied live to gov (scknotsqkcheojiaewwh) 2026-06-23.

CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS
WITH months AS (
  SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
  FROM generate_series('2005-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
),
classified AS (
  SELECT s.sale_date,
    CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
    COALESCE(LEAST(s.firm_term_years_at_sale, ( SELECT (gl.termination_date - s.sale_date)::numeric / 365.0
           FROM gsa_leases gl
          WHERE gl.property_id = s.property_id AND gl.lease_expiration >= s.sale_date AND gl.termination_date IS NOT NULL
          ORDER BY gl.lease_expiration DESC
         LIMIT 1), ( SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric / 365.0
           FROM leases l
          WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
          ORDER BY l.expiration_date DESC
         LIMIT 1)), s.firm_term_years,
        CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date THEN (s.lease_expiration - s.sale_date)::numeric / 365.0
             ELSE NULL::numeric END) AS firm_rem
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false)
)
SELECT m.period_end,
  'all'::text AS subspecialty,
  round(avg(c.cap) FILTER (WHERE c.firm_rem >= 10::numeric), 6) AS cap_10plus,
  round(avg(c.cap) FILTER (WHERE c.firm_rem >= 6::numeric AND c.firm_rem < 10::numeric), 6) AS cap_6to10,
  round(avg(c.cap) FILTER (WHERE c.firm_rem >= 5::numeric AND c.firm_rem < 10::numeric), 6) AS cap_5to10,
  round(avg(c.cap) FILTER (WHERE c.firm_rem > 0::numeric AND c.firm_rem < 5::numeric), 6) AS cap_less5,
  round(avg(c.cap) FILTER (WHERE c.firm_rem <= 0::numeric), 6) AS cap_outside_firm
FROM months m
LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
GROUP BY m.period_end
ORDER BY m.period_end;
