-- =============================================================================
-- Round 66x (Part 1) — maximize cap-of-record COVERAGE on dia sales
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:    2026-06-03
--
-- GOAL CONTEXT (cap-rate-by-lease-term reconciliation): one cap-of-record for
-- ALL sales, and "chew on the data" so as many sales as possible carry a cap
-- rate. firm_term coverage is already maxed from current leases (0 sales with a
-- resolvable lease-in-effect lack firm_term_years_at_sale), so this part targets
-- the cap-rate side.
--
-- PROBLEM. The single cap-of-record (sales_transactions.cap_rate_final) is
-- derived by dia_derive_cap_of_record() via a 3-tier ladder:
--   1 broker_stated   (stated_cap_rate)
--   2 source_reported (raw cap_rate, when distinct from calc)
--   3 noi_derived     (rent_at_sale / sold_price)
-- Tier 3 keys on rent_at_sale/sold_price, NOT the stored calculated_cap_rate.
-- 405 market sales carry an IN-BAND calculated_cap_rate but (a) no reported cap
-- and (b) a rent_at_sale that does not reconcile to an in-band cap (the open
-- Phase-1 rent_at_sale data issue). They therefore had NO cap of record at all
-- and were dropped from every cap chart -- disproportionately the short-remaining
-- -term, high-going-in-yield deals that the by-term <=5 cohort needs.
--
-- FIX. Add a TIER 4 that admits the stored calculated_cap_rate as a LAST-RESORT,
-- low-confidence noi_derived candidate -- only when nothing higher exists, in
-- band [0.04,0.12], and not implausible. Reported caps always outrank it; manual
-- overrides are never touched.
--
-- BLAST RADIUS (measured before applying):
--   market sales with a cap of record: 1,247 -> 1,490  (+243, +19.5%)
--   headline 2025 TTM avg cap:         7.017% -> 7.054% (+3.7 bps, n 105 -> 131)
--   all-time avg cap:                  6.669% -> 6.718% (+4.9 bps)
-- i.e. coverage jumps ~20% while the headline barely moves -- the band +
-- implausible filters bound the "calc runs high" risk, and tier 4 only fires
-- where no reported cap exists.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dia_derive_cap_of_record(
  p_stated numeric, p_raw numeric, p_calc numeric,
  p_rent numeric, p_price numeric, p_quality text)
 RETURNS TABLE(cap_rate_final numeric, cap_rate_source text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT v.cap, v.src
  FROM (VALUES
     (1, CASE WHEN p_stated BETWEEN 0.04 AND 0.12 THEN p_stated END,                                    'broker_stated'),
     (2, CASE WHEN p_raw    BETWEEN 0.04 AND 0.12 AND (p_calc IS NULL OR abs(p_raw - p_calc) > 0.0005)
                THEN p_raw END,                                                                          'source_reported'),
     (3, CASE WHEN p_rent > 0 AND p_price > 0 AND (p_rent / p_price) BETWEEN 0.04 AND 0.12
                THEN round(p_rent / p_price, 5) END,                                                     'noi_derived'),
     -- Tier 4 (R66x): stored calculated_cap_rate as last-resort noi_derived.
     (4, CASE WHEN p_calc BETWEEN 0.04 AND 0.12 THEN p_calc END,                                         'noi_derived')
  ) AS v(prio, cap, src)
  WHERE p_quality IS DISTINCT FROM 'implausible_unverified'
    AND v.cap IS NOT NULL
  ORDER BY v.prio
  LIMIT 1;
$function$;

-- Backfill. Touching cap_rate_source fires trg_dia_sales_cap_of_record, which
-- re-derives final+source from the (new) ladder. cap_rate_confidence and
-- cap_rate_notes are not touched by the trigger, so our low-confidence stamp +
-- provenance note survive. Idempotent: a re-run finds 0 candidates because
-- cap_rate_final is now populated.
UPDATE public.sales_transactions s
SET cap_rate_source = 'noi_derived',
    cap_rate_confidence = CASE WHEN s.cap_rate_confidence IS NULL THEN 'low' ELSE s.cap_rate_confidence END,
    cap_rate_notes = CASE WHEN COALESCE(s.cap_rate_notes,'')='' THEN '' ELSE s.cap_rate_notes || ' | ' END
                     || 'R66x: admitted stored calculated_cap_rate as noi_derived (low-confidence; no reported cap, rent_at_sale unreconciled)'
WHERE s.cap_rate_final IS NULL
  AND s.cap_rate_quality IS DISTINCT FROM 'implausible_unverified'
  AND COALESCE(s.cap_rate_source,'') <> 'manual'
  AND s.calculated_cap_rate BETWEEN 0.04 AND 0.12;
