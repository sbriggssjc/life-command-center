-- Rent Intelligence Engine Phase 2 — NM attribution audit + gated value-prop (dia).
-- v_dia_nm_attribution_audit reconciles SF Internal-Sold (NM-brokered) comps vs
-- sales_transactions.is_northmarq. 2026-08 result: source too sparse (35 all-time /
-- 4 in 2023-26) to certify the 53 is_northmarq=TRUE 2023-26 flags -> value-prop NOT
-- published. cm_dialysis_value_prop_24m ships published=false until a real closed-won
-- feed lands. Applied live to zqzrriwuavgrquhisnoa.

CREATE OR REPLACE VIEW public.v_dia_nm_attribution_audit AS
WITH nm_sf AS (
  SELECT staging_id, normalized_address, sold_date, sold_price, linked_sale_id, linked_property_id
  FROM public.sf_comp_staging WHERE comp_type='Internal' AND status='Sold'),
matched AS (
  SELECT n.*, s.sale_id, s.is_northmarq, s.is_northmarq_source, s.sale_date, s.property_id
  FROM nm_sf n
  LEFT JOIN public.sales_transactions s
    ON s.sale_id = n.linked_sale_id
   OR (n.linked_sale_id IS NULL AND s.property_id = n.linked_property_id
       AND abs(s.sold_price - n.sold_price) < 50000 AND abs(s.sale_date - n.sold_date) < 120))
SELECT staging_id, normalized_address, sold_date AS sf_sold_date, sold_price AS sf_sold_price,
       sale_id, is_northmarq, is_northmarq_source,
       CASE WHEN sale_id IS NULL THEN 'unmatched_in_sales'
            WHEN is_northmarq IS TRUE THEN 'correctly_flagged_nm'
            ELSE 'nm_misclassified_as_market' END AS audit_verdict
FROM matched;

CREATE OR REPLACE VIEW public.cm_dialysis_value_prop_24m AS
WITH win AS (SELECT (CURRENT_DATE - INTERVAL '24 months')::date AS lo, CURRENT_DATE AS hi),
base AS (
  SELECT s.is_northmarq, s.calculated_cap_rate AS cap
  FROM public.sales_transactions s, win
  WHERE s.sale_date >= win.lo AND s.sale_date <= win.hi
    AND s.calculated_cap_rate IS NOT NULL AND s.calculated_cap_rate BETWEEN 0.03 AND 0.15
    AND s.sold_price IS NOT NULL)
SELECT
  false AS published,
  'pooled 24-month simple average of calculated_cap_rate; canonical band [0.03,0.15]' AS methodology,
  count(*) FILTER (WHERE is_northmarq IS TRUE)  AS n_northmarq,
  count(*) FILTER (WHERE is_northmarq IS NOT TRUE) AS n_market,
  round(avg(cap) FILTER (WHERE is_northmarq IS TRUE), 4)     AS nm_avg_cap,
  round(avg(cap) FILTER (WHERE is_northmarq IS NOT TRUE), 4) AS market_avg_cap,
  round((avg(cap) FILTER (WHERE is_northmarq IS NOT TRUE)
       - avg(cap) FILTER (WHERE is_northmarq IS TRUE)) * 10000, 1) AS nm_advantage_bps
FROM base;

GRANT SELECT ON public.v_dia_nm_attribution_audit, public.cm_dialysis_value_prop_24m TO anon, authenticated, service_role;
