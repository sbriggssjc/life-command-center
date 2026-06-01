-- =============================================================================
-- Migration: cm_dialysis/cm_gov_returns_indexes_m — R66f Cash Return Index blend
-- Projects:  Dialysis_DB (zqzrriwuavgrquhisnoa) + government (scknotsqkcheojiaewwh)
-- Date:       2026-06-01
--
-- Audit fix #4 (Cash Return Index). The master comp workbook computes the Cash
-- Return Index as a QUARTILE BLEND:  0.5*AvgCap + 0.25*LowerQuartile +
-- 0.25*UpperQuartile  (dia Charts!BF / gov All Charts!BM). Our views used the
-- bare TTM average cap, so the cash line didn't reproduce the deck (PDF dia
-- ~7.40%). Now both verticals use the blend, with graceful degradation: if a
-- quartile is NULL in a thin window, that leg falls back to the avg cap so the
-- line is never blanker than before. The leveraged return now feeds from the
-- blended index (master BG uses BF); the (yield - 0.5*LC)/0.5 form is
-- algebraically identical to the master's framing, LC = mid of the +180/+220 bps
-- loan-constant band. Column contract unchanged. Applied to prod 2026-06-01.
--
-- NOTE (pre-existing, not introduced here): the gov band_n gate counts only
-- sold_cap_rate-in-band sales while the matview's avg_cap_rate_ttm uses a broader
-- cap COALESCE, so the gov cash/leveraged lines blank out in windows where
-- sold_cap_rate is sparse (e.g. mid-2024). That gate/field mismatch is tracked
-- under the gov cap-field consistency item, separate from this blend fix.
-- =============================================================================

-- ---- DIALYSIS (apply to Dialysis_DB) ----------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_returns_indexes_m AS
 SELECT m.period_end, m.subspecialty,
   CASE WHEN band_n.n >= 4
        THEN (0.5*m.avg_cap_rate_ttm
              + 0.25*COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm)
              + 0.25*COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm))::numeric
        ELSE NULL::numeric END AS cash_return,
   CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL
        THEN (((0.5*m.avg_cap_rate_ttm
              + 0.25*COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm)
              + 0.25*COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm))
              - (m.low_loan_constant + m.high_loan_constant)/2.0 * 0.5) / 0.5)::numeric
        ELSE NULL::numeric END AS leveraged_return_mid
 FROM cm_dialysis_market_quarterly_master_m m
 LEFT JOIN LATERAL ( SELECT count(*) AS n
     FROM sales_transactions s
     WHERE s.sale_date IS NOT NULL AND s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
       AND CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate,s.stated_cap_rate,s.cap_rate) END >= 0.04
       AND CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate,s.stated_cap_rate,s.cap_rate) END <= 0.12
       AND NOT COALESCE(s.exclude_from_market_metrics,false)
       AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))) band_n ON true;

-- ---- GOVERNMENT (apply to the government project) ---------------------------
CREATE OR REPLACE VIEW public.cm_gov_returns_indexes_m AS
 SELECT m.period_end, m.subspecialty,
   CASE WHEN band_n.n >= 4
        THEN (0.5*m.avg_cap_rate_ttm
              + 0.25*COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm)
              + 0.25*COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm))::numeric
        ELSE NULL::numeric END AS cash_return,
   CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL
        THEN (((0.5*m.avg_cap_rate_ttm
              + 0.25*COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm)
              + 0.25*COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm))
              - (m.low_loan_constant + m.high_loan_constant)/2.0 * 0.5) / 0.5)::numeric
        ELSE NULL::numeric END AS leveraged_return_mid
 FROM cm_gov_market_quarterly_master_m_mat m
 LEFT JOIN LATERAL ( SELECT count(*) AS n
     FROM sales_transactions s
     WHERE s.sale_date IS NOT NULL AND s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end
       AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
       AND NOT COALESCE(s.exclude_from_market_metrics,false)
       AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))) band_n ON true;
