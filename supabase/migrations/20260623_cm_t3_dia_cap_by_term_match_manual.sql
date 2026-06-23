-- T3 / Option 1 (2026-06-23) — make the dialysis cap-by-lease-term export move
-- like the historical manual workbook (Dialysis_Comp_Work_MASTER, 'Charts' tab,
-- cols AD-AG: AVERAGEIFS of SOLD CAP by remaining TERM, trailing-12mo, no floor,
-- no moving average).
--
-- Root cause of "the manual chart moves but the export is flat": the prior
-- `cm_dialysis_sold_cap_by_term_dot` (Round 28 + Round 48 smoothing) layered an
-- n>=3 density floor AND a 9-month centered moving average on top of the raw TTM
-- mean. That halved the month-over-month movement (verified: 5.1/4.9/5.0/7.1 bps
-- raw -> 2.1/2.6/2.5/3.0 bps published). The 4 buckets (12+/8-12/6-8/<=5) and the
-- term basis (firm_term_years_at_sale = (firm_term_expiration_at_sale-sale_date)/365)
-- ALREADY matched the manual; only the smoothing diverged.
--
-- This drops the floor + MA so the 4 cohorts equal the raw trailing-12mo mean,
-- exactly like the manual AVERAGEIFS. Same output columns/types/order, so the two
-- dependents (cm_dialysis_cap_by_term_q, cm_dialysis_market_quarterly_master_m)
-- inherit it with no change. cap_rate_final stays the authoritative cap field
-- (implausible_unverified -> NULL). Reversible: re-apply Round 28/48 to restore.
-- Applied live to dia (zqzrriwuavgrquhisnoa) 2026-06-23.

CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS
WITH month_anchors AS (
  SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
  FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
),
classified AS (
  SELECT s.sale_date,
    CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
    s.firm_term_years_at_sale AS firm_term_years
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric
    AND NOT COALESCE(s.exclude_from_market_metrics, false)
    AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text])))
    AND s.sale_date <= cm_last_completed_quarter_end()
)
SELECT m.period_end,
  'all'::text AS subspecialty,
  avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_12plus,
  avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 8::numeric AND c.firm_term_years < 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_8to12,
  avg(c.cap_rate) FILTER (WHERE c.firm_term_years > 5::numeric AND c.firm_term_years < 8::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_6to8,
  avg(c.cap_rate) FILTER (WHERE c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_5orless
FROM month_anchors m
LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
GROUP BY m.period_end
ORDER BY m.period_end;
