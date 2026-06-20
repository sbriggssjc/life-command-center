-- CONTACT-SELECTION Slice 1 (2026-06-20) — LCC Opps. The READ-ONLY candidate
-- bench + active-selection views over the owner-signal mirror
-- (20260620120000_lcc_contactsel_slice1_owner_signal_mirror.sql) plus LCC-native
-- related persons. Implements CONTACT_SELECTION_STANDARD: rank the right
-- decision-maker per owner (signatory > controlling > economic > registered agent
-- > captured) and route contactless owners to the correct enrichment.
--
-- Guards: SQL mirrors of the entity-link.js write-time guards
-- (isJunkEntityName / isImplausiblePersonName / looksLikePersonName /
-- isFederalOwnerAntiPattern + the sidebar operator/footnote filters). These gate
-- the READ-TIME bench; Slice 3 enrichment still mints through ensureEntityLink
-- (the JS choke point). All additive / security_invoker / cache-or-live safe —
-- empty mirror => LCC-native signals only (no regression). Drop the two views +
-- three functions -> zero trace.

BEGIN;

-- ---- person detector (looksLikePersonName mirror) ------------------------
CREATE OR REPLACE FUNCTION public.lcc_looks_like_person(p_name text)
RETURNS boolean AS $fn$
DECLARE n text; toks int;
BEGIN
  IF p_name IS NULL THEN RETURN false; END IF;
  n := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
  IF length(n) < 3 OR length(n) > 60 THEN RETURN false; END IF;
  IF n ~ '\d' THEN RETURN false; END IF;
  IF n ~* '[@()]|\$' THEN RETURN false; END IF;
  IF n ~* '\m(LLC|L\.?L\.?C|LP|LLP|LLLP|INC|CORP|CORPORATION|COMPANY|TRUST|FUND|CAPITAL|PARTNERS|MANAGEMENT|MGMT|PROPERTIES|HOLDINGS|GROUP|ASSOCIATES|ENTERPRISES|VENTURES|REALTY|SYSTEMS?|SERVICES?|BANCORP|BANK|NA|PA|PC|LTD|GP|PLLC|FAMILY)\M' THEN
    RETURN false;
  END IF;
  toks := array_length(regexp_split_to_array(n, ' '), 1);
  RETURN toks BETWEEN 2 AND 5;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

-- ---- reject-guard (junk / footnote / CMBS / broker / federal / operator) ----
CREATE OR REPLACE FUNCTION public.lcc_is_rejected_contact_name(p_name text)
RETURNS boolean AS $fn$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN true; END IF;
  n := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
  IF length(n) < 2 THEN RETURN true; END IF;
  IF n ~* '@' OR n ~ '\d{3}[^\d]?\d{3}[^\d]?\d{4}' OR n ~* '\$|\bapprox\b' THEN RETURN true; END IF;
  IF n ~* '^(n/?a|none|null|unknown|tbd|view (more|less)|show (more|less)|see more|see less|same|various|et al\.?)$' THEN RETURN true; END IF;
  IF n ~ '^[\d\W]+$' THEN RETURN true; END IF;
  IF n ~* '\m(CMBS|BBCMS|CGCMT|CSAIL|DBJPM|DBUBS|BMARK|BANK\d|GSMS|GSCMT|JPMCC|JPMBB|WFCM|WFRBS|MSBAM|MSC|UBSCM|CD\d|COMM\s?\d|CFCRE|GMAC|BACM|CCUBS|CMLB|CSFB|COBALT)\M' OR n ~ '\m\d{4}-[A-Z0-9]{1,4}\m' THEN RETURN true; END IF;
  IF n ~* '\mby\M' AND n ~* '\m(NAI|CBRE|JLL|Cushman|Marcus|Colliers|Newmark|Capital|Realty|Brokerage|listing broker)\M' THEN RETURN true; END IF;
  IF n ~* '^(the|this|a|an|it)\M' AND n ~* '\m(was|were|is|are|has|have|verified|confirmed|unavailable|listed|sold|provided)\M'
     AND array_length(regexp_split_to_array(n, ' '), 1) >= 4 THEN RETURN true; END IF;
  IF n ~* '^(u\.?\s?s\.?\s?a\.?|united states.*|us government.*|u s government.*|government of.*|federal government.*|department of.*|gsa)$' THEN RETURN true; END IF;
  IF n ~* '\m(davita|fresenius|us renal( care)?|american renal|satellite healthcare|dialysis clinic inc|dva healthcare|fmc|fresenius medical)\M' THEN RETURN true; END IF;
  RETURN false;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

