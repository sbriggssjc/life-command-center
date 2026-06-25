-- =============================================================================
-- T7 — de-smooth the returns indexes (gov + dia, _m views)
-- Projects: Dialysis_DB (zqzrriwuavgrquhisnoa) + government (scknotsqkcheojiaewwh)
-- Applied live 2026-06-25. View defs only; no data/row writes. ≤12 api/*.js.
--
-- Mirrors the T3/T3b sold/asking de-smooth. cm_<dom>_returns_indexes_m computed
-- the gated TTM cap blend (0.5*avg_cap_rate_ttm + 0.25*lower_q + 0.25*upper_q,
-- gated n>=4 trailing-year sales in the [0.04,0.12] band) and then wrapped it in
-- a REDUNDANT 7-month CENTERED moving average:
--     round(avg(<blend>) OVER w, 5)
--     WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end
--                  ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
-- That double-smoothing stripped most of the real month-over-month movement AND
-- manufactured values across the honest n<4 gaps (the centered window averages
-- over neighbouring months, so a NULL month got filled from its neighbours).
--
-- This removes ONLY the OVER w MA: the final SELECT now reads the gated TTM
-- blend (cash_return, leveraged_return_mid) directly out of the raw CTE. The
-- raw CTE — the TTM blend, the n>=4 density gate, and the cash/leveraged
-- formulas — is BYTE-IDENTICAL to the prior live body. Column contract
-- unchanged (period_end, subspecialty, cash_return, leveraged_return_mid).
--
-- Expect choppier lines (that is the point) — matching the PDF/Excel movement.
-- gov stays genuinely smoother than dia because GSA caps are ~22% less volatile
-- than dialysis, NOT because of a smoother. Do NOT re-introduce a moving
-- average. The n>=4 gate is the honesty floor (NULL months drop off the axis).
--
-- NOTE / grounding (live 2026-06-25): the prompt's "all four views" premise does
-- NOT hold. The _q views (cm_gov_returns_indexes_q / cm_dialysis_returns_indexes_q)
-- carry NO window function — they are quarterly-sourced (cm_<dom>_market_quarterly),
-- have no TTM blend, and a different column set (cash_return_upper/lower,
-- leveraged_return_low/high/mid). There is no smoother to remove from _q, so they
-- are left UNTOUCHED. Only the two _m views are de-smoothed here.
--
-- Reversible: re-create the prior body by restoring the final SELECT to
--   SELECT period_end, subspecialty,
--          round(avg(cash_return)        OVER w, 5) AS cash_return,
--          round(avg(leveraged_return_mid) OVER w, 5) AS leveraged_return_mid
--   FROM raw
--   WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end
--                ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING);
-- =============================================================================

-- ---- DIALYSIS (apply to Dialysis_DB) ----------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_returns_indexes_m AS
 WITH raw AS (
         SELECT m.period_end,
            m.subspecialty,
                CASE
                    WHEN band_n.n >= 4 THEN ((0.5 * m.avg_cap_rate_ttm)::double precision + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))::numeric
                    ELSE NULL::numeric
                END AS cash_return,
                CASE
                    WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL THEN (((0.5 * m.avg_cap_rate_ttm)::double precision + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) - ((m.low_loan_constant + m.high_loan_constant) / 2.0 * 0.5)::double precision) / 0.5::double precision)::numeric
                    ELSE NULL::numeric
                END AS leveraged_return_mid
           FROM cm_dialysis_market_quarterly_master_m m
             LEFT JOIN LATERAL ( SELECT count(*) AS n
                   FROM sales_transactions s
                  WHERE s.sale_date IS NOT NULL AND s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND
                        CASE
                            WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                            ELSE s.cap_rate_final
                        END >= 0.04 AND
                        CASE
                            WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                            ELSE s.cap_rate_final
                        END <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false) AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text])))) band_n ON true
        )
 SELECT raw.period_end,
    raw.subspecialty,
    raw.cash_return,
    raw.leveraged_return_mid
   FROM raw
  ORDER BY raw.subspecialty, raw.period_end;

-- ---- GOVERNMENT (apply to the government project) ---------------------------
CREATE OR REPLACE VIEW public.cm_gov_returns_indexes_m AS
 WITH raw AS (
         SELECT m.period_end,
            m.subspecialty,
                CASE
                    WHEN band_n.n >= 4 THEN ((0.5 * m.avg_cap_rate_ttm)::double precision + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))::numeric
                    ELSE NULL::numeric
                END AS cash_return,
                CASE
                    WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL THEN (((0.5 * m.avg_cap_rate_ttm)::double precision + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision) - ((m.low_loan_constant + m.high_loan_constant) / 2.0 * 0.5)::double precision) / 0.5::double precision)::numeric
                    ELSE NULL::numeric
                END AS leveraged_return_mid
           FROM cm_gov_market_quarterly_master_m_mat m
             LEFT JOIN LATERAL ( SELECT count(*) AS n
                   FROM sales_transactions s
                  WHERE s.sale_date IS NOT NULL AND s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false) AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text, 'brokered'::text, 'direct'::text, 'Owner-User'::text, 'Build-to-Suit'::text])))) band_n ON true
        )
 SELECT raw.period_end,
    raw.subspecialty,
    raw.cash_return,
    raw.leveraged_return_mid
   FROM raw
  ORDER BY raw.subspecialty, raw.period_end;
