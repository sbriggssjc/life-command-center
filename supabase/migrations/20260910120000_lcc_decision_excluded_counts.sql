-- ============================================================================
-- /api/decisions?summary=1 — stop paging the decided history to produce badges
-- ============================================================================
-- Measured live 2026-08-15: 16,199ms on page load.
--
-- What it was NOT (both checked, so nobody re-tests them):
--   * NOT the SQL — `v_lcc_decision_open_counts` runs in **85 ms**.
--   * NOT sequential federation — `api/admin.js` already wraps the federated
--     lanes in `Promise.all`.
--
-- What it WAS: summary mode called `fetchExcludedRefs(type)` once per federated
-- lane. That function pages EVERY non-open `subject_ref` for the type in
-- 1000-row SEQUENTIAL pages and materialises them into a Set — purely so the
-- caller can read `.size`. Roughly **18 sequential cross-region round-trips to
-- produce 17 integers** (LCC Opps is us-east-1; dia us-west-1; gov us-west-2).
--
-- This view returns all of those integers in ONE query.
--
-- ⚠️ count(DISTINCT subject_ref), NOT count(*). `fetchExcludedRefs` builds a
-- Set, so its `.size` is the DISTINCT count. Live: `match_disambiguation` has
-- **1,231 decided rows but only 1,044 distinct subject_refs** — a plain
-- count(*) would silently under-report that lane's badge by 187, and every
-- other lane with duplicate refs likewise. Verified equivalent across all 16
-- live decision types: zero mismatches.
--
-- The LIST branch still uses `fetchExcludedRefs` — it needs the actual refs to
-- filter rows, not just the size. Only the summary/badge path changed, and it
-- falls back to the paged Set if this view read fails, so a missing grant
-- degrades to the old behaviour rather than silently overstating every badge.
--
-- Additive and reversible: `drop view if exists public.v_lcc_decision_excluded_counts;`
-- (the JS fallback then carries the summary path unchanged).
-- ============================================================================
create or replace view public.v_lcc_decision_excluded_counts as
select decision_type,
       count(distinct subject_ref) as n_excluded
  from public.lcc_decisions
 where status <> 'open'
   and subject_ref is not null
 group by decision_type;

comment on view public.v_lcc_decision_excluded_counts is
  'Per-decision_type count of DISTINCT decided (non-open) subject_refs — the same number fetchExcludedRefs(type).size returns, without paging the refs. Used by /api/decisions?summary=1 to avoid ~18 sequential cross-region round-trips per page load.';

grant select on public.v_lcc_decision_excluded_counts to service_role;
