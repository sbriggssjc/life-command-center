-- Migration: dia — Round 70 Layer B / D6: gate the core 10+ available-market
-- overlay where the in-band NON-core cohort is too thin to be a real contrast.
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live + committed.
--
-- Scott (D6): "the 10+ cohort average cap line should never be higher than the
-- total market figure." Receipts (read-only) showed this is NOT a bug in either
-- line: core ⊂ total, and in 6 quarters a TINY non-core cohort (e.g. 2014-Q2: 3
-- listings @ 6.01%) legitimately pulls the total average below the core average
-- (≤29 bps). The core overlay exists to CONTRAST core vs the broader market;
-- when the non-core population is < 3 in-band priced listings there is no
-- contrast to show — just noise that reads as an error to a chart reviewer.
--
-- Fix: the avg_cap_core_10plus gate already required core in-band n >= 3; ALSO
-- require non-core in-band n >= 3 (i.e. show the overlay only when both cohorts
-- have substance). Pure additive predicate on the existing CASE; column
-- shape/order unchanged. The chart note is annotated JS-side (cm-excel-export
-- CHART_NOTES) to disclose the gate.
--
-- Affected quarters (overlay was shown, now suppressed where non-core n<3):
--   verified read-only before applying; the small inversions disappear.
--
-- Reproducible in filename order (base view created earlier; this patch only
-- ANDs an extra count predicate into the core-overlay gate). Idempotent:
-- re-running finds the already-compound predicate and replaces it identically.

DO $r70d6$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.cm_dialysis_available_market_size_q'::regclass);
  d := replace(d,
    '(marketed.cap <= 0.12))) >= 3) THEN avg(marketed.cap) FILTER (WHERE ((NOT marketed.is_synth) AND marketed.is_core',
    '(marketed.cap <= 0.12))) >= 3 AND count(*) FILTER (WHERE ((NOT marketed.is_synth) AND (NOT marketed.is_core) AND (marketed.cap >= 0.04) AND (marketed.cap <= 0.12))) >= 3) THEN avg(marketed.cap) FILTER (WHERE ((NOT marketed.is_synth) AND marketed.is_core');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS ' || d;
END $r70d6$;
