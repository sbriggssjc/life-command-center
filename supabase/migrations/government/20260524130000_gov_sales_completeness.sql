-- ============================================================================
-- 20260524130000_gov_sales_completeness.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — sales completeness view (gov)
--
-- Gov-specific field weights (sum=100):
--   sale_date 12, sold_price 12, property_id 8,
--   buyer 5, seller 5, recorded_owner_id 5,
--   sold_cap_rate 8, cap_rate_quality 4,
--   gross_rent OR noi 5, sold_price_psf 4,
--   financing_type 4, lender_name 4, guarantor 4,
--   transaction_type 4, data_source 4, any broker 4,
--   agency 4, lease_expiration 4, sf_leased 4
--
-- Gov rows are GSA-leased real estate; agency identity + lease terms are
-- as important as price for prospecting use cases.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sales_completeness AS
SELECT
  s.sale_id, s.property_id, s.sale_date, s.sold_price,
  s.data_source, s.transaction_type, s.agency,
  s.buyer, s.seller, s.sold_cap_rate,
  (
    CASE WHEN s.sale_date  IS NOT NULL THEN 12 ELSE 0 END
  + CASE WHEN s.sold_price IS NOT NULL AND s.sold_price > 0 THEN 12 ELSE 0 END
  + CASE WHEN s.property_id IS NOT NULL THEN 8 ELSE 0 END
  + CASE WHEN COALESCE(NULLIF(TRIM(s.buyer),  ''), s.buyer_contact_id::text)  IS NOT NULL THEN 5 ELSE 0 END
  + CASE WHEN COALESCE(NULLIF(TRIM(s.seller), ''), s.seller_contact_id::text) IS NOT NULL THEN 5 ELSE 0 END
  + CASE WHEN s.recorded_owner_id IS NOT NULL THEN 5 ELSE 0 END
  + CASE WHEN s.sold_cap_rate     IS NOT NULL THEN 8 ELSE 0 END
  + CASE WHEN s.cap_rate_quality  IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN COALESCE(s.gross_rent, s.noi) IS NOT NULL THEN 5 ELSE 0 END
  + CASE WHEN s.sold_price_psf IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.financing_type, '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.lender_name,    '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.guarantor,      '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.transaction_type, '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.data_source,    '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN COALESCE(s.listing_broker, s.purchasing_broker) IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN NULLIF(TRIM(COALESCE(s.agency, '')), '') IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN s.lease_expiration IS NOT NULL THEN 4 ELSE 0 END
  + CASE WHEN s.sf_leased IS NOT NULL AND s.sf_leased > 0 THEN 4 ELSE 0 END
  )::INT AS completeness_score,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.sale_date IS NULL THEN 'sale_date' END,
    CASE WHEN s.sold_price IS NULL OR s.sold_price = 0 THEN 'sold_price' END,
    CASE WHEN s.property_id IS NULL THEN 'property_id' END,
    CASE WHEN COALESCE(NULLIF(TRIM(s.buyer),  ''), s.buyer_contact_id::text)  IS NULL THEN 'buyer' END,
    CASE WHEN COALESCE(NULLIF(TRIM(s.seller), ''), s.seller_contact_id::text) IS NULL THEN 'seller' END,
    CASE WHEN s.recorded_owner_id IS NULL THEN 'recorded_owner_id' END,
    CASE WHEN s.sold_cap_rate IS NULL THEN 'sold_cap_rate' END,
    CASE WHEN s.cap_rate_quality IS NULL THEN 'cap_rate_quality' END,
    CASE WHEN COALESCE(s.gross_rent, s.noi) IS NULL THEN 'gross_rent_or_noi' END,
    CASE WHEN s.sold_price_psf IS NULL THEN 'sold_price_psf' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.financing_type, '')), '') IS NULL THEN 'financing_type' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.lender_name,    '')), '') IS NULL THEN 'lender_name' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.guarantor,      '')), '') IS NULL THEN 'guarantor' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.transaction_type, '')), '') IS NULL THEN 'transaction_type' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.data_source,    '')), '') IS NULL THEN 'data_source' END,
    CASE WHEN COALESCE(s.listing_broker, s.purchasing_broker) IS NULL THEN 'broker' END,
    CASE WHEN NULLIF(TRIM(COALESCE(s.agency, '')), '') IS NULL THEN 'agency' END,
    CASE WHEN s.lease_expiration IS NULL THEN 'lease_expiration' END,
    CASE WHEN s.sf_leased IS NULL OR s.sf_leased = 0 THEN 'sf_leased' END
  ], NULL) AS missing_fields
FROM public.sales_transactions s
WHERE s.transaction_state = 'live';

COMMENT ON VIEW public.v_sales_completeness IS
  'One row per live sale with completeness_score (0-100) and array of missing fields (gov).';

CREATE OR REPLACE VIEW public.v_sales_completeness_summary AS
SELECT
  'gov'::TEXT AS domain,
  COUNT(*) AS sales_live,
  ROUND(AVG(completeness_score)::numeric, 1) AS avg_score,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY completeness_score)::int AS p50_score,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY completeness_score)::int AS p25_score,
  COUNT(*) FILTER (WHERE completeness_score = 100) AS perfect,
  COUNT(*) FILTER (WHERE completeness_score >= 80 AND completeness_score < 100) AS high_80_99,
  COUNT(*) FILTER (WHERE completeness_score >= 60 AND completeness_score <  80) AS mid_60_79,
  COUNT(*) FILTER (WHERE completeness_score >= 40 AND completeness_score <  60) AS low_40_59,
  COUNT(*) FILTER (WHERE completeness_score <  40) AS critical_lt_40,
  now() AS computed_at
FROM public.v_sales_completeness;

CREATE OR REPLACE VIEW public.v_sales_missing_field_rates AS
WITH expanded AS (SELECT unnest(missing_fields) AS field FROM public.v_sales_completeness),
total AS (SELECT COUNT(*) AS total_live FROM public.v_sales_completeness)
SELECT e.field, COUNT(*) AS rows_missing,
       ROUND(100.0 * COUNT(*) / t.total_live, 1) AS pct_missing
FROM expanded e, total t
GROUP BY e.field, t.total_live
ORDER BY COUNT(*) DESC;
