-- R6 (2026-06-06): ownership-resolution gating + tier-0 domain-truth.
-- File 1 of 4 (LCC Opps). Adds the owner-facts mirror, the per-row domain-truth
-- resolution tier (tier 0), and the inspectable per-entity resolution-state view
-- that drives the new P0.4 "Resolve ownership & control" band (File 2).
--
-- Doctrine (Scott, 2026-06-06, grounded against the live gov DB): an opportunity
-- is only the next action when the control structure is ALREADY resolved AND
-- connected. SPE shells must reconcile to their true owner/parent first; the
-- queue CTA must reflect the entity's resolution state, not jump to "Open
-- opportunity". Per-row domain truth OUTRANKS name patterns.
--
-- KEY GROUNDING FINDING: a blind "* FGF *" -> Boyd Watterson name pattern is
-- UNSAFE — live gov.properties shows the FGF recorded-owner shells split across
-- Boyd Watterson, The Shooshan Company (incl. the headline "ARLINGTON VA I FGF"),
-- Hyundai Securities, Lexington, Mountain Real Estate, Princeton Holdings, The
-- Boyer Co., ... and "OPI WF OWNER LLC" -> RMR (not GPT). So this round does NOT
-- register blind FGF/OPI entity-name patterns; tier-0 consumes the domain
-- true_owner per property instead, and only resolves to a REGISTERED parent.
--
-- DEPLOY ORDERING: every change is additive / backward-compatible.
--   * lcc_resolve_buyer_parent keeps its signature + 3-column return; tier-0 is
--     prepended and only contributes when the (initially empty) owner-facts
--     mirror has a true_owner that matches a registered buyer parent. Empty
--     mirror => identical behaviour to R5 (no regression).
--   * v_lcc_buyer_spe_entities / _candidates gain a tier-0 UNION branch (no
--     column change). Empty mirror => identical rows to R5.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Owner-facts mirror. Populated by the cross-DB sync in File 3
--    (20260606122000). Created here (empty) so the resolver + views can
--    reference it immediately; an empty mirror degrades gracefully to R5.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_property_owner_facts (
  source_domain       text NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_property_id  text NOT NULL,
  recorded_owner_name text,
  true_owner_name     text,
  developer_name      text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, source_property_id)
);

CREATE INDEX IF NOT EXISTS idx_lcc_property_owner_facts_true_owner
  ON public.lcc_property_owner_facts (lower(true_owner_name));

COMMENT ON TABLE public.lcc_property_owner_facts IS
  'Per-property recorded_owner / true_owner / developer NAMES mirrored from '
  'gov.v_property_owner_facts_portfolio (gov first; dia deferred). Feeds R6 '
  'tier-0 ownership resolution: per-row domain truth OUTRANKS name patterns.';

-- ---------------------------------------------------------------------------
-- 2. RMR true_owner aliases. Grounding showed "OPI WF OWNER LLC" properties
--    carry true_owner "RMR" / "The RMR Group" — match those spellings to the
--    already-registered RMR Group buyer parent so tier-0 resolves them.
-- ---------------------------------------------------------------------------
INSERT INTO public.lcc_operator_affiliate_patterns
  (parent_entity_id, pattern_name, pattern_type, relationship, notes)
SELECT bp.parent_entity_id, x.pat, x.typ, 'buyer_parent', 'R6 true_owner alias'
FROM public.lcc_buyer_parents bp
JOIN public.entities e ON e.id = bp.parent_entity_id AND e.merged_into_entity_id IS NULL
CROSS JOIN (VALUES ('rmr','exact'),('the rmr group','exact'),
                   ('the rmr group%','prefix'),('rmr group','exact')) AS x(pat,typ)
WHERE e.name ILIKE 'RMR Group%'
ON CONFLICT (parent_entity_id, pattern_name, pattern_type)
  DO UPDATE SET relationship = 'buyer_parent';

-- NOTE FOR SCOTT (does not auto-apply): the task suggested registering
-- "% FGF%" -> Boyd Watterson and "OPI %"/"OPI BND%"/"Opi Wf%" -> a GPT/OPI
-- parent, and renaming the GPT anchor to "Office Properties Income Trust (OPI)".
-- Live gov truth refutes both as blind patterns: FGF splits across many owners,
-- and OPI WF resolves to RMR (not GPT). Per the per-row-truth doctrine, neither
-- blind pattern is registered. If you still want the OPI anchor renamed, do it
-- explicitly — it is intentionally left alone here.

-- ---------------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------------