-- ---- operator-as-owner guard (dia R8 operator-as-true_owner artifact) -------
-- Gate finding 2026-06-20: Fresenius/DaVita/American Renal surface as "owners"
-- with a noisy multi-manager bench + a false partnership. The standard forbids
-- surfacing an operator as an owner contact -> exclude them from the bench.
CREATE OR REPLACE FUNCTION public.lcc_is_operator_owner_name(p_name text)
RETURNS boolean AS $fn$
BEGIN
  IF p_name IS NULL THEN RETURN false; END IF;
  RETURN p_name ~* '\m(davita|fresenius|us renal( care)?|american renal|satellite healthcare|dialysis clinic inc|dva healthcare|innovative renal|atlantic dialysis|fmc|fresenius medical)\M';
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

REVOKE ALL ON FUNCTION public.lcc_looks_like_person(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_is_rejected_contact_name(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_is_operator_owner_name(text)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_looks_like_person(text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_is_rejected_contact_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_is_operator_owner_name(text)   TO authenticated;

-- ---- the candidate bench (one row per candidate human/firm per owner) -------
CREATE OR REPLACE VIEW public.v_owner_contact_candidates
WITH (security_invoker = true) AS
WITH bridged AS (
  SELECT DISTINCT ON (x.source_system, x.external_id)
         x.source_system AS source_domain, x.external_id AS source_true_owner_id,
         e.id AS entity_id, e.name AS owner_name, e.workspace_id
  FROM public.external_identities x
  JOIN public.entities e ON e.id = x.entity_id AND e.merged_into_entity_id IS NULL
  WHERE x.source_type = 'true_owner' AND x.source_system IN ('dia','gov')
    AND NOT public.lcc_is_operator_owner_name(e.name)
  ORDER BY x.source_system, x.external_id, e.created_at NULLS LAST, e.id
),
domain_cand AS (
  SELECT b.entity_id, b.owner_name, b.workspace_id, m.source_domain,
         btrim(c->>'name') AS candidate_name, (c->>'role') AS contact_role,
         (c->>'authority')::int AS authority_level, (c->>'source') AS source,
         COALESCE((c->>'n_props')::int, 1) AS n_props, NULL::uuid AS contact_entity_id
  FROM public.lcc_owner_contact_signals m
  JOIN bridged b ON b.source_domain = m.source_domain AND b.source_true_owner_id = m.source_true_owner_id
  CROSS JOIN LATERAL jsonb_array_elements(m.candidates) c
  WHERE NOT public.lcc_is_rejected_contact_name(c->>'name')
),
native_cand AS (
  SELECT o.entity_id, o.owner_name, o.workspace_id, NULL::text AS source_domain,
         pe.name AS candidate_name, 'captured_person' AS contact_role, 5 AS authority_level,
         'related_person' AS source, 1 AS n_props, pe.id AS contact_entity_id
  FROM (SELECT DISTINCT entity_id, owner_name, workspace_id FROM bridged) o
  JOIN public.entity_relationships er ON (er.from_entity_id = o.entity_id OR er.to_entity_id = o.entity_id)
  JOIN public.entities pe ON pe.id = CASE WHEN er.from_entity_id = o.entity_id THEN er.to_entity_id ELSE er.from_entity_id END
      AND pe.entity_type = 'person' AND pe.merged_into_entity_id IS NULL
  WHERE NOT public.lcc_is_rejected_contact_name(pe.name)
    AND COALESCE((pe.metadata->>'junk_name_flagged')::boolean, false) = false
)
SELECT entity_id, owner_name, workspace_id, source_domain, candidate_name, contact_role,
       authority_level, source, n_props, contact_entity_id,
       public.lcc_looks_like_person(candidate_name) AS is_named_individual
FROM domain_cand
UNION ALL
SELECT entity_id, owner_name, workspace_id, source_domain, candidate_name, contact_role,
       authority_level, source, n_props, contact_entity_id,
       public.lcc_looks_like_person(candidate_name)
FROM native_cand;

GRANT SELECT ON public.v_owner_contact_candidates TO authenticated;
COMMENT ON VIEW public.v_owner_contact_candidates IS
  'CONTACT-SELECTION Slice 1: one row per candidate human/firm per bridged owner '
  'entity, ranked by authority_level (1 signatory > 2 controlling > 3 economic > '
  '4 registered_agent > 5 captured). Sources: owner-signal mirror + LCC-native '
  'related persons. Junk/operator/broker/federal names rejected; operator-owner '
  'entities excluded. Read-only.';

-- ---- the ONE active contact per owner + enrichment routing ------------------
CREATE OR REPLACE VIEW public.v_owner_active_contact
WITH (security_invoker = true) AS
WITH cand AS (SELECT * FROM public.v_owner_contact_candidates),
ranked AS (
  SELECT c.*,
    row_number() OVER (PARTITION BY entity_id ORDER BY
       authority_level ASC, is_named_individual DESC, n_props DESC,
       (source='related_person') DESC, candidate_name) AS rn,
    count(*) OVER (PARTITION BY entity_id) AS bench_size,
    count(*) FILTER (WHERE authority_level=2) OVER (PARTITION BY entity_id) AS n_managers
  FROM cand c
),
bench AS (
  SELECT entity_id,
    jsonb_agg(jsonb_build_object('name',candidate_name,'role',contact_role,
      'authority',authority_level,'source',source,'is_named_individual',is_named_individual,
      'n_props',n_props,'contact_entity_id',contact_entity_id)
      ORDER BY authority_level, is_named_individual DESC, n_props DESC, candidate_name) AS bench
  FROM cand GROUP BY entity_id
),
mirror_owner AS (
  SELECT DISTINCT ON (x.source_system, x.external_id)
         e.id AS entity_id, e.name AS owner_name, e.workspace_id, m.has_reg_address
  FROM public.lcc_owner_contact_signals m
  JOIN public.external_identities x ON x.source_type='true_owner'
       AND x.source_system=m.source_domain AND x.external_id=m.source_true_owner_id
  JOIN public.entities e ON e.id=x.entity_id AND e.merged_into_entity_id IS NULL
  WHERE NOT public.lcc_is_operator_owner_name(e.name)
  ORDER BY x.source_system, x.external_id, e.created_at NULLS LAST, e.id
),
universe AS (
  SELECT entity_id FROM ranked WHERE rn=1
  UNION
  SELECT entity_id FROM mirror_owner
)
SELECT
  u.entity_id, COALESCE(r.owner_name, mo.owner_name) AS owner_name,
  COALESCE(r.workspace_id, mo.workspace_id) AS workspace_id,
  r.candidate_name AS active_contact_name, r.contact_role AS active_contact_role,
  r.authority_level AS active_authority_level, r.source AS active_source,
  r.contact_entity_id AS active_contact_entity_id, r.is_named_individual,
  COALESCE(b.bench, '[]'::jsonb) AS bench, COALESCE(r.bench_size, 0) AS bench_size,
  CASE WHEN r.entity_id IS NULL THEN NULL
       WHEN r.authority_level <= 2 AND r.is_named_individual THEN 'high'
       WHEN r.authority_level <= 3 THEN 'medium' ELSE 'low' END AS confidence,
  ( COALESCE(r.owner_name, mo.owner_name) ~ '&'
    OR COALESCE(r.owner_name, mo.owner_name) ~* '\m(jv|joint venture)\M'
    OR COALESCE(r.n_managers, 0) >= 2 ) AS partnership,
  CASE WHEN r.entity_id IS NOT NULL THEN NULL
       WHEN COALESCE(r.owner_name, mo.owner_name) ~* '\m(LLC|L\.?L\.?C|LP|LLP|LLLP|INC|CORP|CORPORATION|COMPANY|TRUST|HOLDINGS|PARTNERS|GROUP|MANAGEMENT|PROPERTIES|ASSOCIATES|VENTURES|REALTY|PLLC|LTD)\M'
         THEN 'sos_manager_lookup'
       WHEN mo.has_reg_address THEN 'address_reverse_lookup'
       ELSE 'manual_research' END AS enrichment_action
FROM universe u
LEFT JOIN ranked r ON r.entity_id=u.entity_id AND r.rn=1
LEFT JOIN bench  b ON b.entity_id=u.entity_id
LEFT JOIN mirror_owner mo ON mo.entity_id=u.entity_id;

GRANT SELECT ON public.v_owner_active_contact TO authenticated;
COMMENT ON VIEW public.v_owner_active_contact IS
  'CONTACT-SELECTION Slice 1: ONE active contact per bridged owner (top of '
  'v_owner_contact_candidates by authority/named/recurrence) + the full bench. '
  'enrichment_action routes contactless owners (sos_manager_lookup for an LLC, '
  'address_reverse_lookup when a registered/notice address exists, else '
  'manual_research; parse_deed_signatory is Slice 3). partnership flags genuine '
  'multi-principal owners. Read-only.';

COMMIT;
