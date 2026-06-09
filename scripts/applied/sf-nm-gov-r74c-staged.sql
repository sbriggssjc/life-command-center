-- ============================================================================
-- Round 74c (v3) — GOV is_northmarq de-contamination, SIDE-RECONCILED
-- GATED: run ONLY on Scott's approval. Target: government (scknotsqkcheojiaewwh).
-- Flag-column + provenance ONLY. Idempotent. NO price/term/cap writes.
--
-- gov differs from dia in one good way: the side rides DIRECTLY on each comp via
--   sf_comp_staging.raw_row->>'Direct_Co_Broke__c' (DISTINCT on sf_comp_id) — no
--   separate Deal export / fuzzy Deal->sale match needed.
-- Same doctrine + guard as dia: Direct(Both)/Co-Broke(Seller) -> is_northmarq;
--   Co-Broke(Buyer) -> is_northmarq_buyside; null side -> HOLD. Never demote/remove
--   a sale whose own listing_broker is an NM/SJC/Stan Johnson/Briggs token.
-- Matcher: state + date +/-120d + price +/-6%, confirm city OR agency OR <=25mi
--   geocoded proximity; 1:1 (best per comp, one comp per sale).
-- ============================================================================

-- columns already present on gov (added 2026-06-09). No-op if so.
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_buyside boolean;

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
  ORDER BY sale_id,(city_ok AND tenant_ok) DESC,tenant_ok DESC,city_ok DESC,prox_ok DESC,price_diff_pct,date_diff)

-- (1) LISTING-SIDE: Direct(Both)/Co-Broke(Seller) -> is_northmarq=true (63 adds + 21 no-op).
,upd_listing AS (
  UPDATE public.sales_transactions st SET is_northmarq=true, is_northmarq_source='salesforce_comp'
  FROM matched m WHERE m.sale_id=st.sale_id AND m.cside IN ('Direct (Both)','Co-Broke (Seller)')
  RETURNING 1)
-- (2) BUY-SIDE: Co-Broke(Buyer) -> is_northmarq_buyside (10). GUARD: skip if the sale's
--     own listing_broker is an NM token (NM-listed; buyer tag would be a mis-route).
,upd_buyer AS (
  UPDATE public.sales_transactions st SET is_northmarq=false, is_northmarq_buyside=true, is_northmarq_source='salesforce_comp'
  FROM matched m WHERE m.sale_id=st.sale_id AND m.cside='Co-Broke (Buyer)'
    AND NOT (lower(coalesce(st.listing_broker,'')) ~ '(northmarq|sjc|stan johnson|briggs|stinson|gartman)')
  RETURNING 1)
SELECT (SELECT count(*) FROM upd_listing) AS listing_set, (SELECT count(*) FROM upd_buyer) AS buyside_set;

-- (3) HELD — NOT written: 9 null-side matched comps -> HOLD; 0 removes (all 43
--     flagged-unmatched carry NM listing brokers -> KEEP per the guard).
-- ============================================================================
-- DRY-RUN EXPECTATION (verified 2026-06-09): listing adds 63 (+21 no-op),
--   buyside 10, null-side held 9, removes 0. is_northmarq 66 -> 129; buyside 10.
--   #20 gov NM listing median 8.10% (no Internal-vs-DB contradiction; deck 6.78%
--   is a separate cohort/aggregation — gov #20 basis NOT switched here).
-- NOT YET APPLIED — awaiting Scott's gate.
-- ============================================================================