-- Match an OWNER NAME against the registered buyer-parent patterns. Used by
-- tier-0 (true_owner_name -> parent) in both the resolver and the buyer-SPE
-- classification view, so the two stay in lock-step.
CREATE OR REPLACE FUNCTION public.lcc_match_buyer_parent_by_name(p_name text)
RETURNS TABLE(parent_entity_id uuid, parent_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT p.parent_entity_id, pe.name
  FROM public.lcc_operator_affiliate_patterns p
  JOIN public.entities pe ON pe.id = p.parent_entity_id AND pe.merged_into_entity_id IS NULL
  WHERE p.relationship = 'buyer_parent' AND p_name IS NOT NULL
    AND CASE p.pattern_type
          WHEN 'exact'    THEN lower(p_name) = lower(p.pattern_name)
          WHEN 'prefix'   THEN lower(p_name) LIKE lower(p.pattern_name)
          WHEN 'contains' THEN lower(p_name) LIKE ('%' || lower(p.pattern_name) || '%')
          ELSE false
        END
  ORDER BY CASE p.pattern_type WHEN 'exact' THEN 1 WHEN 'prefix' THEN 2 ELSE 3 END
  LIMIT 1;
$$;

-- Conservative single-asset-shell name detector. Used ONLY to enrich the P0.4
-- reason text ("recorded owner shell — true owner unresolved"); never gates.
CREATE OR REPLACE FUNCTION public.lcc_is_spe_shell_name(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NOT NULL AND (
       p_name ~* '\m[A-Za-z]{2}\s+(I{1,3}|IV|VI{0,3}|IX|XI{0,2})\s'  -- "CITY ST VI ..."
    OR p_name ~* '\m(FGF|PROPCO|HOLDCO|SPE)\M'
    OR p_name ~* '\m(FUND|OWNER)\s+(LLC|LP|L\.?P\.?)\M'
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. tier-0 ownership resolution: extend lcc_resolve_buyer_parent. Tier 0
--    (domain_true_owner) takes precedence over the R5 prefix / empirical tiers.
--    Same signature + 3-column return => the R5 gate trigger, the JS
--    resolveBuyerParent(), the queue exclusion, and P-BUYER all inherit tier-0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_resolve_buyer_parent(p_entity_id uuid)
RETURNS TABLE(parent_entity_id uuid, parent_name text, match_tier text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH t0 AS (
    -- The entity's CURRENT property's domain true_owner maps to a registered
    -- buyer parent. Per-row domain truth — outranks name patterns.
    SELECT m.parent_entity_id, m.parent_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain
     AND pof.source_property_id = pf.source_property_id
    JOIN LATERAL public.lcc_match_buyer_parent_by_name(pof.true_owner_name) m ON true
    WHERE pf.entity_id = p_entity_id AND pf.is_current = true
      AND pof.true_owner_name IS NOT NULL
      AND m.parent_entity_id <> p_entity_id
    LIMIT 1
  )
  SELECT parent_entity_id, parent_name, 'domain_true_owner'::text FROM t0
  UNION ALL
  SELECT bp.parent_entity_id, pe.name, 'parent_self'::text
  FROM public.lcc_buyer_parents bp
  JOIN public.entities pe ON pe.id = bp.parent_entity_id
  WHERE bp.parent_entity_id = p_entity_id AND NOT EXISTS (SELECT 1 FROM t0)
  UNION ALL
  SELECT s.parent_entity_id, s.parent_name, s.match_tier
  FROM public.v_lcc_buyer_spe_candidates s
  WHERE s.entity_id = p_entity_id AND NOT EXISTS (SELECT 1 FROM t0)
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Fold tier-0 into the buyer-SPE classification so tier-0 matches also leave
--    P0.5/P0.4 and roll into the P-BUYER lane (queue consumes these views).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities
WITH (security_invoker = true) AS
-- Tier 0 (R6): entity's current property domain true_owner -> registered parent.
SELECT pf.entity_id AS entity_id, m.parent_entity_id, m.parent_name,
       'domain_true_owner'::text AS match_tier
FROM public.lcc_entity_portfolio_facts pf
JOIN public.entities e ON e.id = pf.entity_id
 AND e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
JOIN public.lcc_property_owner_facts pof
  ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
JOIN LATERAL public.lcc_match_buyer_parent_by_name(pof.true_owner_name) m ON true
WHERE pf.is_current = true AND pof.true_owner_name IS NOT NULL
  AND m.parent_entity_id <> pf.entity_id
UNION
-- Tier "parent_self": the parent itself.
SELECT bp.parent_entity_id, bp.parent_entity_id, pe.name, 'parent_self'::text
FROM public.lcc_buyer_parents bp
JOIN public.entities pe ON pe.id = bp.parent_entity_id
UNION
-- Tier 1: entity name prefix-matches a buyer_parent pattern.
SELECT e.id, p.parent_entity_id, parent.name, 'prefix'::text
FROM public.entities e
JOIN public.lcc_operator_affiliate_patterns p
  ON p.relationship = 'buyer_parent'
 AND CASE p.pattern_type
       WHEN 'exact'    THEN lower(e.name) = lower(p.pattern_name)
       WHEN 'prefix'   THEN lower(e.name) LIKE lower(p.pattern_name)
       WHEN 'contains' THEN lower(e.name) LIKE ('%' || lower(p.pattern_name) || '%')
       ELSE NULL::boolean
     END
JOIN public.entities parent ON parent.id = p.parent_entity_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND e.id <> p.parent_entity_id
UNION
-- Tier 2 (empirical): the entity's current property's latest sale buyer matches
-- a registered parent.
SELECT e.id, par_p.parent_entity_id, parent.name, 'empirical_portfolio'::text
FROM public.entities e
JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = e.id AND f.is_current = true
JOIN LATERAL (
  SELECT le.buyer_name
  FROM public.lcc_listing_events le
  WHERE le.source_domain = f.source_domain
    AND le.source_property_id = f.source_property_id
    AND le.buyer_name IS NOT NULL
  ORDER BY le.event_date DESC NULLS LAST LIMIT 1
) lev ON true
JOIN public.lcc_operator_affiliate_patterns par_p
  ON par_p.relationship = 'buyer_parent'
 AND CASE par_p.pattern_type
       WHEN 'exact'    THEN lower(lev.buyer_name) = lower(par_p.pattern_name)
       WHEN 'prefix'   THEN lower(lev.buyer_name) LIKE lower(par_p.pattern_name)
       WHEN 'contains' THEN lower(lev.buyer_name) LIKE ('%' || lower(par_p.pattern_name) || '%')
       ELSE NULL::boolean
     END
JOIN public.entities parent ON parent.id = par_p.parent_entity_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND e.id <> par_p.parent_entity_id;

-- best-tier-per-entity (domain_true_owner ranks first now).
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_candidates
WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.entity_id)
  s.entity_id,
  e.name   AS entity_name,
  e.domain AS entity_domain,
  s.parent_entity_id,
  s.parent_name,
  s.match_tier
FROM public.v_lcc_buyer_spe_entities s
JOIN public.entities e ON e.id = s.entity_id
WHERE s.match_tier <> 'parent_self'
ORDER BY s.entity_id,
  CASE s.match_tier
    WHEN 'domain_true_owner'   THEN 0
    WHEN 'prefix'              THEN 1
    WHEN 'empirical_portfolio' THEN 2
    ELSE 3 END;

-- ---------------------------------------------------------------------------
-- 6. Per-entity resolution state — inspectable; drives P0.4 + UI truthfulness.
--    resolution_complete = connected (SF Account identity OR a linked person/
--    contact relationship). Buyer SPEs leave the band entirely via the views
--    above, so for the P0.4/P0.5 split the entity-level connection IS the gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_entity_resolution_state
WITH (security_invoker = true) AS
SELECT
  e.id   AS entity_id,
  e.name AS entity_name,
  e.domain,
  bp.parent_entity_id AS resolves_to_parent_id,
  bp.parent_name      AS resolves_to_parent_name,
  bp.match_tier       AS resolution_tier,
  tof.true_owner_name,
  tof.developer_name,
  conn.is_connected,
  conn.connection_kind,
  conn.is_connected AS resolution_complete,
  CASE
    WHEN conn.is_connected THEN 'connected'
    WHEN bp.parent_entity_id IS NOT NULL THEN 'resolves_to_parent_connect_parent'
    WHEN tof.true_owner_name IS NOT NULL
         AND lower(tof.true_owner_name) <> lower(e.name)
      THEN 'true_owner_known_connect'
    WHEN public.lcc_is_spe_shell_name(e.name)
      THEN 'recorded_owner_shell_true_owner_unresolved'
    ELSE 'owner_known_connect'
  END AS resolve_reason
FROM public.entities e
LEFT JOIN LATERAL (
  SELECT * FROM public.lcc_resolve_buyer_parent(e.id) LIMIT 1
) bp ON true
LEFT JOIN LATERAL (
  SELECT pof.true_owner_name, pof.developer_name
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.lcc_property_owner_facts pof
    ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
  WHERE pf.entity_id = e.id AND pf.is_current = true
  ORDER BY pf.ownership_start_date DESC NULLS LAST LIMIT 1
) tof ON true
LEFT JOIN LATERAL (
  SELECT
    (sf.has_sf OR pr.has_person) AS is_connected,
    CASE WHEN sf.has_sf AND pr.has_person THEN 'sf+contact'
         WHEN sf.has_sf THEN 'salesforce'
         WHEN pr.has_person THEN 'contact'
         ELSE NULL END AS connection_kind
  FROM (SELECT EXISTS (
          SELECT 1 FROM public.external_identities ei
          WHERE ei.entity_id = e.id AND ei.source_system = 'salesforce') AS has_sf) sf,
       (SELECT EXISTS (
          SELECT 1 FROM public.entity_relationships er
          JOIN public.entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'
          WHERE er.from_entity_id = e.id)
        OR EXISTS (
          SELECT 1 FROM public.entity_relationships er
          JOIN public.entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'
          WHERE er.to_entity_id = e.id) AS has_person) pr
) conn ON true
WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL;

GRANT SELECT ON public.v_lcc_entity_resolution_state TO authenticated;

COMMIT;
