-- ============================================================================
-- Round 74c — GOV is_northmarq de-contamination — APPLIED 2026-06-09 (Scott-gated)
-- Target: government (scknotsqkcheojiaewwh). Flag-column + provenance ONLY. Idempotent.
--
-- gov side rides DIRECTLY on each comp via sf_comp_staging.raw_row->>'Direct_Co_Broke__c'
--   (DISTINCT on sf_comp_id) — no separate Deal export. Doctrine + NM-broker guard
--   (keyed on listing_broker) identical to dia.
-- Matcher: state + date +/-120d + price +/-6%, confirm city OR agency OR <=25mi
--   geocoded proximity; 1:1 (best per comp, one comp per sale).
-- ============================================================================

ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;   -- present
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_buyside boolean; -- present

WITH geo AS (
  SELECT upper(state) st, lower(city) ct, avg(latitude) lat, avg(longitude) lng
  FROM public.properties WHERE latitude IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL GROUP BY 1,2),
side AS (
  SELECT DISTINCT ON (sf_comp_id) sf_comp_id, raw_row->>'Direct_Co_Broke__c' AS dcb
  FROM public.sf_comp_staging ORDER BY sf_comp_id, imported_at DESC NULLS LAST),
comps AS (
  SELECT e.sf_comp_id, e.tenant c_tenant, lower(e.city) c_city, upper(e.state) c_state,
         e.sold_price c_price, e.sold_date c_date, s.dcb AS cside, g.lat clat, g.lng clng
  FROM public.sf_internal_comp_export e
  LEFT JOIN side s ON s.sf_comp_id=e.sf_comp_id
  LEFT JOIN geo g ON g.st=upper(e.state) AND g.ct=lower(e.city)
  WHERE e.status='Sold' AND e.sold_price IS NOT NULL),
sales AS (
  SELECT st.sale_id, st.sale_date, st.sold_price, upper(st.state) state, lower(st.city) city,
         st.agency, st.agency_full, p.latitude lat, p.longitude lng
  FROM public.sales_transactions st LEFT JOIN public.properties p ON p.property_id=st.property_id),
cand AS (
  SELECT c.sf_comp_id, s.sale_id, c.cside,
         abs(s.sold_price-c.c_price)/nullif(c.c_price,0) price_diff_pct, abs(s.sale_date-c.c_date) date_diff,
         (s.city=c.c_city) city_ok,
         (c.c_tenant IS NOT NULL AND (s.agency ILIKE '%'||split_part(c.c_tenant,' ',1)||'%' OR coalesce(s.agency_full,'') ILIKE '%'||split_part(c.c_tenant,' ',1)||'%')) tenant_ok,
         (c.clat IS NOT NULL AND s.lat IS NOT NULL AND
            3959*2*asin(sqrt(power(sin(radians(s.lat-c.clat)/2),2)+cos(radians(c.clat))*cos(radians(s.lat))*power(sin(radians(s.lng-c.clng)/2),2)))<=25) prox_ok
  FROM comps c JOIN sales s ON s.state=c.c_state AND s.sale_date BETWEEN c.c_date-120 AND c.c_date+120
   AND abs(s.sold_price-c.c_price)<=0.06*c.c_price),
bpc AS (SELECT DISTINCT ON (sf_comp_id) * FROM cand WHERE city_ok OR tenant_ok OR prox_ok
  ORDER BY sf_comp_id,(city_ok AND tenant_ok) DESC,tenant_ok DESC,city_ok DESC,prox_ok DESC,price_diff_pct,date_diff),
matched AS (SELECT DISTINCT ON (sale_id) sale_id, cside FROM bpc
  ORDER BY sale_id,(city_ok AND tenant_ok) DESC,tenant_ok DESC,city_ok DESC,prox_ok DESC,price_diff_pct,date_diff),
upd_listing AS (   -- Direct(Both)/Co-Broke(Seller) -> is_northmarq=true (63 adds + 21 retag)
  UPDATE public.sales_transactions st SET is_northmarq=true, is_northmarq_source='salesforce_comp'
  FROM matched m WHERE m.sale_id=st.sale_id AND m.cside IN ('Direct (Both)','Co-Broke (Seller)') RETURNING 1),
upd_buyer AS (    -- Co-Broke(Buyer) -> is_northmarq_buyside (10). GUARD: skip NM listing_broker.
  UPDATE public.sales_transactions st SET is_northmarq=false, is_northmarq_buyside=true, is_northmarq_source='salesforce_comp'
  FROM matched m WHERE m.sale_id=st.sale_id AND m.cside='Co-Broke (Buyer)'
    AND NOT (lower(coalesce(st.listing_broker,'')) ~ '(northmarq|sjc|stan johnson|briggs|stinson|gartman)') RETURNING 1)
SELECT (SELECT count(*) FROM upd_listing) listing_written, (SELECT count(*) FROM upd_buyer) buyside_written;

-- HELD: 9 null-side matched comps; 0 removes (all 43 flagged-unmatched carry NM listing brokers).
-- ============================================================================
-- APPLIED LIVE 2026-06-09 (Scott-gated). Result: listing_written=84 (63 new + 21 retag),
--   buyside_written=10. is_northmarq 66 -> 129; is_northmarq_buyside 10; tagged_comp 94.
-- #20 RECEIPT: gov NM-vs-market view (cm_gov_nm_vs_market_m) NM line did NOT shift —
--   deck quarter 2024-11-30 raw TTM nm_avg 6.83% -> 6.84% (+1bp); 2025-11-30 7.76% -> 7.76%
--   (0bp). Smoothed view reads 6.78% at the deck quarter = deck. The view's [4-12%] gate +
--   n>=3 + 2yr TTM + 5q smoothing keeps the #20 NM basis decoupled from the raw ~8% flag cap.
-- ============================================================================
