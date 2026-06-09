-- ============================================================================
-- Round 74c — de-contaminate dia is_northmarq against the SF Internal Comp export
-- GATED: run ONLY on Scott's approval of docs/capital-markets/ROUND74C_dryrun_plan.json
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa). Flag-column + provenance ONLY.
-- Source of truth: public.sf_internal_comp_export (status='Sold' = NM closed universe).
-- Idempotent (re-run safe). NO price/term/cap writes.
-- ============================================================================

-- 0) provenance column (R74 added is_northmarq_source; harmless if present)
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;

-- 1) Recompute the authoritative 1:1 Internal-comp -> sale match (same logic as the dry-run).
--    state + sold_date +/-120d + sold_price +/-6%; confirm city OR tenant; best-per-comp then
--    one comp per sale. Materialized to a CTE so the UPDATEs below are self-contained.
WITH comps AS (
  SELECT sf_comp_id, tenant AS c_tenant, city AS c_city, upper(state) AS c_state,
         sold_price AS c_price, sold_date AS c_date
  FROM public.sf_internal_comp_export
  WHERE status='Sold' AND sold_price IS NOT NULL
),
sales AS (
  SELECT st.sale_id, st.sale_date, st.sold_price,
         upper(p.state) AS state, p.city, p.tenant, p.operator
  FROM public.sales_transactions st
  JOIN public.properties p ON p.property_id = st.property_id
),
cand AS (
  SELECT c.sf_comp_id, s.sale_id,
         abs(s.sold_price-c.c_price)/nullif(c.c_price,0) AS price_diff_pct,
         abs(s.sale_date-c.c_date) AS date_diff,
         (lower(s.city)=lower(c.c_city)) AS city_ok,
         (c.c_tenant IS NOT NULL AND (s.tenant   ILIKE '%'||split_part(c.c_tenant,' ',1)||'%'
                                  OR  s.operator ILIKE '%'||split_part(c.c_tenant,' ',1)||'%')) AS tenant_ok
  FROM comps c
  JOIN sales s
    ON s.state = c.c_state
   AND s.sale_date BETWEEN c.c_date-120 AND c.c_date+120
   AND abs(s.sold_price-c.c_price) <= 0.06*c.c_price
),
best_per_comp AS (
  SELECT DISTINCT ON (sf_comp_id) *
  FROM cand WHERE city_ok OR tenant_ok
  ORDER BY sf_comp_id, (city_ok AND tenant_ok) DESC, tenant_ok DESC, city_ok DESC, price_diff_pct, date_diff
),
matched AS (   -- one comp per sale (the 242-sale NM set)
  SELECT DISTINCT ON (sale_id) sale_id
  FROM best_per_comp
  ORDER BY sale_id, (city_ok AND tenant_ok) DESC, tenant_ok DESC, city_ok DESC, price_diff_pct, date_diff
)
-- 2) ADDS + provenance: flag every matched sale NM (no-op for the 220 already true).
UPDATE public.sales_transactions st
   SET is_northmarq = true,
       is_northmarq_source = 'salesforce_comp'
  FROM matched m
 WHERE st.sale_id = m.sale_id
   AND (st.is_northmarq IS DISTINCT FROM true OR st.is_northmarq_source IS DISTINCT FROM 'salesforce_comp');

-- 3) CONFIDENT REMOVES (competitor broker + outside the Internal set). 4 sales, explicit.
--    Includes the 2 R74 M&M contradictions (8327, 13137) — the Comp object excludes them.
UPDATE public.sales_transactions
   SET is_northmarq = false,
       is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (1065, 5004, 8327, 13137);

-- 4) STAGED REMOVES — NOT APPLIED. 212 currently-flagged sales fall outside the Internal set
--    but are held per the guardrail (Comp DB may be incomplete; don't bulk-strip):
--      * 75 with NM/SJC/Briggs broker evidence  -> KEEP flagged
--      * 66 null-broker                          -> HOLD (resolves R74's ~84 held)
--      * 71 other-named / garbage broker strings -> HOLD pending Scott judgment
--    Enumerate for review with:
--      SELECT st.sale_id, st.listing_broker, st.procuring_broker, p.state, p.city, p.tenant
--      FROM sales_transactions st JOIN properties p USING (property_id)
--      WHERE st.is_northmarq IS TRUE AND st.sale_id NOT IN (<matched set>);

-- ============================================================================
-- DRY-RUN EXPECTATION (pre-apply, verified 2026-06-09):
--   adds (new true): 22   no-op already-true: 220   confident removes: 4
--   is_northmarq true 436 -> 454 after apply.  Staged removes (held): 212.
-- NOT YET APPLIED — awaiting Scott's gate.
-- ============================================================================
