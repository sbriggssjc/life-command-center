-- =============================================================================
-- CM gov "Cap Rate by Remaining Lease Term" — fix the 4th cohort semantics.
-- Project: government (scknotsqkcheojiaewwh). Views live immediately (no deploy).
-- Rendered by cm_chart_catalog id=cap_rate_by_lease_term via cm_gov_cap_by_term_m.
--
-- FINDING (grounded live 2026-08-12, latest 2yr TTM window):
--   The chart's 4th line, labeled "Outside Firm Cap", was defined as
--     percentile FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL)
--   i.e. sales whose REMAINING FIRM TERM COULD NOT BE RESOLVED (firm_rem IS
--   NULL), NOT sales that are economically past their firm term. In the current
--   window those 25 deals ALL carry zero lease data (22 Federal / 2 State / 1
--   unknown — CoStar comps off every federal register we hold). Being mostly
--   tight-cap institutional federal comps, that "unknown-term" line plots
--   artificially LOW (~7.20%) — producing the impossible message that non-firm
--   deals trade RICHER (lower cap) than firm-term deals.
--
--   Meanwhile the GENUINELY past-firm deals (firm_rem <= 0, holdover / soft
--   term) were mis-bucketed into the "<6 Year" line because that bucket used
--   `firm_rem IS NOT NULL AND firm_rem <= 6`, which swallowed the negatives.
--
-- FIX (two surgical predicate swaps, applied identically to _m and _q):
--   1. "<6 Year" bucket: firm_rem IS NOT NULL AND <= 6  ->  firm_rem > 0 AND <= 6
--      (strictly-positive remaining firm term only).
--   2. "Outside Firm" bucket: (cap NOT NULL AND firm_rem IS NULL)  ->  firm_rem <= 0
--      (deals AT OR PAST their firm-term expiration — the true economic cohort).
--      The unresolved-term (firm_rem IS NULL) deals are DROPPED from the chart:
--      a cap-by-TERM chart must not plot deals whose term is unknown.
--
-- RESULT (verified live, latest TTM medians — now monotone, as expected):
--     10+ yr  7.30%  <  6-10 yr  7.49%  <  <6 yr  7.70%  <  past-firm  9.40%.
--   The corrected past-firm cohort is well-populated: n>=5 in ALL 138 months
--   since 2015 (avg ~45 deals/window), and the "longer firm term = lower cap"
--   head-to-tail ordering holds every month from 2011 forward.
--
-- Gate (n>=5) and 2yr TTM window unchanged. Surgical + idempotent (the old
-- predicate strings are gone after the first run, so re-running is a no-op).
-- Output column list/order UNCHANGED (CREATE OR REPLACE-safe).
-- REVERSAL: re-run 20260715_cm_round73_a_gov_cap_by_term_2yr_ttm.sql then this
-- file's inverse, or restore the pre-change predicates below.
-- =============================================================================

-- (1) Live-rendered monthly view.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_cap_by_term_m'::regclass, true);
  v := replace(v,
        'c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric',
        'c.firm_rem > 0::numeric AND c.firm_rem <= 6::numeric');
  v := replace(v,
        'c.cap IS NOT NULL AND c.firm_rem IS NULL',
        'c.firm_rem <= 0::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS ' || v;
END $$;

-- (2) Quarterly sibling: same two swaps, so the grains cannot diverge.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_cap_by_term_q'::regclass, true);
  v := replace(v,
        'c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric',
        'c.firm_rem > 0::numeric AND c.firm_rem <= 6::numeric');
  v := replace(v,
        'c.cap IS NOT NULL AND c.firm_rem IS NULL',
        'c.firm_rem <= 0::numeric');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_q AS ' || v;
END $$;
