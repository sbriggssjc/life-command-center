-- ============================================================================
-- Government CM market turnover: source-level pre-2012 on-market crop
-- 2026-08-11
--
-- Live audit found cm_gov_market_turnover_m still emitted pre-2012 universe-
-- derived values from sparse historical on-market coverage:
--   * 84 rows before 2012-01-01
--   * 80 rows with non-null active_count / months_of_supply
--   * 84 rows with non-null market_universe / turnover_rate
--   * no cm_view_registry row for the gov market_turnover display floor
--
-- Those rows create on-market artifacts: active_count ~= 1 against >100 TTM
-- sales, turnover_rate ~= 99%, and months_of_supply ~= 0.09. Sales-history
-- columns are still legitimate transaction history, so keep those columns.
-- Null only the universe-derived on-market metrics before 2012 and register
-- display_from = 2012-01-01 so downstream exports/packets crop consistently.
-- ============================================================================

ALTER TABLE cm_view_registry
  ADD COLUMN IF NOT EXISTS min_n_threshold     integer,
  ADD COLUMN IF NOT EXISTS consecutive_periods integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS n_column            text,
  ADD COLUMN IF NOT EXISTS n_source_view       text,
  ADD COLUMN IF NOT EXISTS display_from        date;

CREATE OR REPLACE VIEW public.cm_gov_market_turnover_m AS
WITH months AS (
  SELECT ((date_trunc('month', g.d) + interval '1 mon -1 days'))::date AS period_end
  FROM generate_series(
    '2005-01-01'::date::timestamp with time zone,
    cm_last_completed_quarter_end()::timestamp with time zone,
    interval '1 mon'
  ) AS g(d)
), sentinel_dates AS (
  SELECT al.on_market_date AS d
  FROM available_listings al
  WHERE al.on_market_date IS NOT NULL
    AND al.listing_source IS DISTINCT FROM 'synthetic_from_sale'
    AND NOT COALESCE(al.exclude_from_listing_metrics, false)
  GROUP BY al.on_market_date
  HAVING count(*) >= 20
), eff AS (
  SELECT
    al.listing_id,
    al.property_id,
    al.on_market_date AS eff_start,
    al.off_market_date AS eff_end
  FROM available_listings al
  WHERE NOT COALESCE(al.exclude_from_listing_metrics, false)
    AND al.on_market_date IS NOT NULL
    AND NOT (al.off_market_date IS NOT NULL AND al.off_market_date <= al.on_market_date)
    AND (
      al.listing_source = 'synthetic_from_sale'
      OR NOT (al.on_market_date IN (SELECT d FROM sentinel_dates))
    )
), base AS (
  SELECT
    m.period_end,
    (
      SELECT count(*)
      FROM sales_transactions s
      WHERE s.sale_date > (m.period_end - interval '1 year')::date
        AND s.sale_date <= m.period_end
        AND s.sold_price > 0::numeric
        AND NOT COALESCE(s.exclude_from_market_metrics, false)
    ) AS ttm_sales,
    (
      SELECT count(*)
      FROM sales_transactions s
      WHERE s.sale_date > (m.period_end - interval '1 mon')::date
        AND s.sale_date <= m.period_end
        AND s.sold_price > 0::numeric
        AND NOT COALESCE(s.exclude_from_market_metrics, false)
    ) AS monthly_sales,
    (
      SELECT count(DISTINCT e.property_id)
      FROM eff e
      WHERE e.eff_start IS NOT NULL
        AND e.eff_start <= m.period_end
        AND (e.eff_end IS NULL OR e.eff_end > m.period_end)
        AND (m.period_end - e.eff_start) <= 1095
    ) AS raw_active_count
  FROM months m
)
SELECT
  period_end,
  'all'::text AS subspecialty,
  ttm_sales AS ttm_sales_count,
  CASE WHEN period_end >= DATE '2012-01-01'
       THEN raw_active_count + ttm_sales
       ELSE NULL::bigint
  END AS market_universe,
  CASE WHEN period_end >= DATE '2012-01-01'
       THEN ttm_sales::numeric / NULLIF(raw_active_count + ttm_sales, 0)::numeric
       ELSE NULL::numeric
  END AS turnover_rate,
  CASE WHEN period_end >= DATE '2012-01-01'
       THEN NULLIF(raw_active_count, 0)
       ELSE NULL::bigint
  END AS active_count,
  ttm_sales AS annual_sales_rate,
  CASE WHEN period_end >= DATE '2012-01-01' AND raw_active_count > 0 AND ttm_sales > 0
       THEN raw_active_count::numeric * 12::numeric / ttm_sales::numeric
       ELSE NULL::numeric
  END AS months_of_supply,
  monthly_sales AS monthly_sales_count
FROM base
ORDER BY period_end;

INSERT INTO cm_view_registry
  (view_name, chart_template_id, vertical, subspecialty, data_shape,
   refresh_strategy, is_active, min_n_threshold, consecutive_periods,
   n_column, n_source_view, display_from, notes)
VALUES
  (
    'cm_gov_market_turnover_m',
    'market_turnover',
    'gov',
    'all',
    'monthly_ttm',
    'live',
    true,
    NULL,
    4,
    NULL,
    NULL,
    DATE '2012-01-01',
    'Curated display_from for gov Market Turnover. Pre-2012 on-market/listing coverage is not robust enough for active universe, turnover rate, or months-of-supply; cm_gov_market_turnover_m preserves sales-history columns before 2012 but NULLs the universe-derived on-market metrics.'
  )
ON CONFLICT (view_name) DO UPDATE SET
  chart_template_id   = EXCLUDED.chart_template_id,
  vertical            = EXCLUDED.vertical,
  subspecialty        = EXCLUDED.subspecialty,
  data_shape          = EXCLUDED.data_shape,
  refresh_strategy    = EXCLUDED.refresh_strategy,
  is_active           = EXCLUDED.is_active,
  min_n_threshold     = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column            = EXCLUDED.n_column,
  n_source_view       = EXCLUDED.n_source_view,
  display_from        = EXCLUDED.display_from,
  notes               = EXCLUDED.notes;
