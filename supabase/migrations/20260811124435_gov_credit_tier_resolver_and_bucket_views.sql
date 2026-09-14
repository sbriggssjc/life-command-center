-- =============================================================================
-- Government credit-tier resolver + multi-bucket cap-rate reporting
-- Project: government (scknotsqkcheojiaewwh)
-- Date: 2026-08-11
--
-- Purpose:
--   * Normalize Federal / State / Municipal tenant evidence in SQL.
--   * Expand one sale into multiple credit buckets when tenant evidence supports
--     more than one government bucket (for example state + federal tenants in
--     the same building/sale).
--   * Provide a read-only backfill identification view; this migration does
--     not mutate sales_transactions.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gov_credit_buckets_from_text(
  p_text text,
  p_government_type text DEFAULT NULL
)
RETURNS TABLE(bucket text, source text, evidence text)
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT
      ' ' || regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g') || ' ' AS txt,
      ' ' || regexp_replace(lower(coalesce(p_government_type, '')), '[^a-z0-9]+', ' ', 'g') || ' ' AS typ,
      left(regexp_replace(coalesce(p_text, p_government_type, ''), '[[:space:]]+', ' ', 'g'), 240) AS ev
  )
  SELECT 'federal'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% federal %'
  UNION
  SELECT 'state'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% state %'
  UNION
  SELECT 'municipal'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% municipal %'
     OR typ LIKE '% local %'
     OR typ LIKE '% county %'
     OR typ LIKE '% city %'
  UNION
  SELECT 'federal'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% u s %'
     OR txt LIKE '% us %'
     OR txt LIKE '% united states %'
     OR txt LIKE '% general services administration %'
     OR txt LIKE '% gsa %'
     OR txt LIKE '% federal %'
     OR txt LIKE '% department of veteran affairs %'
     OR txt LIKE '% department of veterans affairs %'
     OR txt LIKE '% veteran affairs %'
     OR txt LIKE '% veterans affairs %'
     OR txt LIKE '% va %'
     OR txt LIKE '% social security %'
     OR txt LIKE '% ssa %'
     OR txt LIKE '% irs %'
     OR txt LIKE '% fbi %'
     OR txt LIKE '% dea %'
     OR txt LIKE '% ice %'
     OR txt LIKE '% uscis %'
     OR txt LIKE '% fema %'
     OR txt LIKE '% usda %'
     OR txt LIKE '% hud %'
     OR txt LIKE '% epa %'
     OR txt LIKE '% fda %'
     OR txt LIKE '% doj %'
     OR txt LIKE '% dod %'
     OR txt LIKE '% dhs %'
     OR txt LIKE '% cbp %'
     OR txt LIKE '% tsa %'
     OR txt LIKE '% usps %'
     OR txt LIKE '% postal service %'
     OR txt LIKE '% customs and border %'
     OR txt LIKE '% immigration %'
     OR txt LIKE '% drug enforcement %'
     OR txt LIKE '% army %'
     OR txt LIKE '% navy %'
     OR txt LIKE '% naval %'
     OR txt LIKE '% air force %'
     OR txt LIKE '% coast guard %'
     OR txt LIKE '% border patrol %'
  UNION
  SELECT 'municipal'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% municipal %'
     OR txt LIKE '% local %'
     OR txt LIKE '% county of %'
     OR txt LIKE '% county %'
     OR txt LIKE '% city of %'
     OR txt LIKE '% city %'
     OR txt LIKE '% town of %'
     OR txt LIKE '% village of %'
     OR txt LIKE '% borough of %'
     OR txt LIKE '% parish of %'
     OR txt LIKE '% school district %'
     OR txt LIKE '% independent school district %'
     OR txt LIKE '% isd %'
     OR txt LIKE '% municipal utility district %'
     OR txt LIKE '% mud %'
     OR txt LIKE '% water district %'
     OR txt LIKE '% fire district %'
     OR txt LIKE '% police department %'
     OR txt LIKE '% sheriff s office %'
     OR txt LIKE '% public works %'
     OR txt LIKE '% city hall %'
     OR txt LIKE '% county courthouse %'
     OR txt LIKE '% courthouse %'
  UNION
  SELECT 'state'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% state of %'
     OR txt LIKE '% commonwealth of %'
     OR txt LIKE '% health and human services %'
     OR txt LIKE '% health human services %'
     OR txt LIKE '% human services %'
     OR txt LIKE '% child protective %'
     OR txt LIKE '% childrens protective %'
     OR txt LIKE '% children s protective %'
     OR txt LIKE '% adult protective %'
     OR txt LIKE '% family protective %'
     OR txt LIKE '% department of transportation %'
     OR txt LIKE '% department of corrections %'
     OR txt LIKE '% department of correction %'
     OR txt LIKE '% department of criminal justice %'
     OR txt LIKE '% department of public safety %'
     OR txt LIKE '% department of health %'
     OR txt LIKE '% department of state health %'
     OR txt LIKE '% department of human services %'
     OR txt LIKE '% department of family and protective services %'
     OR txt LIKE '% department of licensing %'
     OR txt LIKE '% department of revenue %'
     OR txt LIKE '% department of labor %'
     OR txt LIKE '% department of education %'
     OR txt LIKE '% criminal justice %'
     OR txt LIKE '% juvenile justice %'
     OR txt LIKE '% parks and wildlife %'
     OR txt LIKE '% park and wildlife %'
     OR txt LIKE '% comptroller %'
     OR txt LIKE '% environmental quality %'
     OR txt LIKE '% lottery commission %'
     OR txt LIKE '% land office %'
     OR txt LIKE '% railroad commission %'
     OR txt LIKE '% workforce commission %'
     OR txt LIKE '% workforce solutions %'
     OR txt LIKE '% workforce development board %'
     OR txt LIKE '% education agency %'
     OR txt LIKE '% administrative hearings %'
     OR txt LIKE '% water development board %'
     OR txt LIKE '% alcoholic beverage commission %'
     OR txt LIKE '% alcoholic beverage control %'
     OR txt LIKE '% licensing and regulation %'
     OR txt LIKE '% securities board %'
     OR txt LIKE '% public safety %'
     OR txt LIKE '% state board %'
     OR txt LIKE '% historical commission %'
  ORDER BY bucket;
