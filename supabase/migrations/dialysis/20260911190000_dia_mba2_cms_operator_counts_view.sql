-- ============================================================================
-- MB-a2 — server-side aggregation for the P-SQL market-brief CMS operator
-- counts source.
--
-- The market-brief-psql-tick (life-command-center) reads
-- medicare_clinics?dedup_status=neq.demoted_duplicate&chain_organization=not.is.null
-- with `&limit=1000` and counts operators CLIENT-SIDE. There are 6,695
-- eligible rows (verified live 2026-09-11), so that select is silently
-- truncated to ~15% of the population by PostgREST's hard 1000-row response
-- cap (CLAUDE.md invariant: "PostgREST caps every response at 1000 rows
-- regardless of limit") — and the counts would still look plausible (no
-- error, no empty result), which is exactly the failure mode CLAUDE.md's
-- "the failure mode that matters looks exactly like success" section warns
-- against.
--
-- Fix: aggregate in SQL. This view groups the full table server-side, so the
-- tick's client-side slice-to-top-N (TOP_OPERATOR_LIMIT) operates on the
-- true per-operator counts, not a 1000-row prefix of them. The view itself
-- returns at most a few dozen rows (32 distinct operators measured live),
-- well under the PostgREST page cap, so no further pagination is needed on
-- the read side.
--
-- No RLS/PII exposure: this is a count of clinics per operator name, already
-- readable in bulk via the raw table. SECURITY INVOKER (default) means the
-- view carries no elevated privilege of its own.
--
-- REVERSAL: DROP VIEW IF EXISTS public.v_market_brief_cms_operator_counts;
-- ============================================================================

CREATE OR REPLACE VIEW public.v_market_brief_cms_operator_counts AS
SELECT
  chain_organization AS operator,
  count(*)::bigint AS clinic_count
FROM public.medicare_clinics
WHERE dedup_status IS DISTINCT FROM 'demoted_duplicate'
  AND chain_organization IS NOT NULL
GROUP BY chain_organization
ORDER BY clinic_count DESC, chain_organization ASC;

COMMENT ON VIEW public.v_market_brief_cms_operator_counts IS
  'MB-a2 — server-side per-operator clinic counts (dedup_status <> demoted_duplicate, '
  'chain_organization not null) for the P-SQL market-brief producer. Aggregating here '
  'avoids the client-side 1000-row PostgREST truncation that a raw table select would '
  'hit (6,695 eligible rows measured 2026-09-11 vs. 32 distinct operators returned by '
  'this view).';

-- A VIEW gets no default PUBLIC grant (CLAUDE.md footgun) — grant explicitly,
-- mirroring v_dia_on_market (CLAUDE.md §17: "SECURITY INVOKER + granted to
-- anon/auth/service_role"). domainQuery('dialysis', ...) prefers
-- DIA_SUPABASE_SERVICE_KEY but falls back to the anon key, so anon must be
-- able to read this too.
GRANT SELECT ON public.v_market_brief_cms_operator_counts TO anon, authenticated, service_role;
