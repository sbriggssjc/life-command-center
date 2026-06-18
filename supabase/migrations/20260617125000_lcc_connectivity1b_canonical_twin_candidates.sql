-- ===========================================================================
-- CONNECTIVITY #1b — Condition #1: same-canonical twin surfacing (canonical_name)
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- v_lcc_merge_candidates groups by lcc_normalize_entity_name(), which strips a
-- DIFFERENT suffix set than entities.canonical_name AND drops names < 4 chars —
-- so only 22 of the 83 dia (and 22-ish of the 177 gov) bridged-owner twins
-- surfaced. As the broad pass scales, every same-canonical twin must be VISIBLE
-- for human merge (surface, NEVER auto-merge).
--
-- This view lists ALL same-canonical ORGANIZATION twin groups (≥2 non-merged
-- members) keyed on entities.canonical_name (the column the bridge populates),
-- so the previously-invisible ~61 dia + the gov set become visible. It is
-- SURFACE-ONLY: it exposes NO auto_mergeable column and is NEVER read by
-- lcc_apply_fuzzy_merges (that applier reads only v_lcc_merge_candidates). The
-- Decision Center lane lists it (deduped by winner_id against the existing
-- candidates) and the merge VERDICT re-fetches loser_ids from it by winner_id —
-- the merge is always a human verdict.
--
-- winner-first ordering mirrors v_lcc_merge_candidates (role score → portfolio →
-- name length → id). `has_bridged_owner` lets the lane float the freshly-bridged
-- twins to the top. Additive + idempotent.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_lcc_canonical_twin_candidates AS
WITH q AS (
  SELECT
    e.id, e.name, e.canonical_name, e.owner_role, e.domain,
    ( SELECT count(*) FROM public.lcc_entity_portfolio_facts f WHERE f.entity_id = e.id) AS portfolio_size,
    (e.metadata ->> 'bridge_source') IN ('connectivity_inuse_owner', 'connectivity1_inuse_unknown_owner') AS is_bridged
  FROM public.entities e
  WHERE e.entity_type = 'organization'::entity_type
    AND e.merged_into_entity_id IS NULL
    AND e.name IS NOT NULL
    AND e.canonical_name IS NOT NULL
    AND e.canonical_name <> ''
),
g AS (
  SELECT
    q.canonical_name,
    array_agg(q.id ORDER BY (CASE q.owner_role
        WHEN 'developer' THEN 1 WHEN 'operator' THEN 2 WHEN 'user_owner' THEN 3 WHEN 'buyer' THEN 4 ELSE 5 END),
      q.portfolio_size DESC, length(q.name) DESC, q.id) AS member_ids_winner_first,
    array_agg(q.name ORDER BY (CASE q.owner_role
        WHEN 'developer' THEN 1 WHEN 'operator' THEN 2 WHEN 'user_owner' THEN 3 WHEN 'buyer' THEN 4 ELSE 5 END),
      q.portfolio_size DESC, length(q.name) DESC, q.id) AS member_names_winner_first,
    array_agg(DISTINCT q.domain) FILTER (WHERE q.domain IS NOT NULL) AS domains,
    count(*) AS member_count,
    bool_or(q.is_bridged) AS has_bridged_owner
  FROM q
  GROUP BY q.canonical_name
  HAVING count(*) >= 2
)
SELECT
  canonical_name AS norm_name,
  member_ids_winner_first[1] AS winner_id,
  member_names_winner_first[1] AS winner_name,
  member_ids_winner_first[2:] AS loser_ids,
  member_names_winner_first[2:] AS loser_names,
  member_count,
  domains,
  has_bridged_owner
FROM g;

GRANT SELECT ON public.v_lcc_canonical_twin_candidates TO anon, authenticated;

COMMENT ON VIEW public.v_lcc_canonical_twin_candidates IS
  'CONNECTIVITY #1b: ALL same-canonical_name org twin groups (>=2), surface-only '
  'for the Decision Center merge lane. NOT read by lcc_apply_fuzzy_merges — every '
  'merge is a human verdict. canonical_name catches the ~61 dia + gov twins the '
  'narrower lcc_normalize_entity_name grouping in v_lcc_merge_candidates missed.';
