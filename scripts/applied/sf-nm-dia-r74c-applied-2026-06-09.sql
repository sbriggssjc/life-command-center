-- ============================================================================
-- Round 74c (v3) — dia is_northmarq de-contamination — APPLIED 2026-06-09 (Scott-gated)
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa). Flag-column + provenance ONLY.
--
-- DOCTRINE (Scott, the binding guard):
--   The SF Deal "side" may only PROMOTE (competitor/ambiguous -> NM) or resolve a
--   genuinely-ambiguous row. It must NEVER override an explicit NM listing-broker
--   string. NEVER demote-to-buyside or remove a sale whose own listing_broker
--   matches the NM/SJC/Briggs/Stinson/Gartman token (or a known NM individual) —
--   those are NM-listed by rule; a conflicting Deal "buyer" tag on them is a
--   cross-attribution (the +/-1.5% Deal lookup hitting a same-metro neighbor),
--   not ground truth.
--
-- Sources: sf_internal_comp_export (Internal=NM/SJC sale, status='Sold') = the NM
--   universe; the data.xlsx Deal export (Direct_Co_Broke) = the side. Matcher:
--   state + date +/-120d + price +/-6%, confirm city OR tenant OR <=25mi geocoded
--   proximity; Deal->sale side at a tight +/-1.5% price. Idempotent.
-- ============================================================================

ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_buyside boolean;

-- (1) APPLIED — 6 listing-side adds (Direct/Seller-confirmed, null/None broker).
UPDATE public.sales_transactions SET is_northmarq=true, is_northmarq_source='salesforce_comp'
 WHERE sale_id IN (163, 635, 6435, 6864, 9341, 10085);

-- (2) APPLIED — 1065 remove (Encore = competitor, not in Comp set, old R23 guess).
UPDATE public.sales_transactions SET is_northmarq=false, is_northmarq_source='salesforce_comp'
 WHERE sale_id = 1065;

-- (3) APPLIED — 12 buyside FLIPS (currently-flagged, Deal=Buyer, broker NOT an NM token).
--     Demote from listing to buy-side. (Held NM-broker ones excluded — see below.)
UPDATE public.sales_transactions SET is_northmarq=false, is_northmarq_buyside=true, is_northmarq_source='salesforce_comp'
 WHERE sale_id IN (17,53,83,162,698,5387,5420,5527,5761,5933,8850,8864);

-- (4) APPLIED — 10 new buy-side tags (matched Comp, Deal=Buyer, not flagged, non-NM broker).
UPDATE public.sales_transactions SET is_northmarq=false, is_northmarq_buyside=true, is_northmarq_source='salesforce_comp'
 WHERE sale_id IN (4977,5359,5364,5489,5523,9147,12896,13915,14456,14482);

-- (5) APPLIED — protect 8327/13137: confirmed NM comps (Austintown 0.15%/5d; Ripley
--     city-confirmed 0.05%/13d) + R74 Deal Co-Broke(Seller). Keep true; retag. NOT removed.
--     (Both were starved by the strict 1:1 resolution -> wrongly bucketed as removes in v2.)
UPDATE public.sales_transactions SET is_northmarq=true, is_northmarq_source='salesforce_comp'
 WHERE sale_id IN (8327, 13137);

-- ----------------------------------------------------------------------------
-- HELD (NOT written) — the guard / pending Scott:
--   * 422 (SJC; Butler), 8858 (SJC; Scrivner)  -> NM-token guard: KEEP is_northmarq=true.
--   * 5191 (Will Lightfoot = NM/SJC broker)     -> Scott-named: KEEP is_northmarq=true.
--       (422 also exact-matches Comp Fresenius-Birmingham-AL $1.37M; 5191 matches
--        Comp Fresenius-Edmond-OK $2.67M — both NM-listed; the Deal "Buyer" tag on
--        them was a +/-1.5% cross-attribution to a same-metro neighbor.)
--   * 5004 (Colliers) -> VERIFIED a genuine non-match (only candidate was a Round Rock
--       Satellite Healthcare deal, ~80mi, different tenant). Scott-approved 2026-06-09:
--       UN-FLAGGED. UPDATE sales_transactions SET is_northmarq=false,
--       is_northmarq_source='salesforce_comp' WHERE sale_id=5004; (applied -> dia 429->428).
--   * ~211 currently-flagged sales with NO Internal-comp match (non-competitor):
--       75 NM/SJC/Briggs broker -> KEEP; 66 null; ~70 other -> HOLD (not stripped).
--   * 5420 (PH: Peranich & Huffman) was FLIPPED in (3) as a non-NM firm — flag for
--       Scott to object if it is in fact NM.
--
-- RESULT (applied live 2026-06-09): is_northmarq 436 -> 429; is_northmarq_buyside 22;
--   31 rows tagged 'salesforce_comp'. #20 dia NM listing median 6.40% (n=190) ~= deck 6.38%.
-- ============================================================================