$$;

COMMENT ON FUNCTION public.gov_credit_buckets_from_text(text, text) IS
  'Conservative Federal/State/Municipal classifier for gov tenant/agency text. Returns multiple buckets when evidence supports multiple government tenants.';

CREATE OR REPLACE VIEW public.cm_gov_sale_credit_bucket_expanded
WITH (security_invoker = true) AS
WITH candidates AS (
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    s.sold_cap_rate,
    s.cap_rate_quality,
    s.exclude_from_market_metrics,
    s.agency AS sale_agency,
    s.government_type AS sale_government_type,
    p.agency AS property_agency,
    p.agency_full_name AS property_agency_full_name,
    p.government_type AS property_government_type,
    'sale'::text AS source_table,
    concat_ws(' | ', s.government_type, s.agency, s.agency_full, s.agency_canonical, s.sale_notes_raw) AS source_text,
    s.government_type AS source_government_type
  FROM public.sales_transactions s
  LEFT JOIN public.properties p ON p.property_id = s.property_id
  UNION ALL
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    s.sold_cap_rate,
    s.cap_rate_quality,
    s.exclude_from_market_metrics,
    s.agency,
    s.government_type,
    p.agency,
    p.agency_full_name,
    p.government_type,
    'property'::text,
    concat_ws(' | ', p.government_type, p.agency, p.agency_full_name, p.agency_full, p.agency_canonical),
    p.government_type
  FROM public.sales_transactions s
  JOIN public.properties p ON p.property_id = s.property_id
  UNION ALL
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    s.sold_cap_rate,
    s.cap_rate_quality,
    s.exclude_from_market_metrics,
    s.agency,
    s.government_type,
    p.agency,
    p.agency_full_name,
    p.government_type,
    'lease'::text,
    concat_ws(' | ', l.government_type, l.tenant_agency, l.tenant_agency_full, l.lease_number),
    l.government_type
  FROM public.sales_transactions s
  JOIN public.properties p ON p.property_id = s.property_id
  JOIN public.leases l ON l.property_id = s.property_id
    AND (
      s.sale_date IS NULL
      OR l.expiration_date IS NULL
      OR l.expiration_date >= (s.sale_date - interval '1 year')::date
    )
),
expanded AS (
  SELECT
    c.*,
    b.bucket,
    b.source,
    b.evidence
  FROM candidates c
  CROSS JOIN LATERAL public.gov_credit_buckets_from_text(c.source_text, c.source_government_type) b
),
dedup AS (
  SELECT
    sale_id,
    property_id,
    sale_date,
    sold_price,
    sold_cap_rate,
    cap_rate_quality,
    exclude_from_market_metrics,
    bucket AS credit_bucket,
    array_agg(DISTINCT source_table ORDER BY source_table) AS source_tables,
    array_agg(DISTINCT source ORDER BY source) AS classifier_sources,
    left(string_agg(DISTINCT nullif(evidence, ''), ' | '), 800) AS evidence,
    max(sale_agency) AS sale_agency,
    max(sale_government_type) AS sale_government_type,
    max(property_agency) AS property_agency,
    max(property_agency_full_name) AS property_agency_full_name,
    max(property_government_type) AS property_government_type
  FROM expanded
  GROUP BY
    sale_id, property_id, sale_date, sold_price, sold_cap_rate,
    cap_rate_quality, exclude_from_market_metrics, bucket
)
SELECT * FROM dedup;

