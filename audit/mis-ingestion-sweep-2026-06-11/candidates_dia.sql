-- Mis-ingestion sweep — dia wrong-asset + phantom-duplicate candidate set.
-- READ-ONLY. Re-runnable. Project: zqzrriwuavgrquhisnoa (Dialysis_DB).
-- This is the query that freezes the candidate list at the gate (FINDINGS.md §7 step 1).
-- NOTE: signals use COALESCE so NULL building_size / NULL notes do NOT drop rows
--       (the NULL-propagation trap documented in FINDINGS.md §5).

WITH s AS (
  SELECT
    st.sale_id, st.sale_date, st.sold_price, st.data_source, st.portfolio_id,
    coalesce(st.notes,'')                              AS notes,
    p.property_id, p.building_size                     AS bsf,
    st.sold_price / NULLIF(p.building_size,0)          AS psf,
    coalesce(p.property_type,'')                       AS pt,
    coalesce(p.tenant,'')||' '||coalesce(p.operator,'') AS to_str,
    coalesce(p.building_name,'')||' '||coalesce(p.address,'') AS name_str,
    coalesce(p.building_name, left(p.address,30))      AS name,
    p.tenant, p.operator, p.city, p.state,
    row_number() OVER (PARTITION BY st.property_id, st.sold_price
                       ORDER BY st.sale_date)          AS dup_rank
  FROM sales_transactions st
  JOIN properties p ON p.property_id = st.property_id
  WHERE st.exclude_from_market_metrics IS NOT TRUE
    AND st.sold_price > 0
),
sig AS (
  SELECT *,
    coalesce((psf > 1500)::int, 0)                                                   AS s_psf,
    coalesce((bsf > 25000)::int, 0)                                                  AS s_size,
    (name_str ~* '(plaza|village|commons|mall|shopping|marketplace|galleria|pavilion|corporate park|business center|business park|town center|promenade|outlet|power center|crossing)')::int AS s_name,
    (to_str !~* '(davita|fresenius|fmc|fkc|fmcna|renal|kidney|dialysis|satellite|nephrolog|rogosin|dialyspa|dcc|dci|centro de cuidado|hemodialysis)'
       AND nullif(trim(to_str),'') IS NOT NULL)::int                                 AS s_nottenant,
    (pt ~* '(retail|warehouse|industrial|shopping|mall|cinema|power center|distribution|mixed|multi-tenant|multiple|ground lease|office, retail)')::int AS s_ptype,
    ((portfolio_id IS NOT NULL) OR (notes ~* '(portfolio|multiple propert)'))::int   AS s_pf
  FROM s
)
SELECT
  sale_id, sale_date, sold_price::bigint AS price, round(psf) AS psf, bsf::int AS bsf,
  pt, name, tenant, operator, city, state, data_source, dup_rank,
  (s_psf+s_size+s_name+s_nottenant+s_ptype+s_pf) AS sigs,
  concat_ws(',',
    CASE WHEN s_psf=1 THEN 'psf' END, CASE WHEN s_size=1 THEN 'size' END,
    CASE WHEN s_name=1 THEN 'name' END, CASE WHEN s_nottenant=1 THEN 'nottenant' END,
    CASE WHEN s_ptype=1 THEN 'ptype' END, CASE WHEN s_pf=1 THEN 'pf' END) AS which,
  -- proposed classification (REVIEW, not authoritative — human confirms at the gate)
  CASE
    WHEN dup_rank > 1 THEN 'phantom_duplicate'
    WHEN pt ~* '(industrial|warehouse|distribution)' THEN 'misclassified_wrong_type'
    WHEN (s_name+s_ptype) >= 1 AND (s_psf+s_size) >= 1 THEN 'whole_center_multitenant'
    WHEN s_pf=1 AND sold_price >= 30000000 THEN 'portfolio_sale'
    WHEN sold_price >= 30000000 AND bsf IS NULL AND nullif(trim(to_str),'') IS NULL THEN 'unconfirmed'
    ELSE 'review'
  END AS proposed_class
FROM sig
WHERE (s_psf+s_size+s_name+s_nottenant+s_ptype+s_pf) >= 2   -- wrong-asset candidates
   OR dup_rank > 1                                          -- phantom duplicates
   OR sold_price >= 30000000                                -- the $30M+ tail (seed set)
ORDER BY (dup_rank > 1), price DESC;

-- Phantom-duplicate magnitude (FINDINGS.md §3):
--   SELECT count(*) dup_groups, sum(n-1) phantom_rows, sum((n-1)*sold_price)::bigint phantom_volume
--   FROM (SELECT property_id, sold_price, count(*) n FROM sales_transactions
--         WHERE exclude_from_market_metrics IS NOT TRUE AND sold_price>0 AND property_id IS NOT NULL
--         GROUP BY 1,2 HAVING count(*)>1) g;
