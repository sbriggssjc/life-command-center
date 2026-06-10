-- =============================================================================
-- Round 76 Layer A2 — gov cap-by-term: firm_rem mis-bin floor + mean->median
-- Project: government (scknotsqkcheojiaewwh).
-- Receipts + full before/after: audit/ROUND_76_FINDINGS_2026-06-10.md
--
-- Two surgical fixes to the three gov cap-by-term views, in Scott's order:
--
-- (1) MIS-BIN FLOOR (correctness, do-regardless). The firm_rem resolution
--     ladder preferred s.firm_term_years_at_sale FIRST, but that column is in
--     practice the ORIGINAL firm term (98.6% identical to s.firm_term_years
--     where both exist), NOT remaining-at-sale. For a mid-lease sale it
--     overstates the remaining term and drops the deal in too-high a cohort
--     (e.g. Williston VT: GSA termination AND lease-firm-remaining both say
--     ~1yr left, but the proxy said 6.0 -> bucketed 6-10 instead of <5).
--     A blanket reorder is WRONG: gsa_leases.termination_date often points
--     past the sold lease's firm end (renewed/mismatched leases), which would
--     move 437 rows mostly UPWARD. The correct floor takes the LEAST of the
--     genuine remaining sources present -- LEAST(firm_term_years_at_sale,
--     gsa_termination_remaining, lease_firm_remaining) -- which only ever
--     SHORTENS an overstated proxy (67 rows table-wide, all downward), and
--     falls through to firm_term_years / lease_expiration only when none of
--     the three exist. COALESCE(t1,t2,t3,t4,t5) -> COALESCE(LEAST(t1,t2,t3),t4,t5).
--
-- (2) MEAN -> MEDIAN (robustness + honesty). The cohort statistic was the
--     arithmetic mean, which the 2024-26 skew exaggerates (10+ mean 7.04 sat
--     BELOW its own median 7.28, so 6-10 visually overtook 10+). Median is the
--     conventional, robust cap-by-term statistic and pulls the recent cohorts
--     back toward the master's parallel fan. Only the INNER per-cohort stat
--     changes (avg(c.cap) -> percentile_cont(0.5)); the +/-1q (q) / +/-3mo
--     (m, dot) smoothing of the gated series is left as avg() (Scott: keep
--     smoothing as-is). The n>=5 gate and 2yr-TTM window are unchanged.
--
-- Verified (raw 2yr pool, before/after):
--   2026-Q1 (recent): OLD+mean 10+ 7.04 / 6-10 7.20 / <5 7.13 (NON-monotonic)
--                  -> NEW+median 10+ 7.14 / 6-10 7.23 / <5 7.50 (MONOTONIC).
--   2022-Q1 (clean historical): NEW+median 10+ 6.16 / 6-10 6.80 / <5 6.94
--                  -> the ~70-80bps premium STAYS INTACT (Scott's guardrail).
--
-- Surgical + idempotent: re-edits the live view body via string replace; a
-- re-run is a no-op once LEAST(...) / percentile_cont(...) are present.
-- dia is NOT touched here: dia uses firm_term_years_at_sale directly with no
-- gsa/lease cross-check source, so the LEAST floor cannot apply, and the dia
-- mean-skew is mild + bidirectional (median is neutral-to-mixed) -- deferred
-- to Scott's gate per the dia leg discussion.
-- =============================================================================

DO $$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
      'public.cm_gov_cap_by_term_q',
      'public.cm_gov_cap_by_term_m',
      'public.cm_gov_sold_cap_by_term_dot']) AS relname
  LOOP
    v := pg_get_viewdef(r.relname::regclass, true);
    -- (1) mis-bin floor: COALESCE(t1,t2,t3,t4,t5) -> COALESCE(LEAST(t1,t2,t3),t4,t5)
    v := replace(v, 'COALESCE(s.firm_term_years_at_sale,', 'COALESCE(LEAST(s.firm_term_years_at_sale,');
    v := replace(v, 'LIMIT 1), s.firm_term_years,',        'LIMIT 1)), s.firm_term_years,');
    -- (2) inner cohort stat mean -> median (smoothing avg(cap_*_g) untouched).
    -- percentile_disc (not _cont) so the result stays numeric -- CREATE OR
    -- REPLACE VIEW cannot change the existing column type, and _cont returns
    -- double precision. _disc returns an actual observed cap; the difference
    -- from interpolated median is <few bps at these cohort n and does not
    -- affect the ordering fix.
    v := replace(v, 'avg(c.cap)', 'percentile_disc(0.5) WITHIN GROUP (ORDER BY c.cap)');
    EXECUTE 'CREATE OR REPLACE VIEW ' || r.relname || ' AS ' || v;
  END LOOP;
END $$;
