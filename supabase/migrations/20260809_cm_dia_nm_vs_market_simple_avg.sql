-- ============================================================================
-- CM chart feedback item #4 (B1/B2) — NM vs Market cap: SIMPLE-AVERAGE basis
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- ============================================================================
-- The charted NM-vs-Market cap series was computed on TWO DIFFERENT bases: the
-- NM leg was DOLLAR-WEIGHTED (sum(price*cap)/sum(price)) while the Market leg —
-- and every OTHER TTM cap chart in the deck — is a SIMPLE AVERAGE. Large deals
-- dominated and over-smoothed the NM line, so it looked different from the rest
-- for a silent methodological reason.
--
-- Fix (Scott sign-off 2026-08: simple average, weighting preserved but not
-- charted):
--   * nm_cap_rate    -> SIMPLE TTM average of qualifying NM caps (was weighted)
--   * market_cap_rate -> unchanged (already a simple avg of non-NM brokered)
--   * nm_cap_wtd / market_cap_wtd -> the DOLLAR-WEIGHTED values, kept as
--     separate columns for audit/reference (NOT charted).
--   * nm_n / mkt_n -> the TTM qualifying-cap counts, exposed for the
--     display_from registry (B2) and honest gating.
-- Market series confirmed to EXCLUDE Northmarq deals (non-NM = market).
--
-- Additive/reversible: CREATE OR REPLACE VIEW. To revert, restore the prior
-- body from 20260702_cm_round66h_dia_nm_priceweighted.sql. Data-layer change is
-- live immediately (CM export reads views per request, no deploy).
-- ============================================================================

CREATE OR REPLACE VIEW cm_dialysis_nm_vs_market_m AS
WITH month_anchors AS (
  SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
  FROM generate_series('2001-01-01'::date::timestamptz,
                       cm_last_completed_quarter_end()::timestamptz,
                       '1 mon'::interval) g(d)
),
classified AS (
  SELECT s.sale_date,
         s.sold_price,
         CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL
              ELSE s.cap_rate_final END AS cap_rate,
         s.is_northmarq,
         (COALESCE(NULLIF(btrim(s.listing_broker), ''), NULLIF(btrim(s.procuring_broker), '')) IS NOT NULL
           OR s.listing_broker_id IS NOT NULL
           OR s.procuring_broker_id IS NOT NULL) AS brokered
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL
    AND s.sold_price IS NOT NULL AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics, false)
    AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment','Resale']))
    AND s.sale_date <= cm_last_completed_quarter_end()
),
ttm AS (
  SELECT m.period_end,
         -- SIMPLE averages (the charted basis)
         avg(c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_avg,
         avg(c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_avg,
         -- DOLLAR-WEIGHTED components (kept for the *_wtd reference columns)
         sum(c.sold_price * c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_wsum,
         sum(c.sold_price)              FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_psum,
         sum(c.sold_price * c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_wsum,
         sum(c.sold_price)              FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_psum,
         count(*) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_n,
         count(*) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_n
  FROM month_anchors m
  LEFT JOIN classified c
    ON c.sale_date > (m.period_end - '1 year'::interval)::date
   AND c.sale_date <= m.period_end
  GROUP BY m.period_end
),
gated AS (
  SELECT ttm.period_end,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_avg  END AS nm_g,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_avg END AS mkt_g,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_wsum  / NULLIF(ttm.nm_psum,  0) END AS nm_wg,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_wsum / NULLIF(ttm.mkt_psum, 0) END AS mkt_wg,
         ttm.nm_n, ttm.mkt_n
  FROM ttm
)
SELECT gated.period_end,
       'all'::text AS subspecialty,
       avg(gated.nm_g)  OVER w AS nm_cap_rate,      -- SIMPLE avg (charted)
       avg(gated.mkt_g) OVER w AS market_cap_rate,  -- SIMPLE avg (charted, unchanged)
       avg(gated.nm_wg)  OVER w AS nm_cap_wtd,       -- $-weighted (reference, not charted)
       avg(gated.mkt_wg) OVER w AS market_cap_wtd,   -- $-weighted (reference, not charted)
       gated.nm_n,
       gated.mkt_n
FROM gated
WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
ORDER BY gated.period_end;

COMMENT ON VIEW cm_dialysis_nm_vs_market_m IS
  'NM vs Market TTM cap. nm_cap_rate/market_cap_rate = SIMPLE averages of qualifying caps (0.04-0.12 band; market excludes Northmarq deals). nm_cap_wtd/market_cap_wtd = dollar-weighted equivalents (reference, not charted). nm_n/mkt_n = TTM qualifying counts (drive display_from). 9-period centered smoothing. CM feedback item #4 (2026-08).';

-- ----------------------------------------------------------------------------
-- B2 — display_from registration (Dialysis_DB). NM caps are too thin to plot a
-- credible line before the sustained modern era. A real but ISOLATED pre-GFC
-- cluster (2008: 11 months with nm_n>=5) is followed by a genuine 2009-2011
-- collapse (nm_n 0-1); the consecutive-run gate would start at 2007/08 and then
-- gap-skip 2009-2011, which reads oddly. display_from is therefore CURATED to
-- 2012-01-01 and n_column set NULL so cm_refresh_display_from() preserves it
-- (the cron only recomputes rows with a non-null n_column). min_n_threshold=5
-- retained to document the intent.
INSERT INTO cm_view_registry (view_name, chart_template_id, vertical, subspecialty,
       data_shape, refresh_strategy, is_active, min_n_threshold, consecutive_periods,
       n_column, n_source_view, display_from, notes)
VALUES ('cm_dialysis_nm_vs_market_m', 'nm_vs_market_cap', 'dialysis', NULL,
        'time_series', 'live', true, 5, 4, NULL, NULL, DATE '2012-01-01',
        'CM feedback item #4: NM cap series starts at the sustained modern era (2012). Curated display_from; n_column NULL so refresh preserves it.')
ON CONFLICT (view_name) DO UPDATE SET
  min_n_threshold = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column = EXCLUDED.n_column,
  display_from = EXCLUDED.display_from,
  notes = EXCLUDED.notes;

-- gov note: the gov cm_view_registry has no display_from columns; gov's ~2012
-- NM start is enforced by the injector MIN_YEAR floor (Math.max(2012, ...)) in
-- cm-native-chart-injector.js instead. See government/20260809_cm_gov_nm_vs_market_simple_avg.sql.
