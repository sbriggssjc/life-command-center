-- =============================================================================
-- Round 66x.2 (Step 1 / THE LEVER) — un-suppress master-corroborated cap rates
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-04
--
-- The deal-level reconciliation against Dialysis Comp Work MASTER.xlsx (via the
-- R72 import, data_source='master_xlsx_backfill_r72') showed our cap-rate flags
-- were nulling/excluding legitimate HIGH-going-in-yield short deals that the
-- firm's own curated workbook (the deck's source) includes: 24 of the master's
-- 80 <=5 deals were flagged, 20 of them in-band averaging 8.75%. High going-in
-- caps on short-remaining-term assets are REAL, not implausible.
--
-- FIX (anchored on MASTER CORROBORATION, not on the <=5 cohort -- a term-
-- conditional quality rule would be the per-cohort fork we have avoided):
--   * Forward: dia_flag_suspect_cap_rate auto-exclude threshold 0.10 -> 0.12 so
--     stated 10-12% caps are no longer auto-suppressed (>12% / <0.5% still are).
--   * cap_rate_source gains 'master_curated' (top-trust: broker-curated, deck-
--     published) treated like 'manual' by the cap-of-record trigger (a trusted
--     override, NOT a derived-ladder re-rank -- single cap-of-record preserved).
--   * Backfill: any R72-corroborated sale with an in-band (4-12%) stated cap that
--     was suppressed gets the flag cleared and cap_rate_final restored to the
--     master cap, source='master_curated'. >12% stays excluded (e.g. the master's
--     ~20-24% deals) -- documented divergence, ~50 bps of the Dec-2025 <=5, for
--     Scott to accept/override, never silently included.
--
-- ACCEPTANCE (measured post-apply; all four consumer views stayed identical):
--   restored 110 deals (20 in <=5 at avg 8.75%); 6 kept excluded (>12%).
--   Dec-2025 by-term: 12+ 6.80 / 8-12 6.60 / 6-8 6.90 / <=5 7.45 -> 7.70
--     (deck 6.89 / 6.84 / 7.28 / 8.29; <=5 gap -84 -> -59 bps, no 12+/8-12 regress)
--   2022-08 12+ 5.42 -> 5.18 (deck 5.08); 2019-11 <=5 6.79 -> 7.17.
--   Residual <=5 gap = master-vs-deck recency weighting + the >12% excluded deals
--   + R72's 419 unimported master comps (Steps 2-3).
--
-- 108 of the 110 are transaction_state='live'; the 2 'duplicate_superseded'
-- self-re-exclude via enforce_nonlive_excluded_from_metrics (correct).
-- =============================================================================

-- (1) allow the new top-trust provenance tag
ALTER TABLE public.sales_transactions DROP CONSTRAINT IF EXISTS sales_transactions_cap_rate_source_chk;
ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_transactions_cap_rate_source_chk
  CHECK (cap_rate_source IS NULL OR cap_rate_source = ANY (ARRAY[
    'broker_stated','source_reported','noi_derived','manual','master_curated']));

-- (2) forward fix: stop auto-excluding stated 10-12% caps (band edge is 12%)
CREATE OR REPLACE FUNCTION public.dia_flag_suspect_cap_rate()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_cap numeric;
BEGIN
  v_cap := COALESCE(NEW.calculated_cap_rate, NEW.cap_rate, NEW.stated_cap_rate);
  -- R66x.2: 0.10 -> 0.12. High going-in caps on short-term deals are real; only
  -- genuinely out-of-band caps (>12% / <0.5%) auto-exclude.
  IF v_cap IS NOT NULL AND (v_cap > 0.12 OR v_cap < 0.005) THEN
    NEW.cap_rate_confidence := 'suspect';
    IF NEW.exclude_from_market_metrics IS DISTINCT FROM false THEN
      NEW.exclude_from_market_metrics := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- (3) cap-of-record trigger: treat 'master_curated' as a trusted override (like
--     'manual') so a directly-set master cap is not re-derived away.
CREATE OR REPLACE FUNCTION public.dia_sales_cap_of_record_tg()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.cap_rate_source IN ('manual','master_curated') THEN
    RETURN NEW;
  END IF;
  SELECT d.cap_rate_final, d.cap_rate_source
    INTO NEW.cap_rate_final, NEW.cap_rate_source
  FROM public.dia_derive_cap_of_record(
    NEW.stated_cap_rate, NEW.cap_rate, NEW.calculated_cap_rate,
    NEW.rent_at_sale, NEW.sold_price, NEW.cap_rate_quality) d;
  RETURN NEW;
END;
$function$;

-- (4) backfill: un-suppress the corroborated, in-band, suppressed master deals.
UPDATE public.sales_transactions s
SET exclude_from_market_metrics = false,
    cap_rate_quality = CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL ELSE s.cap_rate_quality END,
    cap_rate_final = COALESCE(s.stated_cap_rate, s.cap_rate),
    cap_rate_source = 'master_curated',
    cap_rate_confidence = 'high',
    cap_rate_notes = CASE WHEN COALESCE(s.cap_rate_notes,'')='' THEN '' ELSE s.cap_rate_notes || ' | ' END
      || 'R66x.2: un-suppressed; cap corroborated by Dialysis Comp Work MASTER (R72 import); master_curated top-trust'
WHERE s.data_source = 'master_xlsx_backfill_r72'
  AND (COALESCE(s.exclude_from_market_metrics, false) OR s.cap_rate_quality = 'implausible_unverified')
  AND COALESCE(s.stated_cap_rate, s.cap_rate) BETWEEN 0.04 AND 0.12;
