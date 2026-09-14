-- ============================================================================
-- CM chart fixes round 3, item 6 — NM vs Market cap: TRAILING-24-MONTH basis
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- ============================================================================
-- Per Scott's standing decision (round 3, 2026-08): the charted NM vs Market cap
-- series move to a TRAILING-24-MONTH SIMPLE AVERAGE for BOTH legs (same canonical
-- filters as the prior 12-month build — 0.04-0.12 band, market = non-Northmarq
-- brokered). This is NOT a revert to the retired dollar-weighted basis; it widens
-- the smoothing window from 12 to 24 months so the two legs are less jumpy on the
-- thin NM sample. gov already computes a 24-month TTM; this brings dia to parity.
--
--   * nm_cap_rate / market_cap_rate  -> 24-MONTH simple TTM average (CHARTED)
--   * nm_cap_wtd / market_cap_wtd     -> 24-month dollar-weighted (reference)
--   * nm_n / mkt_n                     -> 24-month qualifying counts (drive display_from)
--   * nm_cap_ttm12 / market_cap_ttm12 -> the 12-MONTH TTM simple averages, kept
--                                        on the sheet as REFERENCE (uncharted).
--
-- Column order of the pre-existing columns is preserved and the two 12-month
-- reference columns are APPENDED at the end (CREATE OR REPLACE VIEW is
-- append-only for columns — 42P16 otherwise). Additive/reversible: to revert,
-- restore the prior body from 20260809_cm_dia_nm_vs_market_simple_avg.sql. Live
-- immediately (CM export reads views per request, no deploy).
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
         -- 24-MONTH simple averages (the charted basis)
         avg(c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_avg,
         avg(c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_avg,
         -- 24-month DOLLAR-WEIGHTED components (for the *_wtd reference columns)
         sum(c.sold_price * c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_wsum,
         sum(c.sold_price)              FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_psum,
         sum(c.sold_price * c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_wsum,
         sum(c.sold_price)              FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_psum,
         count(*) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_n,
         count(*) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_n,
         -- 12-MONTH simple averages (reference only, uncharted) — the subset of
         -- the 24-month join window whose sale fell within the trailing year.
         avg(c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12
                                 AND c.sale_date > (m.period_end - '1 year'::interval)::date) AS nm_avg12,
         avg(c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12
                                 AND c.sale_date > (m.period_end - '1 year'::interval)::date) AS mkt_avg12,
         count(*) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12
                          AND c.sale_date > (m.period_end - '1 year'::interval)::date) AS nm_n12,
         count(*) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12
                          AND c.sale_date > (m.period_end - '1 year'::interval)::date) AS mkt_n12
  FROM month_anchors m
  LEFT JOIN classified c
    ON c.sale_date > (m.period_end - '2 years'::interval)::date
   AND c.sale_date <= m.period_end
  GROUP BY m.period_end
),
gated AS (
  SELECT ttm.period_end,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_avg  END AS nm_g,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_avg END AS mkt_g,
         CASE WHEN ttm.nm_n  >= 3 THEN ttm.nm_wsum  / NULLIF(ttm.nm_psum,  0) END AS nm_wg,
         CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_wsum / NULLIF(ttm.mkt_psum, 0) END AS mkt_wg,
         CASE WHEN ttm.nm_n12  >= 3 THEN ttm.nm_avg12  END AS nm_g12,
         CASE WHEN ttm.mkt_n12 >= 3 THEN ttm.mkt_avg12 END AS mkt_g12,
         ttm.nm_n, ttm.mkt_n
  FROM ttm
)
SELECT gated.period_end,
       'all'::text AS subspecialty,
       avg(gated.nm_g)  OVER w AS nm_cap_rate,      -- 24-mo SIMPLE avg (charted)
       avg(gated.mkt_g) OVER w AS market_cap_rate,  -- 24-mo SIMPLE avg (charted)
       avg(gated.nm_wg)  OVER w AS nm_cap_wtd,       -- 24-mo $-weighted (reference)
       avg(gated.mkt_wg) OVER w AS market_cap_wtd,   -- 24-mo $-weighted (reference)
       gated.nm_n,
       gated.mkt_n,
       avg(gated.nm_g12)  OVER w AS nm_cap_ttm12,     -- 12-mo TTM simple avg (reference)
       avg(gated.mkt_g12) OVER w AS market_cap_ttm12  -- 12-mo TTM simple avg (reference)
FROM gated
WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
ORDER BY gated.period_end;

COMMENT ON VIEW cm_dialysis_nm_vs_market_m IS
  'NM vs Market cap. nm_cap_rate/market_cap_rate = TRAILING-24-MONTH SIMPLE averages of qualifying caps (0.04-0.12 band; market excludes Northmarq deals) — round-3 item 6 (Scott 2026-08, NOT a revert to weighted). nm_cap_wtd/market_cap_wtd = 24-mo dollar-weighted (reference, not charted). nm_cap_ttm12/market_cap_ttm12 = 12-mo TTM simple averages (reference, not charted). nm_n/mkt_n = 24-mo qualifying counts (drive display_from). 9-period centered smoothing.';

-- display_from — with the 24-month window the NM sample clears the n>=3 gate
-- earlier and more continuously; keep the curated 2012 modern-era start (the
-- isolated 2008 cluster + 2009-2011 collapse still read oddly). n_column NULL so
-- cm_refresh_display_from() preserves the curated value.
INSERT INTO cm_view_registry (view_name, chart_template_id, vertical, subspecialty,
       data_shape, refresh_strategy, is_active, min_n_threshold, consecutive_periods,
       n_column, n_source_view, display_from, notes)
VALUES ('cm_dialysis_nm_vs_market_m', 'nm_vs_market_cap', 'dialysis', NULL,
        'time_series', 'live', true, 5, 4, NULL, NULL, DATE '2012-01-01',
        'CM round-3 item 6: trailing-24-month simple-average basis. Curated display_from 2012 (modern era); n_column NULL so refresh preserves it.')
ON CONFLICT (view_name) DO UPDATE SET
  display_from = EXCLUDED.display_from,
  notes = EXCLUDED.notes;
