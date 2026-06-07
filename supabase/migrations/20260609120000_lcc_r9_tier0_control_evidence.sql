-- R9 Slice 1 (2026-06-09): tier-0 control-vs-counterparty evidence.
-- ===========================================================================
-- PROBLEM (R8 honest finding, re-grounded live 2026-06-09): tier-0
-- (domain_true_owner) re-parented an entity whenever ANY of its current
-- properties' true_owner mapped to a registered buyer parent, with an unordered
-- LIMIT 1. A portfolio LINK is not a control relationship, so this folded
-- multi-property DEVELOPERS/REITs who merely SOLD to a parent under that parent
-- as if they were its SPEs:
--   * Choice One Development LLC  (7 props, only 1 -> Elliott Bay = 14%)
--   * Incommercial Property Group (9 props, only 1 -> Elliott Bay = 11%)
--   * EastGroup Properties, Inc.  (5 props, 60% -> Easterly; a different REIT)
--   * Realty Income Corporation   (-> Capital Square, via portfolio link only)
-- Consequence with teeth: the R5/R8 buyer-SPE GATE then REFUSES prospect
-- opportunities + cadences on them -- and developers are exactly who the P0
-- band exists to prospect.
--
-- WHY THE OBVIOUS NAME FIXES DON'T WORK (grounded, see the round notes):
--   * "entity name == recorded_owner_name" DROPS ~55 legit Boyd FGF/SGF/GSA
--     shells, because the gov mirror unreliably stores the MANAGER
--     ("Boyd Watterson") in recorded_owner_name rather than the SPE name
--     (Lincoln NE I FGF -> recorded "Boyd Watterson"). The named keep/drop
--     cases are STRUCTURALLY IDENTICAL on recorded/true-owner names
--     (Choice One ~ Platform Ventures; EIG Wadsworth ~ ATLANTA GSA CIS), so a
--     name-match rule cannot separate the populations.
--   * recorded-owner name-match + lcc_is_spe_shell_name are kept ONLY as
--     confidence ANNOTATIONS for the human lanes (below), never as gates.
--
-- THE DOCTRINE PREDICATE (Scott, 2026-06-09): tier-0 re-parents an entity ONLY
-- on control-vs-counterparty EVIDENCE:
--   1. PORTFOLIO CONCENTRATION (primary): a true SPE is single-purpose -- its
--      whole footprint belongs to ONE parent. Require the majority registered
--      parent to cover >= 80% of the entity's current properties, and == 100%
--      when the entity has <= 2 properties. The majority parent (most matched
--      props, tie-break by name) is the deterministic pick -- this also removes
--      the old unordered-LIMIT-1 noise. A scattered developer (Choice One 14%)
--      fails immediately.
--   2. COUNTERPARTY EXCLUSION (affirmative "developer who sold"): if the entity
--      is the SELLER in a sale event that transferred a property to the parent
--      (lcc_listing_events.seller_name normalized match, buyer -> same parent),
--      it is a counterparty, not a shell -- excluded regardless of concentration.
--   3. parent_self precedence is preserved (a registered parent is never an SPE).
--
-- ROLE PRECEDENCE -- DEFERRED to Slice 3 (NOT a gate here): Scott asked for
-- "never re-parent an entity whose effective_owner_role is developer (or that
-- Unit 2 classifies as developer)". GROUNDING FINDING: the EXISTING
-- entities.owner_role is noisy -- the dia/gov BTS classifier tags ~55 legit
-- single-asset Boyd FGF/SGF/GSA shells (Tucson AZ IV SGF, GLENDALE GSA,
-- Lincoln NE I FGF, ...) as owner_role='developer'. Gating tier-0 on that
-- existing role would DROP the very shells the acceptance criterion requires
-- KEPT. Per Scott's own wording ("or that Unit 2 CLASSIFIES as developer") the
-- trustworthy developer signal is Unit 2's CONSERVATIVE, chain-grounded
-- classification, which lands in Slice 3. Concentration + counterparty are the
-- primary signals and are sufficient here; developer-role precedence joins in
-- Slice 3 when it won't mislabel single-asset shells.
--
-- GROUNDED MEMBERSHIP DIFF (live, read-only, before applying):
--   * buyer-SPE set 431 -> 418 entities: 13 LEAVE, 0 JOIN.
--   * KEEP (all): Tucson AZ IV SGF, GLENDALE GSA, Lincoln NE I FGF,
--     WASHINGTON DC VI FGF, ATLANTA GSA CIS, USGP II LITTLE ROCK FBI (single-
--     asset / 100%-concentrated -> trivially pass).
--   * DROP (all): Choice One Development, Incommercial, Realty Income,
--     EastGroup Properties (scattered portfolios). Choice One leaves the set
--     entirely (not caught by any other tier) -> it can now be prospected.
--   * Platform Ventures STAYS via the prefix/empirical tier (tier-0 change does
--     not touch it).
--   * EIG Wadsworth KEEPS (1 prop, 100% -> Massmutual, not a seller-
--     counterparty). Per Scott: "let the concentration test decide and report
--     -- either outcome is correct if grounded." Reported, not forced.
--   * Residue (the <=2-prop FGF/TEP shells whose 2nd property lacks mirror
--     coverage -> < 100%): CHESAPEAKE VA II FGF, WASHINGTON DC V FGF,
--     LAS CRUCES GSA DEA, TEP HARRISON/MCALESTER, Alex City SSA, Orion Eagle
--     Pass, ELV I Associates, FGF Management, Opi Wf Owner. These drop
--     conservatively into P0.4 for human "confirm control relationship" review
--     and rejoin automatically once owner-facts coverage fills in -- exactly
--     the residue->human-lane posture Scott specified.
--
-- DEPLOY SAFETY: DB-only, CREATE OR REPLACE, idempotent, cache-or-live. The
-- resolver reads tier-0 from the cache-or-live v_lcc_buyer_spe_entities, which
-- is rebuilt from v_lcc_entity_tier0_parent -- so the resolver, the gate
-- trigger, the queue NOT-IN gates, and the P-BUYER rollup all stay in lock-step
-- by construction. Empty cache => exact live computation (no deploy-order
-- coupling). Nothing here touches the auth schema / GoTrue / public.users /
-- workspace_memberships; entity-scale tables only; ANALYZE baked into refresh.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. v_lcc_entity_tier0_parent -- the SINGLE source of truth for tier-0.
--    Per org entity (not itself a registered parent), the majority registered
--    buyer parent of its CURRENT-property footprint, gated by concentration +
--    counterparty exclusion. Both the resolver (via the cache-or-live view) and
--    v_lcc_buyer_spe_entities_live consume THIS, so they cannot drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_entity_tier0_parent
WITH (security_invoker = true) AS
WITH ent_prop AS (
  -- one row per (entity, current property) with that property's mapped parent
  -- (NULL when the property's true_owner maps to no registered parent). NULL
  -- rows still count toward the denominator (the single-purpose footprint test).
  SELECT DISTINCT
    pf.entity_id,
    pf.source_domain,
    pf.source_property_id,
    m.parent_entity_id,
    m.parent_name
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.entities e
    ON e.id = pf.entity_id
   AND e.entity_type = 'organization'::entity_type
   AND e.merged_into_entity_id IS NULL
  LEFT JOIN public.lcc_property_owner_facts pof
    ON pof.source_domain = pf.source_domain
   AND pof.source_property_id = pf.source_property_id
  LEFT JOIN LATERAL public.lcc_match_buyer_parent_by_name(pof.true_owner_name)
    m(parent_entity_id, parent_name) ON true
  WHERE pf.is_current = true
    -- parent_self precedence: a registered buyer parent is never an SPE.
    AND NOT EXISTS (
      SELECT 1 FROM public.lcc_buyer_parents bp
      WHERE bp.parent_entity_id = pf.entity_id)
),
totals AS (
  SELECT entity_id,
         count(DISTINCT (source_domain, source_property_id)) AS total_props
  FROM ent_prop
  GROUP BY entity_id
),
pcount AS (
  SELECT entity_id, parent_entity_id, parent_name,
         count(DISTINCT (source_domain, source_property_id)) AS matched_props
  FROM ent_prop
  WHERE parent_entity_id IS NOT NULL
    AND parent_entity_id <> entity_id
  GROUP BY entity_id, parent_entity_id, parent_name
),
ranked AS (
  SELECT pc.entity_id, pc.parent_entity_id, pc.parent_name, pc.matched_props,
         t.total_props,
         pc.matched_props::numeric / NULLIF(t.total_props, 0) AS concentration,
         row_number() OVER (
           PARTITION BY pc.entity_id
           ORDER BY pc.matched_props DESC, pc.parent_name ASC) AS rn
  FROM pcount pc
  JOIN totals t ON t.entity_id = pc.entity_id
)
SELECT r.entity_id, r.parent_entity_id, r.parent_name,
       r.total_props, r.matched_props, r.concentration
FROM ranked r
WHERE r.rn = 1
  AND r.concentration >= 0.80
  AND (r.total_props > 2 OR r.concentration >= 1.0)   -- <=2 props require 100%
  AND NOT EXISTS (  -- counterparty: the entity SOLD a property to this parent
    SELECT 1
    FROM public.lcc_entity_portfolio_facts pf2
    JOIN public.lcc_listing_events le
      ON le.source_domain = pf2.source_domain
     AND le.source_property_id = pf2.source_property_id
    JOIN LATERAL public.lcc_match_buyer_parent_by_name(le.buyer_name)
      bm(parent_entity_id, parent_name) ON true
    JOIN public.entities se ON se.id = r.entity_id
    WHERE pf2.entity_id = r.entity_id
      AND pf2.is_current = true
      AND le.seller_name IS NOT NULL
      AND public.lcc_normalize_entity_name(le.seller_name)
          IS NOT DISTINCT FROM public.lcc_normalize_entity_name(se.name)
      AND bm.parent_entity_id = r.parent_entity_id
  );

GRANT SELECT ON public.v_lcc_entity_tier0_parent TO authenticated;

COMMENT ON VIEW public.v_lcc_entity_tier0_parent IS
  'R9 Slice 1: per-entity tier-0 (domain_true_owner) parent by control evidence '
  '-- majority-parent portfolio concentration (>=80%, ==100% when <=2 props) '
  'minus seller-counterparties. Single source of truth consumed by the resolver '
  '(via cache-or-live v_lcc_buyer_spe_entities) and v_lcc_buyer_spe_entities_live.';

-- ---------------------------------------------------------------------------
-- 2. v_lcc_buyer_spe_entities_live: repoint the tier-0 (first) branch at
--    v_lcc_entity_tier0_parent. Other three branches verbatim (R6-hotfix).
--    Column list unchanged -> CREATE OR REPLACE legal for the cache-or-live
--    view + candidates/rollup dependents.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities_live AS
 SELECT t.entity_id,
    t.parent_entity_id,
    t.parent_name,
    'domain_true_owner'::text AS match_tier
   FROM public.v_lcc_entity_tier0_parent t
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
-- 3. lcc_resolve_buyer_parent: parent_self FIRST (R6-hotfix), then tier-0 read
--    from the cache-or-live v_lcc_buyer_spe_entities (lock-step with the SPE
--    set + fast via the entity index on the cache), then candidate tiers.
--    Signature unchanged -> the gate trigger, JS resolveBuyerParent(), the
--    queue exclusion, and P-BUYER all inherit the new tier-0.
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
    -- tier-0 (domain_true_owner) via control evidence, sourced from the
    -- cache-or-live SPE view so it is identical to the materialized set.
    SELECT s.parent_entity_id, s.parent_name
    FROM public.v_lcc_buyer_spe_entities s
    WHERE s.entity_id = p_entity_id
      AND s.match_tier = 'domain_true_owner'
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
-- 4. v_lcc_entity_resolution_state: append the tier-0 control-evidence
--    annotations (concentration + footprint) for the human "confirm control
--    relationship" lane. Recorded-shell / SPE-name annotations already ride in
--    resolve_reason. Columns APPENDED at the end (the append-only view rule).
--    Body is the live definition verbatim plus the LEFT JOIN annotation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_entity_resolution_state
WITH (security_invoker = true) AS
 SELECT e.id AS entity_id,
    e.name AS entity_name,
    e.domain,
    bp.parent_entity_id AS resolves_to_parent_id,
    bp.parent_name AS resolves_to_parent_name,
    bp.match_tier AS resolution_tier,
    tof.true_owner_name,
    tof.developer_name,
    conn.is_connected,
    conn.connection_kind,
    conn.is_connected AS resolution_complete,
        CASE
            WHEN conn.is_connected THEN 'connected'::text
            WHEN bp.parent_entity_id IS NOT NULL THEN 'resolves_to_parent_connect_parent'::text
            WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(e.name) THEN 'true_owner_known_connect'::text
            WHEN lcc_is_spe_shell_name(e.name) THEN 'recorded_owner_shell_true_owner_unresolved'::text
            ELSE 'owner_known_connect'::text
        END AS resolve_reason,
    t0a.concentration AS tier0_concentration,
    t0a.matched_props AS tier0_matched_props,
    t0a.total_props   AS tier0_total_props
   FROM entities e
     LEFT JOIN LATERAL ( SELECT lcc_resolve_buyer_parent.parent_entity_id,
            lcc_resolve_buyer_parent.parent_name,
            lcc_resolve_buyer_parent.match_tier
           FROM lcc_resolve_buyer_parent(e.id) lcc_resolve_buyer_parent(parent_entity_id, parent_name, match_tier)
         LIMIT 1) bp ON true
     LEFT JOIN public.v_lcc_entity_tier0_parent t0a ON t0a.entity_id = e.id
     LEFT JOIN LATERAL ( SELECT pof.true_owner_name,
            pof.developer_name
           FROM lcc_entity_portfolio_facts pf
             JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
          WHERE pf.entity_id = e.id AND pf.is_current = true
          ORDER BY pf.ownership_start_date DESC NULLS LAST
         LIMIT 1) tof ON true
     LEFT JOIN LATERAL ( SELECT sf.has_sf OR pr.has_person AS is_connected,
                CASE
                    WHEN sf.has_sf AND pr.has_person THEN 'sf+contact'::text
                    WHEN sf.has_sf THEN 'salesforce'::text
                    WHEN pr.has_person THEN 'contact'::text
                    ELSE NULL::text
                END AS connection_kind
           FROM ( SELECT (EXISTS ( SELECT 1
                           FROM external_identities ei
                          WHERE ei.entity_id = e.id AND ei.source_system = 'salesforce'::text)) AS has_sf) sf,
            ( SELECT (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.from_entity_id = e.id)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.to_entity_id = e.id)) AS has_person) pr) conn ON true
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL;

GRANT SELECT ON public.v_lcc_entity_resolution_state TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Refresh the materialized caches so the live queue + resolver reflect the
--    new tier-0 immediately (cache-or-live serves the cache when populated).
-- ---------------------------------------------------------------------------
SELECT public.lcc_refresh_buyer_spe_resolved();
SELECT public.lcc_refresh_priority_queue_resolved();

COMMIT;
