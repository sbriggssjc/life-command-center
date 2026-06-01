-- =============================================================================
-- Migration: cm_dialysis_sold_cap_by_term_dot — R66d term resolver = as-of-sale
-- Project:   Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:       2026-06-01
--
-- Audit fix #1 (lease term remaining). The master comp workbook hand-enters
-- TERM = firm-term-remaining AT SALE (frozen). Our resolver computed term as
-- (lease_expiration - sale_date) — correct math — BUT only considered leases
-- that are STILL active today (is_active=true, excluding superseded/expired),
-- which DROPPED any sale whose lease has since been renewed/superseded. That
-- decayed the long-term cohort (a 2017 12-yr deal whose lease was later
-- superseded resolved to NULL and fell out of the 12+ line).
--
-- Fix: use the lease IN EFFECT AT sale_date (lease_start<=sale<=expiration),
-- most-recent start, regardless of today's active status (exclude only non-real
-- statuses: placeholder/closed). This freezes term-at-sale like the master and
-- recovers historical leases. Measured impact on dia market sales:
--   term resolved   1,003 -> 1,615
--   cap + term        691 -> 1,138  (26% -> 42% of market sales)
--   12+ cohort        177 -> 397    (recent years recover, e.g. 2021 5 -> 17)
-- Column contract unchanged. Validated read-only + applied to prod 2026-06-01.
--
-- NOTE: the ACTIVE-listing term charts (cm_dialysis_asking_cap_by_term_m,
-- _available_market_size_q, _asking_cap_quartiles_active_m) keep is_active=true
-- — they describe the CURRENT market, where today's lease state is correct.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS
 WITH month_anchors AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2001-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), classified AS (
   SELECT s.sale_date,
     CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric
          ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) END AS cap_rate,
     ( SELECT (l.lease_expiration - s.sale_date)::numeric / 365.25
         FROM leases l
        WHERE l.property_id = s.property_id
          AND lower(COALESCE(l.status,'')) <> ALL (ARRAY['placeholder','closed','closed but obligated'])
          AND l.lease_expiration IS NOT NULL
          AND l.lease_expiration >= s.sale_date
          AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
        ORDER BY l.lease_start DESC NULLS LAST, l.lease_expiration DESC
        LIMIT 1 ) AS firm_term_years
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0
     AND NOT COALESCE(s.exclude_from_market_metrics, false)
     AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
     AND s.sale_date <= cm_last_completed_quarter_end()
 ), ttm AS (
   SELECT m.period_end,
     avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 12 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_12plus_raw,
     count(*)        FILTER (WHERE c.firm_term_years >= 12 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_12plus_n,
     avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 8 AND c.firm_term_years < 12 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_8to12_raw,
     count(*)        FILTER (WHERE c.firm_term_years >= 8 AND c.firm_term_years < 12 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_8to12_n,
     avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 6 AND c.firm_term_years < 8 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_6to8_raw,
     count(*)        FILTER (WHERE c.firm_term_years >= 6 AND c.firm_term_years < 8 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_6to8_n,
     avg(c.cap_rate) FILTER (WHERE c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_5orless_raw,
     count(*)        FILTER (WHERE c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5 AND c.cap_rate BETWEEN 0.04 AND 0.12) AS cap_5orless_n
   FROM month_anchors m
   LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
   GROUP BY m.period_end
 ), gated AS (
   SELECT period_end,
     CASE WHEN cap_12plus_n  >= 3 THEN cap_12plus_raw  END AS cap_12plus_g,
     CASE WHEN cap_8to12_n   >= 3 THEN cap_8to12_raw   END AS cap_8to12_g,
     CASE WHEN cap_6to8_n    >= 3 THEN cap_6to8_raw    END AS cap_6to8_g,
     CASE WHEN cap_5orless_n >= 3 THEN cap_5orless_raw END AS cap_5orless_g
   FROM ttm
 )
 SELECT period_end, 'all'::text AS subspecialty,
   avg(cap_12plus_g)  OVER w AS cap_12plus,
   avg(cap_8to12_g)   OVER w AS cap_8to12,
   avg(cap_6to8_g)    OVER w AS cap_6to8,
   avg(cap_5orless_g) OVER w AS cap_5orless
 FROM gated
 WINDOW w AS (ORDER BY period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
 ORDER BY period_end;