COMMENT ON VIEW public.cm_gov_sale_credit_bucket_expanded IS
  'One row per sale_id per Federal/State/Municipal bucket supported by sale/property/lease tenant evidence. A mixed-tenant sale intentionally appears in multiple buckets.';

CREATE OR REPLACE VIEW public.v_gov_sales_credit_tier_backfill_candidates
WITH (security_invoker = true) AS
WITH grouped AS (
  SELECT
    s.sale_id,
    s.property_id,
    s.sale_date,
    s.sold_price,
    s.sold_cap_rate,
    s.agency AS current_agency,
    s.government_type AS current_government_type,
    max(e.property_agency) AS property_agency,
    max(e.property_agency_full_name) AS property_agency_full_name,
    max(e.property_government_type) AS property_government_type,
    coalesce(
      array_agg(DISTINCT e.credit_bucket ORDER BY e.credit_bucket)
        FILTER (WHERE e.credit_bucket IS NOT NULL),
      ARRAY[]::text[]
    ) AS credit_buckets,
    left(string_agg(DISTINCT nullif(e.evidence, ''), ' | '), 800) AS evidence,
    coalesce(
      array_agg(DISTINCT unnest_source ORDER BY unnest_source)
        FILTER (WHERE unnest_source IS NOT NULL),
      ARRAY[]::text[]
    ) AS source_tables
  FROM public.sales_transactions s
  LEFT JOIN public.cm_gov_sale_credit_bucket_expanded e ON e.sale_id = s.sale_id
  LEFT JOIN LATERAL unnest(coalesce(e.source_tables, ARRAY[]::text[])) AS src(unnest_source) ON true
  GROUP BY
    s.sale_id, s.property_id, s.sale_date, s.sold_price, s.sold_cap_rate,
    s.agency, s.government_type
)
SELECT
  sale_id,
  property_id,
  sale_date,
  sold_price,
  sold_cap_rate,
  current_agency,
  current_government_type,
  property_agency,
  property_agency_full_name,
  property_government_type,
  credit_buckets,
  CASE WHEN cardinality(credit_buckets) = 1 THEN credit_buckets[1] ELSE NULL END AS recommended_government_type,
  coalesce(nullif(current_agency, ''), nullif(property_agency_full_name, ''), nullif(property_agency, '')) AS recommended_agency,
  evidence,
  source_tables,
  CASE
    WHEN cardinality(credit_buckets) > 1 THEN 'multi_bucket_reporting_only'
    WHEN cardinality(credit_buckets) = 1
      AND (current_government_type IS NULL OR btrim(current_government_type) = ''
           OR current_agency IS NULL OR btrim(current_agency) = '')
      THEN 'fill_sale_scalar_blanks'
    WHEN cardinality(credit_buckets) = 1 THEN 'already_classified_or_no_blank'
    ELSE 'needs_review_no_bucket'
  END AS recommended_action
FROM grouped
WHERE current_government_type IS NULL
   OR btrim(current_government_type) = ''
   OR current_agency IS NULL
   OR btrim(current_agency) = ''
   OR cardinality(credit_buckets) > 1
ORDER BY
  CASE
    WHEN cardinality(credit_buckets) = 1
      AND (current_government_type IS NULL OR btrim(current_government_type) = '') THEN 1
    WHEN cardinality(credit_buckets) > 1 THEN 2
    ELSE 3
  END,
  sale_date DESC NULLS LAST;

COMMENT ON VIEW public.v_gov_sales_credit_tier_backfill_candidates IS
  'Read-only candidate list for fill-blank sales_transactions agency/government_type cleanup plus multi-bucket sale reporting identification. Does not mutate data.';

