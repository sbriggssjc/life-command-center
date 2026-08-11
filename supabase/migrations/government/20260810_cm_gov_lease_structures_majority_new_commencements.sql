-- ============================================================================
-- Government capital markets: lease structures table
--
-- Replace cm_gov_lease_structures with a commencement-window view that matches
-- the report question:
--   * new / new-replacing federal GSA lease commencements
--   * current quarter, trailing 12 months, trailing 5 years
--   * majority-building / single-tenant-relevant cohort (pct_building >= 50)
--
-- The prior view was effectively counting broad/bulk GSA lease-event rows, which
-- made "current_quarter" total 3,989 and caused several columns to show similar
-- counts. That is not representative for a capital-markets audience that owns
-- existing single-tenant or primarily GSA-tenanted assets.
-- ============================================================================

CREATE OR REPLACE VIEW public.cm_gov_lease_structures AS
WITH params AS (
  SELECT public.cm_last_completed_quarter_end()::date AS as_of
),
windows AS (
  SELECT
    'current_quarter'::text AS period_label,
    date_trunc('quarter', p.as_of)::date AS start_date,
    p.as_of AS end_date,
    1 AS sort_period
  FROM params p
  UNION ALL
  SELECT
    'ttm'::text AS period_label,
    (p.as_of - interval '1 year')::date + 1 AS start_date,
    p.as_of AS end_date,
    2 AS sort_period
  FROM params p
  UNION ALL
  SELECT
    'last_5_years'::text AS period_label,
    (p.as_of - interval '5 years')::date + 1 AS start_date,
    p.as_of AS end_date,
    3 AS sort_period
  FROM params p
),
base AS (
  SELECT
    gl.gsa_lease_id,
    gl.lease_number,
    gl.lease_effective::date AS lease_effective,
    gl.lease_expiration::date AS lease_expiration,
    gl.termination_date::date AS termination_date,
    gl.latest_action,
    gl.pct_building,
    GREATEST(
      1,
      ROUND(((gl.lease_expiration::date - gl.lease_effective::date)::numeric / 365.25))::int
    ) AS total_term_years,
    CASE
      WHEN gl.termination_date IS NOT NULL
       AND gl.termination_date::date > gl.lease_effective::date
      THEN LEAST(
        GREATEST(
          1,
          ROUND(((gl.termination_date::date - gl.lease_effective::date)::numeric / 365.25))::int
        ),
        GREATEST(
          1,
          ROUND(((gl.lease_expiration::date - gl.lease_effective::date)::numeric / 365.25))::int
        )
      )
      ELSE NULL
    END AS firm_term_years
  FROM public.gsa_leases gl
  WHERE gl.lease_effective IS NOT NULL
    AND gl.lease_expiration IS NOT NULL
    AND gl.lease_expiration::date > gl.lease_effective::date
    AND gl.latest_action IN ('New', 'New/Replacing')
    AND gl.pct_building IS NOT NULL
    AND gl.pct_building >= 50
),
bucketed AS (
  SELECT
    w.period_label,
    w.sort_period,
    CASE
      WHEN b.total_term_years IS NULL THEN 'unknown'
      WHEN b.firm_term_years IS NOT NULL THEN b.total_term_years::text || ', ' || b.firm_term_years::text
      WHEN b.total_term_years <= 5 THEN '1-5 yr (firm n/a)'
      WHEN b.total_term_years <= 10 THEN '6-10 yr (firm n/a)'
      WHEN b.total_term_years <= 15 THEN '11-15 yr (firm n/a)'
      WHEN b.total_term_years <= 20 THEN '16-20 yr (firm n/a)'
      ELSE '20+ yr (firm n/a)'
    END AS term_bucket,
    CASE
      WHEN b.total_term_years IS NULL THEN 9999
      WHEN b.firm_term_years IS NOT NULL THEN b.total_term_years * 100 + b.firm_term_years
      WHEN b.total_term_years <= 5 THEN 590
      WHEN b.total_term_years <= 10 THEN 1090
      WHEN b.total_term_years <= 15 THEN 1590
      WHEN b.total_term_years <= 20 THEN 2090
      ELSE 9990
    END AS sort_bucket,
    count(*) AS bucket_count
  FROM windows w
  JOIN base b
    ON b.lease_effective >= w.start_date
   AND b.lease_effective <= w.end_date
  GROUP BY w.period_label, w.sort_period, term_bucket, sort_bucket
),
totals AS (
  SELECT
    period_label,
    sum(bucket_count)::numeric AS total_count
  FROM bucketed
  GROUP BY period_label
)
SELECT
  b.period_label,
  b.term_bucket,
  b.bucket_count,
  CASE
    WHEN t.total_count > 0 THEN b.bucket_count::numeric / t.total_count
    ELSE NULL::numeric
  END AS pct_of_total
FROM bucketed b
JOIN totals t USING (period_label)
ORDER BY b.sort_period, b.bucket_count DESC, b.sort_bucket, b.term_bucket;

COMMENT ON VIEW public.cm_gov_lease_structures IS
  'Capital markets lease-structure mix for new/new-replacing GSA commencements in the current quarter, TTM, and 5-year windows. Cohort limited to pct_building >= 50 so it represents single-tenant or primarily GSA-tenanted assets.';

GRANT SELECT ON public.cm_gov_lease_structures TO anon, authenticated, service_role;
