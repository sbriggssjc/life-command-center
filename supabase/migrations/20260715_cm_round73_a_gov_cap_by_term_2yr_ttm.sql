-- =============================================================================
-- Round 73 Layer A — gov cap-by-remaining-lease-term cohort consistency (#14)
-- Project: government (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-08.
-- Receipts + full before/after: reports/CM_ROUND73_LAYER_A_COHORT_RECEIPTS.md
--
-- FINDING:
--   cm_gov_cap_by_term_m (the live-rendered view per cm_chart_catalog —
--   view_name_template = cm_{vertical}_cap_by_term_m; the exported
--   public/reports/cm_chart_catalog.json still says _q and is STALE) already
--   carried an n>=5 per-cohort gate and a +/-3-month centered smoothing, but
--   still pooled cap on a 1-YEAR TTM window. In the thin 2023-2026 tail the
--   1yr cohort n collapses to ~6-9 (n=3 at 2026-03), so even gated+smoothed the
--   cohort lines cross illogically and the 6-10yr line spikes to 8.30% at
--   2026-03 (a thin-n=3 artifact the +/-3mo smoothing cannot tame).
--
-- FIX: widen the TTM pooling window 1 year -> 2 years. This roughly doubles the
--   tail cohort n (n10 ~6-9 -> ~14-16), which lets the existing n>=5 gate keep
--   CONTINUOUS lines (not gaps) while removing the thin-n artifact crossings.
--   Gate (n>=5) and smoothing (+/-3mo) unchanged.
--
-- RESULT (quarter-ends, cohorts 10+ / 6-10 / <5):
--   2018Q1-2023Q4: 6 artifact-cross quarters -> 0 (ordered/parallel fan).
--   2026-03 6-10yr spike: 8.30% -> 7.49% (-81 bps; thin-n=3 artifact removed).
--   2024-2026: a residual inversion (10+yr cap ABOVE the shorter cohorts)
--     SURVIVES 2yr pooling + n>=5 -> it is GENUINE post-2023 gov repricing
--     (long-duration federal deals trading wider on rate/agency risk), NOT a
--     data/formula gap. Shown honestly rather than smoothed away.
--
-- Surgical + idempotent (re-edits the live view body, replacing only the TTM
-- window literal / gate constant; re-run is a no-op once '2 years' is present).
-- cm_gov_cap_by_term_q (not currently rendered) is aligned to the same 2yr
-- window + n>=5 gate so the two grains cannot diverge (66x divergence lesson).
-- =============================================================================

-- (1) Live-rendered monthly view: 1yr TTM -> 2yr TTM.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_cap_by_term_m'::regclass, true);
  v := replace(v, '(m.period_end - ''1 year''::interval)::date', '(m.period_end - ''2 years''::interval)::date');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS ' || v;
END $$;

-- (2) Quarterly sibling: same 2yr window + raise gate 3 -> 5 to match _m.
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_cap_by_term_q'::regclass, true);
  v := replace(v, '(q.period_end - ''1 year''::interval)::date', '(q.period_end - ''2 years''::interval)::date');
  v := replace(v, 'ttm.n10 >= 3',  'ttm.n10 >= 5');
  v := replace(v, 'ttm.n610 >= 3', 'ttm.n610 >= 5');
  v := replace(v, 'ttm.n5 >= 3',   'ttm.n5 >= 5');
  v := replace(v, 'ttm.nout >= 3', 'ttm.nout >= 5');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_q AS ' || v;
END $$;
