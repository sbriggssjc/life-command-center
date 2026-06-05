-- R6 resolver bug-fix (2026-06-08): parent_self must outrank tier-0.
-- ===========================================================================
-- BUG (live, P-BUYER lane): clicking "Open Government Buyer →" on a REGISTERED
-- buyer parent routed the opportunity to a DIFFERENT parent. Repro: Boyd
-- Watterson Global (a registered parent) resolved to NGP Capital via
-- lcc_resolve_buyer_parent, match_tier='domain_true_owner'.
--
-- MECHANISM: in lcc_resolve_buyer_parent, tier-0 (the t0 domain_true_owner CTE)
-- ran BEFORE the parent_self branch. Boyd's current-property portfolio is mostly
-- "Boyd Watterson"/"Boyd Watterson Global" plus one stray NGP-owned property.
-- Tier-0 excludes the entity's OWN-name matches (m.parent_entity_id <>
-- p_entity_id), so the single NGP-owned property was the only surviving tier-0
-- match → the unordered LIMIT 1 returned NGP. The parent_self check that would
-- correctly return Boyd never ran because it was gated on NOT EXISTS (t0).
--
-- DOCTRINE: a REGISTERED buyer parent is never an SPE of another parent. If the
-- entity is itself a row in lcc_buyer_parents, resolve to itself and stop —
-- parent_self takes precedence over tier-0.
--
-- FIX (two coordinated halves, both additive / CREATE OR REPLACE, idempotent):
--   1. lcc_resolve_buyer_parent — evaluate parent_self FIRST; tier-0 (and the
--      candidate tiers) are gated on "this entity is NOT itself a registered
--      parent". Signature unchanged → the R5 gate trigger, the JS
--      resolveBuyerParent(), the queue exclusion, and P-BUYER all inherit it.
--   2. v_lcc_buyer_spe_entities_live (the cache source for the queue / rollup)
--      — its tier-0 UNION branch must also exclude entities that are themselves
--      registered parents, so the materialized cache (lcc_buyer_spe_resolved)
--      and therefore the P-BUYER rollup + the P0.5 NOT IN gates don't
--      mis-attribute a parent's portfolio to another parent.
--
-- After replacing the function + view, the two materialized caches are
-- refreshed so the live queue / resolver reflect the fix immediately.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. lcc_resolve_buyer_parent: parent_self FIRST, then tier-0, then candidates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_resolve_buyer_parent(p_entity_id uuid)
RETURNS TABLE(parent_entity_id uuid, parent_name text, match_tier text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH ps AS (
    -- parent_self takes ABSOLUTE precedence: a registered buyer parent is never
    -- an SPE of another parent. Resolve to itself and stop.
    SELECT bp.parent_entity_id, pe.name AS parent_name
    FROM public.lcc_buyer_parents bp
    JOIN public.entities pe ON pe.id = bp.parent_entity_id
    WHERE bp.parent_entity_id = p_entity_id
    LIMIT 1
  ),
  t0 AS (
    -- The entity's CURRENT property's domain true_owner maps to a registered
    -- buyer parent. Per-row domain truth — outranks name patterns, BUT only when
    -- the entity is not itself a registered parent (guarded via NOT EXISTS ps).
    SELECT m.parent_entity_id, m.parent_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain
     AND pof.source_property_id = pf.source_property_id
    JOIN LATERAL public.lcc_match_buyer_parent_by_name(pof.true_owner_name) m ON true
    WHERE pf.entity_id = p_entity_id AND pf.is_current = true
      AND pof.true_owner_name IS NOT NULL
      AND m.parent_entity_id <> p_entity_id
      AND NOT EXISTS (SELECT 1 FROM ps)
    LIMIT 1
  )
  SELECT parent_entity_id, parent_name, 'parent_self'::text FROM ps
  UNION ALL
  SELECT parent_entity_id, parent_name, 'domain_true_owner'::text FROM t0
  UNION ALL
  SELECT s.parent_entity_id, s.parent_name, s.match_tier
  FROM public.v_lcc_buyer_spe_candidates s
  WHERE s.entity_id = p_entity_id
    AND NOT EXISTS (SELECT 1 FROM ps)
    AND NOT EXISTS (SELECT 1 FROM t0)
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. v_lcc_buyer_spe_entities_live: the tier-0 UNION branch must exclude
--    entities that are themselves registered parents. Verbatim R5+R6 body with
--    one added guard on the first branch ("... AND NOT EXISTS registered
--    parent"). Column list unchanged → CREATE OR REPLACE is legal against the
--    cache-or-live view and the candidates / rollup dependents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities_live AS
 SELECT pf.entity_id,
    m.parent_entity_id,
    m.parent_name,
    'domain_true_owner'::text AS match_tier
   FROM lcc_entity_portfolio_facts pf
     JOIN entities e ON e.id = pf.entity_id AND e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL
     JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
     JOIN LATERAL lcc_match_buyer_parent_by_name(pof.true_owner_name) m(parent_entity_id, parent_name) ON true
  WHERE pf.is_current = true AND pof.true_owner_name IS NOT NULL AND m.parent_entity_id <> pf.entity_id
    AND NOT EXISTS (SELECT 1 FROM lcc_buyer_parents bp2 WHERE bp2.parent_entity_id = pf.entity_id)
UNION
 SELECT bp.parent_entity_id AS entity_id,
    bp.parent_entity_id,
    pe.name AS parent_name,
    'parent_self'::text AS match_tier
   FROM lcc_buyer_parents bp
     JOIN entities pe ON pe.id = bp.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    p.parent_entity_id,
    parent.name AS parent_name,
    'prefix'::text AS match_tier
   FROM entities e
     JOIN lcc_operator_affiliate_patterns p ON p.relationship = 'buyer_parent'::text AND
        CASE p.pattern_type
            WHEN 'exact'::text THEN lower(e.name) = lower(p.pattern_name)
            WHEN 'prefix'::text THEN lower(e.name) ~~ lower(p.pattern_name)
            WHEN 'contains'::text THEN lower(e.name) ~~ (('%'::text || lower(p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> p.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    par_p.parent_entity_id,
    parent.name AS parent_name,
    'empirical_portfolio'::text AS match_tier
   FROM entities e
     JOIN lcc_entity_portfolio_facts f ON f.entity_id = e.id AND f.is_current = true
     JOIN LATERAL ( SELECT le.buyer_name
           FROM lcc_listing_events le
          WHERE le.source_domain = f.source_domain AND le.source_property_id = f.source_property_id AND le.buyer_name IS NOT NULL
          ORDER BY le.event_date DESC NULLS LAST
         LIMIT 1) lev ON true
     JOIN lcc_operator_affiliate_patterns par_p ON par_p.relationship = 'buyer_parent'::text AND
        CASE par_p.pattern_type
            WHEN 'exact'::text THEN lower(lev.buyer_name) = lower(par_p.pattern_name)
            WHEN 'prefix'::text THEN lower(lev.buyer_name) ~~ lower(par_p.pattern_name)
            WHEN 'contains'::text THEN lower(lev.buyer_name) ~~ (('%'::text || lower(par_p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = par_p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> par_p.parent_entity_id;

-- ---------------------------------------------------------------------------
-- 3. Refresh the materialized caches so the live queue + resolver reflect the
--    fix immediately (the cache-or-live views serve the cache when populated).
-- ---------------------------------------------------------------------------
SELECT public.lcc_refresh_buyer_spe_resolved();
SELECT public.lcc_refresh_priority_queue_resolved();

COMMIT;
