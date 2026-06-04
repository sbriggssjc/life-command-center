-- =============================================================================
-- Round 66x.2 (Step 2) — per-deal master reconciliation (32-deal Dec-2025 diff)
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-04
-- All corrections carry master_curated provenance; single cap-of-record preserved;
-- all four consumer views stayed byte-identical (no re-fork). sale_ids supplied by
-- the independent deal-level diff, verified here by address/state/date pre-mutate.
--
-- RESULT: Dec-2025 <=5 = 7.67% = the master workbook's own all-years <=5 average
-- -> cohort now fully reconciled to the master at the deal level. Residual vs the
-- deck's 8.29% = the deliberately-excluded >12% print (8117, ~50 bps) + recency
-- weighting + R72's 419 unimported comps (Step 3).
--
-- A) Escaped un-suppression (master-corroborated, not R72-tagged; old >10%/
--    implausible flag suppressed legit short high-cap deals):
--      7190 37139 US-26 OR (10.04), 7890 103 A B Jacks Rd SC (8.91),
--      7998 4913 Raleigh Common Dr TN (9.00).
-- B) Term mis-assignment (resolver picked a renewal/extension lease):
--      8287 5715 N Venoy MI 10.0->4.2, 14236 2494 2nd St GA 7.7->2.5,
--      14244 4510 O'Hara CA NULL->4.1, 14231 1350 Montreal GA NULL->2.8 (locked).
-- C) Cap adjudication (master is the receipt; our noi_derived ran hot):
--      5970 US-17 NC 9.57->7.85, 6782 E Chase TX 6.77->5.29,
--      9120 US-90 FL 9.13->8.30, 8055 Chabot ME 11.12->9.72 (+un-exclude).
-- D) 5926 200 Wake Ave CA: TRUE duplicate of 8346 (same $5.5M, Jun-2025) -- both
--    were excluded so the real 2025 sale contributed nothing. Promote master
--    version (5926, 7.50) to live+included; supersede CoStar twin (8346, 7.20).
-- E) 8117 310 S Highland OK (~24-28% cap): KEPT EXCLUDED as a non-market print
--    (>12% band). Methodology note: the published deck included one such deal
--    (~50 bps on its Dec-2025 <=5); the Supabase deck excludes it by design.
--    Scott may override. No row change.
-- =============================================================================

UPDATE public.sales_transactions s
SET exclude_from_market_metrics = false,
    cap_rate_quality = CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL ELSE s.cap_rate_quality END,
    cap_rate_final = COALESCE(s.stated_cap_rate, s.cap_rate),
    cap_rate_source = 'master_curated', cap_rate_confidence = 'high',
    cap_rate_notes = CASE WHEN COALESCE(s.cap_rate_notes,'')='' THEN '' ELSE s.cap_rate_notes||' | ' END
      || 'R66x.2 Step2: escaped un-suppression; master-corroborated stated cap restored'
WHERE s.sale_id IN (7190,7890,7998);

UPDATE public.sales_transactions s
SET firm_term_years_at_sale = v.term,
    firm_term_expiration_at_sale = (s.sale_date + (v.term * interval '1 year'))::date,
    firm_term_locked = true, firm_term_source = 'master_curated', firm_term_computed_at = now()
FROM (VALUES (8287, 4.2::numeric), (14236, 2.5), (14244, 4.1), (14231, 2.8)) AS v(sid, term)
WHERE s.sale_id = v.sid;

UPDATE public.sales_transactions s
SET cap_rate_final = v.cap, cap_rate_source = 'master_curated', cap_rate_confidence = 'high',
    cap_rate_quality = CASE WHEN s.cap_rate_quality='implausible_unverified' THEN NULL ELSE s.cap_rate_quality END,
    exclude_from_market_metrics = CASE WHEN s.sale_id = 8055 THEN false ELSE s.exclude_from_market_metrics END,
    cap_rate_notes = CASE WHEN COALESCE(s.cap_rate_notes,'')='' THEN '' ELSE s.cap_rate_notes||' | ' END
      || 'R66x.2 Step2: cap adjudicated to master ('||(v.cap*100)::numeric(5,2)||'%)'
FROM (VALUES (5970, 0.0785::numeric), (6782, 0.0529), (9120, 0.0830), (8055, 0.0972)) AS v(sid, cap)
WHERE s.sale_id = v.sid;

UPDATE public.sales_transactions SET transaction_state = 'duplicate_superseded' WHERE sale_id = 8346;
UPDATE public.sales_transactions
SET transaction_state = 'live', exclude_from_market_metrics = false,
    cap_rate_final = 0.0750, cap_rate_source = 'master_curated', cap_rate_confidence = 'high',
    cap_rate_notes = CASE WHEN COALESCE(cap_rate_notes,'')='' THEN '' ELSE cap_rate_notes||' | ' END
      || 'R66x.2 Step2: promoted master-curated 2025 comp; CoStar twin 8346 superseded'
WHERE sale_id = 5926;
