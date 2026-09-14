-- N18 (2026-08-27): `v_lcc_developer_classification_candidates.attributed_rent`
-- correlated the rent subquery on `pof.source_property_id = pof.source_property_id`
-- -- a column compared to ITSELF -- so the scalar subquery degenerated to
-- `max(annual_rent)` over EVERY current portfolio fact in the domain, and the
-- enclosing sum() multiplied that one constant by the group's property count.
--
--   attributed_rent(broken) = props * domain_max_current_rent
--
-- Live before this migration (2026-08-27): all 6 rows read $34,920,891.77 -- one
-- distinct value -- because all 6 happen to carry props = 1. That single value is
-- the gov-wide MAX current annual_rent, NOT the gov-wide sum ($3.52B). Across the
-- full 277-candidate population the broken expression takes 11 distinct values,
-- topping out at $279,367,134.16 (= 8 x the domain max), so "one distinct value"
-- is a property of the surviving 6-row slice, not a general invariant.
--
-- Corrected, those 6 rows read $431,643.78 - $2,226,661.54 -- an overstatement of
-- 15.7x to 80.9x -- and the ranking the worker drains on FULLY REORDERS.
--
-- It is also the view's cost: EXPLAIN showed `One-Time Filter:
-- (pof.source_property_id = pof.source_property_id)` at loops=385, scanning 3,183
-- rows per loop and burning 2,084,423 of the query's 2,102,242 buffers (99.2%).
-- Textbook P118: `loops=` equal to the row count is a correlated subplan and no
-- index can fix one.
--
-- ---------------------------------------------------------------------------
-- WHY THE WHOLE VIEW BODY IS RESTATED HERE (P194)
-- ---------------------------------------------------------------------------
-- The newest COMMITTED definition (20260609170000) is CORRECT -- it reads
-- `pf.source_property_id = pof.source_property_id`. The defect existed ONLY in the
-- live database, alongside N15c's `lcc_normalize_entity_name(e.name)` repoint,
-- which was likewise applied live and never committed. The repo has therefore not
-- described the running view since N15c, and the next rebuild from the repo would
-- have silently reverted the repoint (267 -> 196 resolved candidates, per N15c s6).
-- This migration carries the ENTIRE view -- the 20260609170000 body + N15c's
-- repoint + the one-character fix -- so repo and database agree again. A second
-- copy that is correct beats no copy at all.
--
-- DELIBERATELY UNCHANGED: the Signal B (`bts_multi_prop`) arm stays dropped -- it
-- was removed by 20260609150000 and is not being revived here; the two exclusions
-- (`lcc_match_buyer_parent_by_name`, `lcc_developer_classification_log`) stay; the
-- N15c repoint stays; column list, order, names and types are byte-for-byte the
-- same (CREATE OR REPLACE VIEW is append-only for columns).
--
-- DB-safety: view-only, no data mutated, live on apply (no redeploy -- the handler
-- reads the view per request). REVERSAL: re-apply the body below with
-- `pf.source_property_id` changed back to `pof.source_property_id`.

BEGIN;

CREATE OR REPLACE VIEW public.v_lcc_developer_classification_candidates
WITH (security_invoker = true) AS
WITH named AS (
  SELECT pof.source_domain,
         public.lcc_normalize_entity_name(pof.developer_name) AS norm,
         min(pof.developer_name) AS candidate_name,
         count(*) AS props,
         COALESCE(sum( (SELECT max(pf.annual_rent)
                        FROM public.lcc_entity_portfolio_facts pf
                        WHERE pf.source_domain = pof.source_domain
                          -- N18: was `pof.source_property_id = pof.source_property_id`
                          AND pf.source_property_id = pof.source_property_id
                          AND pf.is_current) ), 0) AS attributed_rent
  FROM public.lcc_property_owner_facts pof
  WHERE pof.developer_name IS NOT NULL AND btrim(pof.developer_name) <> ''
    AND public.lcc_normalize_entity_name(pof.developer_name) IS NOT NULL
  GROUP BY pof.source_domain, public.lcc_normalize_entity_name(pof.developer_name)
),
named_c AS (
  SELECT 'named_developer'::text AS signal, n.source_domain, n.candidate_name, n.norm, n.props, n.attributed_rent,
         e.id AS entity_id, COALESCE(e.behavioral_override, e.owner_role) AS cur_role
  FROM named n
  -- N15c: computes the aggressive normalizer instead of reading e.canonical_name
  -- (which another writer owns). Index: idx_entities_norm_name_org.
  LEFT JOIN public.entities e ON public.lcc_normalize_entity_name(e.name) = n.norm
                            AND e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'
)
SELECT u.signal, u.source_domain, u.candidate_name, u.norm, u.props, u.attributed_rent, u.entity_id, u.cur_role
FROM named_c u
WHERE COALESCE(u.cur_role, '') NOT IN ('operator', 'developer')
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT parent_entity_id FROM public.lcc_buyer_parents))
  AND (u.entity_id IS NULL OR u.entity_id NOT IN (SELECT entity_id FROM public.lcc_buyer_spe_resolved))
  AND NOT EXISTS (SELECT 1 FROM public.lcc_match_buyer_parent_by_name(u.candidate_name))
  AND NOT EXISTS (SELECT 1 FROM public.lcc_developer_classification_log lg
                  WHERE lg.source_domain = u.source_domain AND lg.candidate_norm = u.norm);

GRANT SELECT ON public.v_lcc_developer_classification_candidates TO authenticated;

COMMENT ON VIEW public.v_lcc_developer_classification_candidates IS
  'R9 Slice 3 conservative developer classifier (inspectable rule). Signal A = '
  'explicit developer_name (ground truth). Excludes registered buyer parents, '
  'confirmed buyer-SPE shells, current operators/developers, name-matched buyer '
  'parents, and anything already in lcc_developer_classification_log. Drained by '
  'api/admin.js handleChainClassifyTick, ORDERED BY attributed_rent. '
  'N15c: joins on lcc_normalize_entity_name(e.name), not e.canonical_name. '
  'N18: attributed_rent correlates on pf.source_property_id (was a self-comparison '
  'that returned props * domain-wide max rent).';

COMMIT;
