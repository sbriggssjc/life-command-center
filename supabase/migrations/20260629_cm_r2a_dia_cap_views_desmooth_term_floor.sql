-- =============================================================================
-- R2-A — dia cap-view de-smooth (Unit 1) + Sold-Cap-by-Term <=5yr floor (Unit 3).
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live 2026-06-29.
--
-- Unit 1 (de-smooth) — Scott: "dia Active Cap Quartiles hardly moving." Root
-- cause = a ±2 centered moving average on the final SELECT, ON TOP of the 2yr
-- TTM pool + the n_total>=4 / n_core>=3 density gates. Same fix as T3/T3b: drop
-- the window, KEEP the gates. The quartile lines now show real movement.
--   cm_dialysis_asking_cap_quartiles_active_m — was avg(<col>) OVER w +
--     WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
--   (cm_dialysis_ask_cap_by_term_m was already de-smoothed in T3b; the dia sold
--    dot carries no window — only its <=5 bucket changes below.)
--
-- Unit 3 (Sold-Cap-by-Term <=5yr cohort filter) — cm_dialysis_sold_cap_by_term_dot.
-- Grounding refined the premise: the <=5 bucket ALREADY excluded no-lease-term
-- sales (the filter required firm_term_years IS NOT NULL — 238 NULL-term sales in
-- range were never in any bucket, the honest "unknown drops out"). But it had no
-- LOWER floor, so 14 near-zero-term sales (firm_term_years 0.005-0.5yr — an
-- implausibly short remaining term) sat in the <=5 cohort. Adding a 6-month floor
-- ([0.5yr, 5yr]) drops those 14 (touches 74 TTM month-rows, max delta ~17bps, 0
-- months dropped to NULL) so the bucket reflects real short-term deals. NULL/near-
-- zero-term sales still count in the overall, just not in this term breakdown.
-- gov sold-cap-by-term was checked too: its <5 bucket already requires
-- firm_rem > 0 (and routes NULL-term to a separate cap_outside bucket) — already
-- clean, no change (0 moved).
--
-- Reversible:
--   * quartiles: restore the final SELECT to avg(<col>) OVER w + WINDOW w
--     AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING).
--   * sold dot <=5 filter: restore to
--     (c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5::numeric).
-- View defs only; no data/row writes. No JS change in this file (≤12 api/*.js).
-- =============================================================================

CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_quartiles_active_m AS
 WITH ma AS (
         SELECT DISTINCT cm_dialysis_active_listings_m.period_end
           FROM cm_dialysis_active_listings_m
        ), agg AS (
         SELECT m.period_end,
            count(*) FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS n_total,
            count(*) FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS n_core,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision)) FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS uqt,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision)) FILTER (WHERE b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS lqt,
            percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision)) FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS uqc,
            percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (b.last_cap_rate::double precision)) FILTER (WHERE b.is_core_10plus AND b.last_cap_rate >= 0.04 AND b.last_cap_rate <= 0.12) AS lqc
           FROM ma m
             LEFT JOIN cm_dialysis_active_listings_m b ON b.period_end > (m.period_end - '2 years'::interval)::date AND b.period_end <= m.period_end
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
    gated.uqt AS upper_q_total,
    gated.lqt AS lower_q_total,
    gated.uqc AS upper_q_core,
    gated.lqc AS lower_q_core
   FROM gated
  ORDER BY gated.period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS (
         SELECT s.sale_date,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
            s.firm_term_years_at_sale AS firm_term_years
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false) AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text]))) AND s.sale_date <= cm_last_completed_quarter_end()
        )
 SELECT m.period_end,
    'all'::text AS subspecialty,
    avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_12plus,
    avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 8::numeric AND c.firm_term_years < 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_8to12,
    avg(c.cap_rate) FILTER (WHERE c.firm_term_years > 5::numeric AND c.firm_term_years < 8::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_6to8,
    avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 0.5::numeric AND c.firm_term_years <= 5::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_5orless
   FROM month_anchors m
     LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
  GROUP BY m.period_end
  ORDER BY m.period_end;
