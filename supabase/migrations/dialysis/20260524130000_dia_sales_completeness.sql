-- ============================================================================
-- 20260524130000_dia_sales_completeness.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Direct support for user complaint
--   "Most of the sample records had missing many elements of a sales transaction"
--
-- v_sales_completeness — one row per live sale with completeness_score (0-100)
--                        and an array of missing_fields (for triage).
-- v_sales_completeness_summary — distribution of scores across the live set.
--
-- Weights chosen so a fully-populated sale = 100. Field weights for dia:
--   sale_date 15, sold_price 15, property_id 10,
--   buyer (name OR id) 10, seller (name OR id) 10,
--   recorded_date 5, any cap_rate 10, cap_rate_quality 5,
--   transaction_type 5, rent_at_sale 5, data_source 5,
--   any broker 5
--
-- Use:
--   SELECT * FROM v_sales_completeness WHERE completeness_score < 50
--    ORDER BY sold_price DESC LIMIT 50;
--   SELECT * FROM v_sales_completeness_summary;
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sales_completeness AS
SELECT
  s.sale_id, s.property_id, s.sale_date, s.sold_price,
  s.data_source, s.transaction_type,
  s.buyer_name, s.seller_name, s.cap_rate,
  -- Score (0-100)
  (
    CASE WHEN s.sale_date    IS NOT NULL THEN 15 ELSE 0 END
  + CASE WHEN s.sold_price   IS NOT NULL AND s.sold_price > 0 THEN 15 ELSE 0 END
  + CASE WHEN s.property_id  IS NOT NULL THEN 10 ELSE 0 END
  + CASE WHEN COALESCE(NULLIF(TRIM(s.buyer_name), ''), s.recorded_owner_id::text)  IS NOT NULL THEN 10 ELSE 0 END
  + CASE WHEN COALESCE(NULLIF(TRIM(s.seller_name), ''), s.seller_id::text)         IS NOT NULL THEN 10 ELSE 0 END
  + CASE WHEN s.recorded_date IS NOT NULL THEN  5 ELSE 0 END
  + CASE WHEN COALESCE(s.cap_rate, s.stated_cap_rate, s.calculated_cap_rate) IS NOT NULL THEN 10 ELSE 0 END
  + CASE WHEN s.cap_rate_quality IS NOT NULL THEN  5 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.transaction_type, '')), '') IS NOT NULL THEN  5 ELSE 0 END
  + CASE WHEN s.rent_at_sale IS NOT NULL THEN  5 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.data_source, '')), '') IS NOT NULL THEN  5 ELSE 0 END
  + CASE WHEN COALESCE(s.listing_broker, s.procuring_broker) IS NOT NULL THEN  5 ELSE 0 END
  )::INT AS completeness_score,
  -- Missing-fields array (operator-friendly for triage)
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.sale_date IS NULL THEN 'sale_date' END,
    CASE WHEN s.sold_price IS NULL OR s.sold_price = 0 THEN 'sold_price' END,
    CASE WHEN s.property_id IS NULL THEN 'property_id' END,
    CASE WHEN COALESCE(NULLIF(TRIM(s.buyer_name), ''), s.recorded_owner_id::text)  IS NULL THEN 'buyer' END,
    CASE WHEN COALESCE(NULLIF(TRIM(s.seller_name), ''), s.seller_id::text)         IS NULL THEN 'seller' END,
    CASE WHEN s.recorded_date IS NULL THEN 'recorded_date' END,
    CASE WHEN COALESCE(s.cap_rate, s.stated_cap_rate, s.calculated_cap_rate) IS NULL THEN 'cap_rate' END,
    CASE WHEN s.cap_rate_quality IS NULL THEN 'cap_rate_quality' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.transaction_type, '')), '') IS NULL THEN 'transaction_type' END,
    CASE WHEN s.rent_at_sale IS NULL THEN 'rent_at_sale' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.data_source, '')), '') IS NULL THEN 'data_source' END,
    CASE WHEN COALESCE(s.listing_broker, s.procuring_broker) IS NULL THEN 'broker' END
  ], NULL) AS missing_fields
FROM public.sales_transactions s
WHERE s.transaction_state = 'live';

COMMENT ON VIEW public.v_sales_completeness IS
  'One row per live sale with completeness_score (0-100) and array of missing fields. Directly addresses the user complaint "missing many elements of a sales transaction".';

-- Summary view — distribution of scores
CREATE OR REPLACE VIEW public.v_sales_completeness_summary AS
SELECT
  'dia'::TEXT AS domain,
  COUNT(*)                                                 AS sales_live,
  ROUND(AVG(completeness_score)::numeric, 1)               AS avg_score,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY completeness_score)::int AS p50_score,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY completeness_score)::int AS p25_score,
  COUNT(*) FILTER (WHERE completeness_score = 100)         AS perfect,
  COUNT(*) FILTER (WHERE completeness_score >= 80 AND completeness_score < 100) AS high_80_99,
  COUNT(*) FILTER (WHERE completeness_score >= 60 AND completeness_score <  80) AS mid_60_79,
  COUNT(*) FILTER (WHERE completeness_score >= 40 AND completeness_score <  60) AS low_40_59,
  COUNT(*) FILTER (WHERE completeness_score <  40)         AS critical_lt_40,
  now() AS computed_at
FROM public.v_sales_completeness;

COMMENT ON VIEW public.v_sales_completeness_summary IS
  'Distribution of completeness_score across live sales (dia). Powers backslide-alarm rule + dashboard tile.';

-- Per-field missing-rate view (what is the most-missed field?)
CREATE OR REPLACE VIEW public.v_sales_missing_field_rates AS
WITH expanded AS (
  SELECT unnest(missing_fields) AS field FROM public.v_sales_completeness
),
total AS (SELECT COUNT(*) AS total_live FROM public.v_sales_completeness)
SELECT
  e.field,
  COUNT(*)                                          AS rows_missing,
  ROUND(100.0 * COUNT(*) / t.total_live, 1)         AS pct_missing
FROM expanded e, total t
GROUP BY e.field, t.total_live
ORDER BY COUNT(*) DESC;

COMMENT ON VIEW public.v_sales_missing_field_rates IS
  'Per-field % of live sales missing this field. Sorted most-missed first. Use to prioritize C2 / enrichment investment.';
