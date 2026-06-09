-- ============================================================================
-- Round 74c (v2) — dia is_northmarq de-contamination, SIDE-RECONCILED
-- GATED: run ONLY on Scott's approval of docs/capital-markets/ROUND74C_dryrun_plan.json
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa). Flag-column + provenance ONLY.
--
-- Two-source rule (the v2 correctness fix):
--   1. SF Comp object (public.sf_internal_comp_export, status='Sold') establishes the
--      NM universe (Internal = a Northmarq/SJC sale) and fingerprint-matches a sale.
--   2. SF Deal object (public.sf_deal_export, from data.xlsx) supplies the SIDE
--      (Direct_Co_Broke). is_northmarq=true ONLY for Direct (Both) / Co-Broke (Seller).
--      Co-Broke (Buyer) -> is_northmarq_buyside=true (NOT a listing comp).
--      Deal side ABSENT -> HOLD (no flip), per Scott.
-- Matcher: state + sold_date +/-120d + sold_price +/-6%, confirm city OR tenant OR
--   <=25mi geocoded proximity; Deal->sale side identified at a TIGHT +/-1.5% price.
-- Idempotent. NO price/term/cap writes.
-- ============================================================================

-- 0) provenance + buyside columns
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_buyside boolean;

-- 1) LISTING-SIDE ADDS (matched Comp + Deal side in {Direct (Both), Co-Broke (Seller)};
--    not currently flagged). 6 sales. (+193 matched-listing already true = no-op.)
UPDATE public.sales_transactions
   SET is_northmarq = true, is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (163, 635, 6435, 6864, 9341, 10085);

-- 2) BUY-SIDE ROUTING (matched Comp but Deal side = Co-Broke (Buyer) only). 25 sales.
--    These are NOT listing comps: clear is_northmarq, set is_northmarq_buyside.
--    15 were wrongly flagged true (flip off); 10 were already false (idempotent).
UPDATE public.sales_transactions
   SET is_northmarq = false, is_northmarq_buyside = true, is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (17,53,83,162,422,698,5191,5387,5420,5527,5761,5933,8850,8858,8864,   -- were flagged
                   4977,5359,5364,5489,5523,9147,12896,13915,14456,14482);               -- new buyside

-- 3) CONFIDENT REMOVES (currently flagged, NO Internal-comp match, competitor broker).
--    4 sales incl. the 2 R74 M&M contradictions (8327, 13137) — the Comp object excludes them.
UPDATE public.sales_transactions
   SET is_northmarq = false, is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (1065, 5004, 8327, 13137);

-- 4) HELD — NOT APPLIED:
--    * 19 sales matched a Comp but NO Deal side was found -> HOLD (incl. 6375, 8347).
--    * ~211 currently-flagged sales with NO Internal-comp match (non-competitor):
--        75 NM/SJC/Briggs broker -> KEEP; 66 null-broker -> HOLD; ~70 other-named -> HOLD.
--    None are stripped here (Comp/Deal coverage may be incomplete; Scott-gated).

-- ============================================================================
-- DRY-RUN EXPECTATION (pre-apply, verified 2026-06-09):
--   listing adds: 6   buy-side routed: 25 (15 flip off + 10 new)   competitor removes: 4
--   is_northmarq true 436 -> 423.  is_northmarq_buyside true: 25.  Held: 19 + ~211.
--   #20 dia NM listing median 6.40% (n=190) ~= deck 6.38%.
-- NOT YET APPLIED — awaiting Scott's gate.
-- ============================================================================
