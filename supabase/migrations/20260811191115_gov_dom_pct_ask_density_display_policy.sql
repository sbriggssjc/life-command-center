-- Government CM DOM / % ask density and display policy
--
-- The export/native renderer temporarily used a gov-only hard-coded 2011
-- fallback because cm_gov_dom_pct_ask_m did not expose a density column. Add
-- the same explicit contract the renderer already understands: n_sales is the
-- lower of the trailing-12-month valid DOM and price-realization sample counts,
-- and 2011-01-01 is the curated display floor where every monthly TTM window
-- clears n>=15 for both plotted series.
--
-- View edits are append-only: existing four columns stay in place and the new
-- QA/display-policy fields are appended at the end.

CREATE OR REPLACE VIEW public.cm_gov_dom_pct_ask_m AS
WITH base AS (
  SELECT
    m.period_end,
    m.subspecialty,
    m.avg_dom,
    m.pct_of_ask
  FROM public.cm_gov_market_quarterly_master_m_mat m
),
stats AS (
  SELECT
    b.period_end,
    count(*) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.on_market_date IS NOT NULL
        AND s.sale_date > s.on_market_date
        AND (s.sale_date - s.on_market_date) BETWEEN 1 AND 1095
    ) AS dom_n,
    count(*) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.last_price IS NOT NULL
        AND s.last_price > 0
        AND (s.sold_price / s.last_price) BETWEEN 0.5 AND 1.5
    ) AS ask_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.sale_date - s.on_market_date)::double precision) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.on_market_date IS NOT NULL
        AND s.sale_date > s.on_market_date
        AND (s.sale_date - s.on_market_date) BETWEEN 1 AND 1095
    ) AS median_dom_raw,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.sold_price / s.last_price)::double precision) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.last_price IS NOT NULL
        AND s.last_price > 0
        AND (s.sold_price / s.last_price) BETWEEN 0.5 AND 1.5
    ) AS median_pct_raw
  FROM base b
  LEFT JOIN public.sales_transactions s
    ON s.sale_date > (b.period_end - interval '1 year')::date
   AND s.sale_date <= b.period_end
   AND s.comp_scope IS DISTINCT FROM 'market_offuniverse'
   AND s.exclude_from_market_metrics IS NOT TRUE
  GROUP BY b.period_end
)
SELECT
  b.period_end,
  b.subspecialty,
  CASE WHEN s.dom_n >= 5 THEN b.avg_dom END AS avg_dom,
  CASE WHEN s.ask_n >= 5 THEN b.pct_of_ask END AS pct_of_ask,
  LEAST(s.dom_n, s.ask_n) AS n_sales,
  CASE WHEN s.dom_n >= 5 THEN s.median_dom_raw END::numeric(10,1) AS median_dom,
  CASE WHEN s.ask_n >= 5 THEN s.median_pct_raw END::numeric(8,5) AS median_pct_of_ask
FROM base b
LEFT JOIN stats s ON s.period_end = b.period_end;

CREATE OR REPLACE VIEW public.cm_gov_dom_pct_ask_q AS
WITH base AS (
  SELECT
    q.period_end,
    q.subspecialty,
    q.avg_dom,
    q.pct_of_ask
  FROM public.cm_gov_market_quarterly q
  WHERE q.avg_dom IS NOT NULL
     OR q.pct_of_ask IS NOT NULL
),
stats AS (
  SELECT
    b.period_end,
    count(*) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.on_market_date IS NOT NULL
        AND s.sale_date > s.on_market_date
        AND (s.sale_date - s.on_market_date) BETWEEN 1 AND 1095
    ) AS dom_n,
    count(*) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.initial_price IS NOT NULL
        AND s.initial_price > 0
        AND (s.sold_price / s.initial_price) BETWEEN 0.5 AND 1.5
    ) AS ask_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.sale_date - s.on_market_date)::double precision) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.on_market_date IS NOT NULL
        AND s.sale_date > s.on_market_date
        AND (s.sale_date - s.on_market_date) BETWEEN 1 AND 1095
    ) AS median_dom_raw,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.sold_price / s.initial_price)::double precision) FILTER (
      WHERE s.sale_date IS NOT NULL
        AND s.sold_price > 0
        AND s.initial_price IS NOT NULL
        AND s.initial_price > 0
        AND (s.sold_price / s.initial_price) BETWEEN 0.5 AND 1.5
    ) AS median_pct_raw
  FROM base b
  LEFT JOIN public.sales_transactions s
    ON s.sale_date > (b.period_end - interval '1 year')::date
   AND s.sale_date <= b.period_end
   AND s.comp_scope IS DISTINCT FROM 'market_offuniverse'
   AND s.exclude_from_market_metrics IS NOT TRUE
  GROUP BY b.period_end
)
SELECT
  b.period_end,
  b.subspecialty,
  b.avg_dom,
  b.pct_of_ask,
  LEAST(s.dom_n, s.ask_n) AS n_sales,
  CASE WHEN s.dom_n >= 5 THEN s.median_dom_raw END::numeric(10,1) AS median_dom,
  CASE WHEN s.ask_n >= 5 THEN s.median_pct_raw END::numeric(8,5) AS median_pct_of_ask
FROM base b
LEFT JOIN stats s ON s.period_end = b.period_end;

INSERT INTO public.cm_view_registry (
  view_name,
  chart_template_id,
  vertical,
  subspecialty,
  data_shape,
  refresh_strategy,
  is_active,
  notes,
  min_n_threshold,
  consecutive_periods,
  n_column,
  n_source_view,
  display_from
) VALUES
  (
    'cm_gov_dom_pct_ask_m',
    'dom_and_pct_of_ask',
    'gov',
    'all',
    'time_series_monthly_dual',
    'view',
    true,
    'Government DOM/% ask display floor: first full monthly year where every TTM window has at least 15 valid observations for both DOM and ask-price realization.',
    15,
    4,
    'n_sales',
    'cm_gov_dom_pct_ask_m',
    date '2011-01-01'
  ),
  (
    'cm_gov_dom_pct_ask_q',
    'dom_and_pct_of_ask',
    'gov',
    'all',
    'time_series_quarterly_dual',
    'view',
    true,
    'Government quarterly DOM/% ask sibling; uses the same TTM n_sales/display policy as the monthly export source.',
    15,
    4,
    'n_sales',
    'cm_gov_dom_pct_ask_q',
    date '2011-01-01'
  )
ON CONFLICT (view_name) DO UPDATE SET
  chart_template_id = EXCLUDED.chart_template_id,
  vertical = EXCLUDED.vertical,
  subspecialty = EXCLUDED.subspecialty,
  data_shape = EXCLUDED.data_shape,
  refresh_strategy = EXCLUDED.refresh_strategy,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes,
  min_n_threshold = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column = EXCLUDED.n_column,
  n_source_view = EXCLUDED.n_source_view,
  display_from = EXCLUDED.display_from;

COMMENT ON VIEW public.cm_gov_dom_pct_ask_m IS
  'Government DOM/% ask monthly wrapper with appended n_sales, median_dom, and median_pct_of_ask QA/display-policy columns.';

COMMENT ON VIEW public.cm_gov_dom_pct_ask_q IS
  'Government DOM/% ask quarterly wrapper with appended n_sales, median_dom, and median_pct_of_ask QA/display-policy columns.';

GRANT SELECT ON public.cm_gov_dom_pct_ask_m TO anon, authenticated;
GRANT SELECT ON public.cm_gov_dom_pct_ask_q TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
