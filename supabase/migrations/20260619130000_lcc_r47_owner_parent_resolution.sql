-- R47 (2026-06-19): resolve CURRENT owners → ultimate parent.
-- Units 1-3 (DB). The ownership-side analogue of R5's buyer-parent doctrine:
-- we trace UP to the controlling sponsor for the entity that CURRENTLY owns a
-- property (not just the entity that bought in a sale, which is P-BUYER).
--
-- Grounded live 2026-06-19 (lcc_property_owner_facts × lcc_property_attributes):
--   gov 8,862 props w/ owner; ~4,200 LLC/LP/trust-owned UNRESOLVED to a
--   registered parent; ~$2.2B unresolved rent; ~3,400 distinct owner names.
--   dia small (its owner is usually the operator, not an SPE).
--
-- House rules (R5/R6/R46): REUSE lcc_buyer_parents + lcc_operator_affiliate_
-- patterns (don't fork) — a sponsor that buys also holds, so it's the SAME
-- parent. The buyer/operator consumers are NOT touched, so P-BUYER and the
-- operator-effective-portfolio stay byte-identical:
--   * operator views keep relationship='operator' (the R5 rule);
--   * the buyer-SPE views + lcc_resolve_buyer_parent + lcc_match_buyer_parent_
--     by_name keep relationship='buyer_parent' ONLY.
--   * R47 owner-side resolution gets its OWN helper/resolver/views that read
--     relationship IN ('buyer_parent','owner_parent'). A sponsor confirmed as
--     an owner-parent gets a pattern tagged 'owner_parent', so it never leaks
--     into the buyer-SPE / P-BUYER gate.
--
-- Cache-or-live safe: every artifact is NEW and inert until a human confirms a
-- cluster (Unit 3). Empty registry/reviewed ⇒ pre-R47 behavior everywhere.
-- Value-ranked by $ rent; idempotent; reversible; LCC-Opps-only (no domain
-- writes — parent resolution lives on the LCC entity graph).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Widen the relationship discriminator to add 'owner_parent' (widening only,
--    deploy-safe). 'operator' = OPERATOR brand; 'buyer_parent' = repeat-buyer
--    SPE family; 'owner_parent' = repeat current-OWNER SPE family (R47).
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_operator_affiliate_patterns
  DROP CONSTRAINT IF EXISTS chk_affiliate_pattern_relationship;
ALTER TABLE public.lcc_operator_affiliate_patterns
  ADD CONSTRAINT chk_affiliate_pattern_relationship
  CHECK (relationship IN ('operator','buyer_parent','owner_parent'));

COMMENT ON COLUMN public.lcc_operator_affiliate_patterns.relationship IS
  'operator = subsidiary brand of an OPERATOR (DaVita/Fresenius...). '
  'buyer_parent = SPE shell of a repeat BUYER (Boyd Watterson/NGP...). '
  'owner_parent = SPE shell of a repeat current-OWNER sponsor (SPUS/LSREF/'
  'Exeter..., R47). Operator views filter ''operator''; the buyer gate reads '
  '''buyer_parent''; the R47 owner-side resolver reads both buyer_parent + '
  'owner_parent (a sponsor that buys also holds).';

-- ===========================================================================
-- UNIT 1 — model the parent/control edge + apply the registry to CURRENT OWNERS
-- ===========================================================================

-- Owner-side name→parent matcher. SEPARATE from lcc_match_buyer_parent_by_name
-- (which stays buyer_parent-only so P-BUYER is byte-identical). Reads BOTH
-- buyer_parent + owner_parent patterns — the same sponsor is one parent whether
-- it buys or holds. Prefers exact > prefix > contains, then the LONGEST pattern
-- (most specific) so a broad token can't shadow a precise one.
CREATE OR REPLACE FUNCTION public.lcc_match_owner_parent_by_name(p_name text)
RETURNS TABLE(parent_entity_id uuid, parent_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT p.parent_entity_id, pe.name
  FROM public.lcc_operator_affiliate_patterns p
  JOIN public.entities pe ON pe.id = p.parent_entity_id AND pe.merged_into_entity_id IS NULL
  WHERE p.relationship IN ('buyer_parent','owner_parent') AND p_name IS NOT NULL
    AND CASE p.pattern_type
          WHEN 'exact'    THEN lower(p_name) = lower(p.pattern_name)
          WHEN 'prefix'   THEN lower(p_name) LIKE lower(p.pattern_name)
          WHEN 'contains' THEN lower(p_name) LIKE ('%' || lower(p.pattern_name) || '%')
          ELSE false
        END
  ORDER BY CASE p.pattern_type WHEN 'exact' THEN 1 WHEN 'prefix' THEN 2 ELSE 3 END,
           length(p.pattern_name) DESC
  LIMIT 1;
$$;

-- Owner-side resolver. Mirrors lcc_resolve_buyer_parent's (parent_entity_id,
-- parent_name, match_tier) shape. Resolves a current-OWNER entity to its
-- controlling parent: tier-0 = the entity's current property's domain
-- true_owner → registered parent (per-row domain truth, the R6 doctrine);
-- tier-1 = the entity's OWN name → registered parent (an owner SPE entity's
-- name IS the owner string).
CREATE OR REPLACE FUNCTION public.lcc_resolve_owner_parent(p_entity_id uuid)
RETURNS TABLE(parent_entity_id uuid, parent_name text, match_tier text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH t0 AS (
    SELECT m.parent_entity_id, m.parent_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain
     AND pof.source_property_id = pf.source_property_id
    JOIN LATERAL public.lcc_match_owner_parent_by_name(pof.true_owner_name) m ON true
    WHERE pf.entity_id = p_entity_id AND pf.is_current = true
      AND pof.true_owner_name IS NOT NULL
      AND m.parent_entity_id <> p_entity_id
    LIMIT 1
  ),
  t1 AS (
    SELECT m.parent_entity_id, m.parent_name
    FROM public.entities e
    JOIN LATERAL public.lcc_match_owner_parent_by_name(e.name) m ON true
    WHERE e.id = p_entity_id AND m.parent_entity_id <> p_entity_id
    LIMIT 1
  )
  SELECT parent_entity_id, parent_name, 'domain_true_owner'::text FROM t0
  UNION ALL
  SELECT parent_entity_id, parent_name, 'owner_name'::text FROM t1
   WHERE NOT EXISTS (SELECT 1 FROM t0)
  LIMIT 1;
$$;

-- Owner-side rollup: per REGISTERED parent, the set of CURRENTLY-owned
-- properties (resolved via lcc_property_owner_facts.true_owner_name → parent),
-- with count + $ rent. The ownership analogue of v_lcc_buyer_parent_rollup.
-- Empty registry ⇒ zero current_property_count per parent (no regression).
CREATE OR REPLACE VIEW public.v_lcc_owner_parent_effective_portfolio
WITH (security_invoker = true) AS
WITH resolved AS (
  SELECT pof.source_domain, pof.source_property_id,
         m.parent_entity_id, COALESCE(pa.annual_rent, 0) AS rent
  FROM public.lcc_property_owner_facts pof
  JOIN LATERAL public.lcc_match_owner_parent_by_name(pof.true_owner_name) m ON true
  LEFT JOIN public.lcc_property_attributes pa
    ON pa.source_domain = pof.source_domain
   AND pa.source_property_id = pof.source_property_id
  WHERE pof.true_owner_name IS NOT NULL
)
SELECT
  bp.parent_entity_id,
  pe.name   AS parent_name,
  bp.domain AS registry_domain,
  count(r.source_property_id)                                          AS current_property_count,
  COALESCE(sum(r.rent), 0)                                             AS current_annual_rent,
  array_agg(DISTINCT r.source_domain) FILTER (WHERE r.source_property_id IS NOT NULL) AS domains,
  bp.sf_account_id,
  bp.needs_sf_mapping
FROM public.lcc_buyer_parents bp
JOIN public.entities pe ON pe.id = bp.parent_entity_id AND pe.merged_into_entity_id IS NULL
LEFT JOIN resolved r ON r.parent_entity_id = bp.parent_entity_id
GROUP BY bp.parent_entity_id, pe.name, bp.domain, bp.sf_account_id, bp.needs_sf_mapping;

-- ===========================================================================
-- UNIT 2 — cluster-mine candidate sponsors (the free lever)
-- ===========================================================================

-- Single source of truth for the sponsor-cluster TOKEN: leading 2 significant
-- words, stripping leading articles + leading pure-numerics, with trailing
-- digits stripped from the lead word (SPUS6 → spus) so a fund-numeral family
-- collapses to one token. Returns NULL for coincidental/generic prefixes and
-- sub-4-char tokens (never a cluster). IMMUTABLE so the candidate view + the
-- register/match agree exactly.
CREATE OR REPLACE FUNCTION public.lcc_owner_cluster_token(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_words text[]; v_sw text[]; v_first int; i int; v_stem1 text; v_token text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  v_words := string_to_array(btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', ' ', 'g')), ' ');
  IF v_words IS NULL OR array_length(v_words, 1) IS NULL THEN RETURN NULL; END IF;
  v_first := NULL;
  FOR i IN 1 .. array_length(v_words, 1) LOOP
    IF v_words[i] <> '' AND v_words[i] !~ '^[0-9]+$' AND v_words[i] NOT IN ('the','a','an') THEN
      v_first := i; EXIT;
    END IF;
  END LOOP;
  IF v_first IS NULL THEN RETURN NULL; END IF;
  v_sw := v_words[v_first:];
  v_stem1 := regexp_replace(v_sw[1], '[0-9]+$', '');   -- strip trailing digits
  IF length(regexp_replace(v_stem1, '[^a-z]', '', 'g')) >= 4 THEN
    v_token := v_stem1;
  ELSE
    v_token := btrim(v_stem1 || ' ' || COALESCE(v_sw[2], ''));
  END IF;
  -- Coincidental / generic / industry-operator leading words are NOT a sponsor
  -- cluster (dialysis/renal/davita/... are operator/industry words — the dia
  -- owner is usually the OPERATOR, not an SPE).
  IF v_token ~ '^(the|first|new|north|south|east|west|northeast|northwest|southeast|southwest|saint|st|fort|ft|park|main|grand|plaza|route|property|properties|owner|national|american|federal|government|global|one|two|three|four|five|dialysis|renal|davita|fresenius|healthcare|medical)( |$)' THEN
    RETURN NULL;
  END IF;
  IF length(replace(v_token, ' ', '')) < 4 THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$$;

-- Reviewed-cluster ledger (stop-asking, R13 pattern). A confirmed/manually-set/
-- independent cluster is recorded here and excluded from the candidate view
-- going forward. Drop the table → zero trace.
CREATE TABLE IF NOT EXISTS public.lcc_owner_parent_reviewed (
  source_domain    text NOT NULL,
  cluster_token    text NOT NULL,
  disposition      text NOT NULL CHECK (disposition IN ('confirmed','set_manual','independent')),
  parent_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  reviewed_by      uuid,
  reviewed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, cluster_token)
);
COMMENT ON TABLE public.lcc_owner_parent_reviewed IS
  'R47: sponsor-cluster dispositions (confirmed/set_manual/independent). '
  'Excludes the cluster from v_lcc_owner_parent_candidates going forward '
  '(the R13 "stop asking" pattern). mark_independent records the BD fact that '
  'the owner IS its own ultimate parent.';

-- Candidate sponsor clusters over UNRESOLVED LLC/LP/trust owners, grouped by
-- the normalized token, value-ranked by $ rent. confidence: 'high' = a numeral
-- varies across shells sharing the token (fund-numeral family: SPUS6/7/8,
-- LSREF2/4, "… IV/V"); 'review' = a distinctive token shared by ≥2 shells with
-- no numeral signal (human-confirm). NEVER auto-confirmed.
CREATE OR REPLACE VIEW public.v_lcc_owner_parent_candidates
WITH (security_invoker = true) AS
WITH base AS (
  SELECT pof.source_domain, pof.source_property_id, pof.true_owner_name,
         COALESCE(pa.annual_rent, 0) AS rent,
         public.lcc_owner_cluster_token(pof.true_owner_name) AS token,
         string_to_array(btrim(regexp_replace(lower(pof.true_owner_name), '[^a-z0-9]+', ' ', 'g')), ' ') AS words
  FROM public.lcc_property_owner_facts pof
  LEFT JOIN public.lcc_property_attributes pa
    ON pa.source_domain = pof.source_domain
   AND pa.source_property_id = pof.source_property_id
  WHERE pof.true_owner_name IS NOT NULL
    AND pof.true_owner_name ~* '\m(LLC|L\.L\.C|LP|L\.P|LLP|TRUST|FUND|HOLDINGS?|PARTNERS|LTD|INC|CORP)\M'
),
unres AS (
  SELECT b.*,
    NULLIF(regexp_replace(
      (SELECT w FROM unnest(b.words) WITH ORDINALITY t(w, o)
        WHERE w <> '' AND w !~ '^[0-9]+$' AND w NOT IN ('the','a','an')
        ORDER BY o LIMIT 1),
      '[^0-9]', '', 'g'), '') AS lead_num,
    (SELECT string_agg(w, '|' ORDER BY w) FROM unnest(b.words) w
       WHERE w ~ '^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$') AS roman_val
  FROM base b
  LEFT JOIN LATERAL public.lcc_match_owner_parent_by_name(b.true_owner_name) m ON true
  WHERE b.token IS NOT NULL AND m.parent_entity_id IS NULL
    -- Exclude owners that resolve to a registered OPERATOR (DaVita/Fresenius/
    -- US Renal/...): their SPE-like names are operator facilities, not a sponsor
    -- SPE family. (The dia owner is usually the operator — audit doctrine.)
    AND NOT EXISTS (
      SELECT 1 FROM public.lcc_operator_affiliate_patterns op
      WHERE op.relationship = 'operator'
        AND CASE op.pattern_type
              WHEN 'exact'    THEN lower(b.true_owner_name) = lower(op.pattern_name)
              WHEN 'prefix'   THEN lower(b.true_owner_name) LIKE lower(op.pattern_name)
              WHEN 'contains' THEN lower(b.true_owner_name) LIKE ('%' || lower(op.pattern_name) || '%')
              ELSE false
            END
    )
),
clustered AS (
  SELECT source_domain, token,
    count(DISTINCT lower(true_owner_name)) AS shells,
    count(*)            AS props,
    sum(rent)           AS annual_rent,
    count(DISTINCT lead_num)                                       AS distinct_lead_numerals,
    count(DISTINCT roman_val) FILTER (WHERE roman_val IS NOT NULL) AS distinct_romans,
    (array_agg(DISTINCT true_owner_name ORDER BY true_owner_name))[1:6] AS sample_owner_names
  FROM unres
  GROUP BY source_domain, token
  HAVING count(DISTINCT lower(true_owner_name)) >= 2
)
SELECT
  c.source_domain, c.token AS cluster_token,
  c.shells, c.props, c.annual_rent, c.sample_owner_names,
  (c.distinct_lead_numerals >= 2 OR c.distinct_romans >= 2) AS is_numeral_family,
  CASE WHEN (c.distinct_lead_numerals >= 2 OR c.distinct_romans >= 2) THEN 'high' ELSE 'review' END AS confidence,
  initcap(c.token) AS suggested_parent_name
FROM clustered c
LEFT JOIN public.lcc_owner_parent_reviewed rv
  ON rv.source_domain = c.source_domain AND rv.cluster_token = c.token
WHERE rv.cluster_token IS NULL
ORDER BY c.annual_rent DESC NULLS LAST, c.shells DESC;

-- ===========================================================================
-- UNIT 3 — confirm verdict machinery (the Decision Center lane is in api/admin.js)
-- ===========================================================================

-- Register a confirmed/manually-set sponsor: resolve/create the parent entity,
-- register it in lcc_buyer_parents (the SHARED parent registry), add an
-- owner_parent cluster-token pattern (so the resolver + rollup pick up the
-- member shells), and record the reviewed disposition. Idempotent + reversible.
CREATE OR REPLACE FUNCTION public.lcc_register_owner_parent(
  p_domain         text,
  p_cluster_token  text,
  p_parent_name    text DEFAULT NULL,
  p_disposition    text DEFAULT 'confirmed',
  p_workspace      uuid DEFAULT NULL,
  p_actor          uuid DEFAULT NULL)
RETURNS TABLE(out_parent_entity_id uuid, out_parent_name text,
              out_needs_sf_mapping boolean, out_pattern text, out_matched_shells int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ws uuid; v_parent uuid; v_name text; v_pat text;
  v_sf text; v_sfname text; v_needs boolean := true; v_shells int := 0;
  v_disp text;
BEGIN
  IF p_cluster_token IS NULL OR length(btrim(p_cluster_token)) = 0 THEN
    RAISE EXCEPTION 'cluster_token required';
  END IF;
  v_disp := CASE WHEN p_disposition = 'set_manual' THEN 'set_manual' ELSE 'confirmed' END;
  v_name := NULLIF(btrim(COALESCE(p_parent_name, initcap(p_cluster_token))), '');

  v_ws := p_workspace;
  IF v_ws IS NULL THEN
    SELECT workspace_id INTO v_ws FROM public.entities
     WHERE entity_type = 'organization' AND merged_into_entity_id IS NULL
     GROUP BY workspace_id ORDER BY count(*) DESC LIMIT 1;
  END IF;

  -- Resolve the cleanest existing org by name, else create one (R5 path).
  SELECT e.id INTO v_parent
  FROM public.entities e
  LEFT JOIN (SELECT entity_id, count(*) c FROM public.lcc_entity_portfolio_facts GROUP BY 1) pf
    ON pf.entity_id = e.id
  WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
    AND lower(e.name) = lower(v_name)
  ORDER BY COALESCE(pf.c, 0) DESC, e.created_at ASC
  LIMIT 1;

  IF v_parent IS NULL THEN
    INSERT INTO public.entities
      (workspace_id, entity_type, name, canonical_name, domain,
       owner_role, owner_role_source, developer_flag_sources, metadata)
    VALUES
      (v_ws, 'organization', v_name, lower(btrim(v_name)), p_domain,
       'buyer', 'manual', '[]'::jsonb,
       jsonb_build_object('owner_parent', true, 'seeded_by', 'R47'))
    RETURNING id INTO v_parent;
  END IF;

  -- Prefill SF account from an existing identity on the parent.
  SELECT ei.external_id, e.name INTO v_sf, v_sfname
  FROM public.external_identities ei
  JOIN public.entities e ON e.id = ei.entity_id
  WHERE ei.entity_id = v_parent AND ei.source_system = 'salesforce' AND ei.source_type = 'Account'
  ORDER BY ei.created_at ASC LIMIT 1;
  v_needs := (v_sf IS NULL);

  -- Shared parent registry. Don't clobber a pre-existing mapping.
  INSERT INTO public.lcc_buyer_parents
    (parent_entity_id, domain, sf_account_id, sf_account_name, needs_sf_mapping, notes)
  VALUES (v_parent, p_domain, v_sf, v_sfname, v_needs, 'R47 owner-parent')
  ON CONFLICT (parent_entity_id) DO UPDATE
    SET sf_account_id   = COALESCE(public.lcc_buyer_parents.sf_account_id, EXCLUDED.sf_account_id),
        sf_account_name = COALESCE(public.lcc_buyer_parents.sf_account_name, EXCLUDED.sf_account_name),
        updated_at      = now();
  SELECT bp.needs_sf_mapping INTO v_needs FROM public.lcc_buyer_parents bp WHERE bp.parent_entity_id = v_parent;

  -- Owner-parent cluster pattern (NOT buyer_parent → never enters P-BUYER).
  v_pat := lower(btrim(p_cluster_token)) || '%';
  INSERT INTO public.lcc_operator_affiliate_patterns
    (parent_entity_id, pattern_name, pattern_type, relationship, notes)
  VALUES (v_parent, v_pat, 'prefix', 'owner_parent', 'R47 owner-parent cluster')
  ON CONFLICT (parent_entity_id, pattern_name, pattern_type) DO NOTHING;

  SELECT count(DISTINCT lower(pof.true_owner_name)) INTO v_shells
  FROM public.lcc_property_owner_facts pof
  WHERE pof.source_domain = p_domain AND pof.true_owner_name IS NOT NULL
    AND lower(pof.true_owner_name) LIKE v_pat;

  INSERT INTO public.lcc_owner_parent_reviewed
    (source_domain, cluster_token, disposition, parent_entity_id, reviewed_by)
  VALUES (p_domain, lower(btrim(p_cluster_token)), v_disp, v_parent, p_actor)
  ON CONFLICT (source_domain, cluster_token) DO UPDATE
    SET disposition = EXCLUDED.disposition, parent_entity_id = EXCLUDED.parent_entity_id,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now();

  RETURN QUERY SELECT v_parent, v_name, v_needs, v_pat, v_shells;
END;
$$;

-- mark_independent: record the BD fact that the owner is its own ultimate
-- parent + stop re-asking. No registry write.
CREATE OR REPLACE FUNCTION public.lcc_mark_owner_independent(
  p_domain text, p_cluster_token text, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.lcc_owner_parent_reviewed
    (source_domain, cluster_token, disposition, parent_entity_id, reviewed_by)
  VALUES (p_domain, lower(btrim(p_cluster_token)), 'independent', NULL, p_actor)
  ON CONFLICT (source_domain, cluster_token) DO UPDATE
    SET disposition = 'independent', parent_entity_id = NULL,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Grants. The owner-side reads are authenticated-safe (views are
-- security_invoker; the SECURITY DEFINER helpers they call need EXECUTE). The
-- register/mark/independent writers are service-role only (the admin path).
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.v_lcc_owner_parent_effective_portfolio,
                public.v_lcc_owner_parent_candidates,
                public.lcc_owner_parent_reviewed TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_owner_cluster_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_match_owner_parent_by_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_resolve_owner_parent(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.lcc_register_owner_parent(text,text,text,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_mark_owner_independent(text,text,uuid) FROM PUBLIC;

COMMIT;
