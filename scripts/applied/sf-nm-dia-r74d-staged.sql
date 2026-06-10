-- ============================================================================
-- Round 74d — dia is_northmarq de-contamination: all-comps re-check + held removes
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa). Flag-column + provenance ONLY.
-- STATUS: STAGED + independently verified. NOT applied (awaiting Scott's gate).
-- Idempotent (sets fixed values); safe to re-run.
--
-- WHAT THIS CLOSES
--   R74c v3 left ~208 dia sales as "held removes" (is_northmarq=true but unmatched
--   in the strict 1:1 comp pass). R74d adds the SAFEGUARD CC itself flagged — an
--   ALL-COMPS re-check (test each held sale against EVERY Internal-Sold comp, not
--   the 1:1 winner) — then strips only the genuine R23 broker-string false-positives.
--
-- THE SAFEGUARD (run conceptually FIRST; encoded in the dry-run, not as DML):
--   matcher = state + sold_date +/-120d + sold_price +/-6%; confirm city OR
--   tenant-first-token OR <=25mi geocoded proximity. Of 427 flagged sales the 1:1
--   pass matched 219; the all-comps re-check matches 320 -> 101 starved comps
--   RESCUED (incl. 8327 Austintown, 13137 Ripley). Many surfacers carry null/'None'
--   brokers, so a broker-only pass would have wrongly removed them. KEEP all matched.
--
-- HELD-SET PARTITION (208 = 101 surfacers + 46 NM-broker + 61 strip):
--   bucket 1 (46) NM/SJC listing-broker          -> KEEP, NO WRITE (the guard).
--   bucket 2 (101) all-comps surfacer            -> KEEP true + provenance tag (#2).
--   bucket 3 (61) null/individual/garbage broker -> STRIP false (#1).
--
-- VERIFICATION on the 61 strip ids: still_flagged_true=61, carries_nm_token=0,
--   would_match_under_looser_gate=0, already_buyside=0.
-- POST-STRIP: is_northmarq 428->367; curated matched-comp listing median UNCHANGED
--   (6.31%/n296 — strips are comp-unmatched); raw flag median 6.45%->6.41% (toward
--   the deck's ~6.40%).
--
-- HELD (NOT written), surfaced for Scott:
--   * 13289 (Sam Bretz, Arvada CO) NULL price -> can't matcher-verify -> HELD.
--   * Borderline strips to confirm-or-pull before the gate: 5429,988 (Peranich &
--     Huffman — R74c "object if NM"); 7980 (Nathan Huffman); 8483 (Sam Bretz).
--   * NM individuals correctly KEPT via comp/SJC-token: 422, 5191, 8858.
-- gov untouched (done in prior rounds).
-- ============================================================================

ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_source text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS is_northmarq_buyside boolean;

-- (1) STRIP — bucket 3: R23 broker-string false-positives (no comp, non-NM broker).
--     To HOLD any borderline row, delete its id from the IN-list before applying.
UPDATE public.sales_transactions
   SET is_northmarq = false,
       is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (
   127,173,290,297,319,322,403,468,488,558,623,646,738,925,937,988,1017,1018,1024,
   1032,1035,1038,1040,1041,1043,1044,1046,1048,1049,1066,1068,1071,1078,1080,1108,
   1122,1159,5346,5358,5429,5576,5651,5661,5662,5879,6422,6708,7878,7881,7888,7975,
   7980,8199,8257,8258,8260,8261,8483,8504,9018,9019
 )
   AND is_northmarq IS TRUE;   -- idempotency guard

-- (2) PROVENANCE TAG — bucket 2: 101 all-comps surfacers, comp-confirmed, KEPT true.
--     Records that the safeguard validated these as real NM comps (so a future
--     1:1-based pass can't re-bucket them as removes). is_northmarq is NOT changed.
--     Provenance-only; omit this statement if Scott prefers the minimal strip.
UPDATE public.sales_transactions
   SET is_northmarq_source = 'salesforce_comp'
 WHERE sale_id IN (
   38,43,107,116,118,195,205,224,257,311,537,603,665,765,784,982,1123,4953,5119,5136,
   5178,5197,5198,5215,5287,5336,5437,5449,5526,5590,5705,5839,5885,5905,6020,6023,
   6184,6196,6218,6220,6236,6380,6386,6417,6432,6434,6443,6719,8163,8219,8311,8327,
   8634,8859,8939,9105,9197,9249,9271,9397,9420,9580,9604,9605,9688,9689,9967,9972,
   10088,10110,10136,10151,10339,10422,10447,10502,10764,10886,10926,10929,11075,
   11151,11396,11408,11505,11520,11536,11903,12043,12229,12232,12233,12272,12343,
   12382,12450,12523,12609,12863,14203,14670
 )
   AND is_northmarq IS TRUE
   AND is_northmarq_source IS DISTINCT FROM 'salesforce_comp';   -- idempotency guard

-- ----------------------------------------------------------------------------
-- POST-APPLY EXPECTATION (read-only checks):
--   SELECT count(*) FILTER (WHERE is_northmarq) AS nm_true,           -- 367
--          count(*) FILTER (WHERE is_northmarq_source='salesforce_comp') -- ~194 (32 prior + 61 strip + 101 surfacer, minus overlap)
--   FROM public.sales_transactions;
-- ============================================================================