CREATE OR REPLACE VIEW public.cm_gov_cap_by_credit_q
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    (date_trunc('quarter', e.sale_date::timestamptz) + '3 mons -1 days'::interval)::date AS period_end,
    e.sale_date,
    CASE WHEN e.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE e.sold_cap_rate END AS cap,
    e.credit_bucket AS credit_class
  FROM public.cm_gov_sale_credit_bucket_expanded e
  WHERE e.sale_date IS NOT NULL
    AND e.sold_price IS NOT NULL
    AND e.sold_price > 0
    AND e.sold_cap_rate IS NOT NULL
    AND e.sold_cap_rate >= 0.04
    AND e.sold_cap_rate <= 0.12
    AND NOT coalesce(e.exclude_from_market_metrics, false)
    AND e.sale_date <= public.cm_last_completed_quarter_end()
),
quarters AS (
  SELECT DISTINCT period_end FROM base
),
ttm AS (
  SELECT
    q.period_end,
    avg(b.cap) FILTER (WHERE b.credit_class = 'federal') AS federal_avg,
    count(*) FILTER (WHERE b.credit_class = 'federal') AS federal_n,
    avg(b.cap) FILTER (WHERE b.credit_class = 'state') AS state_avg,
    count(*) FILTER (WHERE b.credit_class = 'state') AS state_n,
    avg(b.cap) FILTER (WHERE b.credit_class = 'municipal') AS muni_avg,
    count(*) FILTER (WHERE b.credit_class = 'municipal') AS muni_n
  FROM quarters q
  LEFT JOIN base b
    ON b.sale_date > (q.period_end - '1 year'::interval)::date
   AND b.sale_date <= q.period_end
  GROUP BY q.period_end
)
SELECT
  period_end,
  'all'::text AS subspecialty,
  CASE WHEN federal_n >= 3 THEN federal_avg END AS federal_cap,
  CASE WHEN state_n >= 2 THEN state_avg END AS state_cap,
  CASE WHEN muni_n >= 2 THEN muni_avg END AS municipal_cap
FROM ttm
ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_cap_by_credit_m
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    (date_trunc('month', e.sale_date::timestamptz) + '1 mon -1 day'::interval)::date AS period_end,
    e.sale_date,
    CASE WHEN e.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE e.sold_cap_rate END AS cap,
    e.credit_bucket AS credit_class
  FROM public.cm_gov_sale_credit_bucket_expanded e
  WHERE e.sale_date IS NOT NULL
    AND e.sold_price IS NOT NULL
    AND e.sold_price > 0
    AND e.sold_cap_rate IS NOT NULL
    AND e.sold_cap_rate >= 0.04
    AND e.sold_cap_rate <= 0.12
    AND NOT coalesce(e.exclude_from_market_metrics, false)
    AND e.sale_date <= public.cm_last_completed_month_end()
),
months AS (
  SELECT DISTINCT period_end FROM base
),
ttm AS (
  SELECT
    m.period_end,
    avg(b.cap) FILTER (WHERE b.credit_class = 'federal') AS federal_avg,
    count(*) FILTER (WHERE b.credit_class = 'federal') AS federal_n,
    avg(b.cap) FILTER (WHERE b.credit_class = 'state') AS state_avg,
    count(*) FILTER (WHERE b.credit_class = 'state') AS state_n,
    avg(b.cap) FILTER (WHERE b.credit_class = 'municipal') AS muni_avg,
    count(*) FILTER (WHERE b.credit_class = 'municipal') AS muni_n
  FROM months m
  LEFT JOIN base b
    ON b.sale_date > (m.period_end - '1 year'::interval)::date
   AND b.sale_date <= m.period_end
  GROUP BY m.period_end
)
SELECT
  period_end,
  'all'::text AS subspecialty,
  CASE WHEN federal_n >= 3 THEN federal_avg END AS federal_cap,
  CASE WHEN state_n >= 2 THEN state_avg END AS state_cap,
  CASE WHEN muni_n >= 2 THEN muni_avg END AS municipal_cap
FROM ttm
ORDER BY period_end;

GRANT EXECUTE ON FUNCTION public.gov_credit_buckets_from_text(text, text) TO anon, authenticated, service_role;
GRANT SELECT ON public.cm_gov_sale_credit_bucket_expanded TO anon, authenticated, service_role;
GRANT SELECT ON public.v_gov_sales_credit_tier_backfill_candidates TO anon, authenticated, service_role;
GRANT SELECT ON public.cm_gov_cap_by_credit_q TO anon, authenticated, service_role;
GRANT SELECT ON public.cm_gov_cap_by_credit_m TO anon, authenticated, service_role;
