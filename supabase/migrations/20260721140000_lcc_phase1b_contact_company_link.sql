-- Phase 1b — connect owners to people via company resolution.
-- ----------------------------------------------------------------------------
-- Phase 1a exact-key backfilled `unified_contacts.entity_id` (person entities,
-- all 1:1) but set NO edges. The entity graph is untouched — owners-with-a-person
-- is 93 of 15,257 owner orgs. This view resolves each entity-linked person
-- contact's `company_name` to the owner ORG(s) it names, so the worker can attach
-- a person->org edge (and the fuzzy/ambiguous tier can be reviewed).
--
-- Owner org = organization entity carrying a `true_owner` external identity, not
-- tombstoned (the task's definition), minus junk-name-flagged (never a valid
-- target). Person contact = a live person entity linked from unified_contacts
-- carrying a non-empty company_name.
--
-- match_class (one row per contact that has >=1 unlinked candidate owner):
--   * exact_unique     — the strict DENSE-alnum core (lower, [^a-z0-9] stripped,
--                        len>=6, suffixes KEPT so "Excelsior Capital" !=
--                        "Excelsior Partners") maps to EXACTLY ONE owner org IN
--                        THE WHOLE OWNER UNIVERSE (n_orgs_total = 1). Safe to
--                        auto-apply.
--   * exact_ambiguous  — the dense core maps to >1 owner org (n_orgs_total > 1)
--                        -> human picks (never a guess).
--   * fuzzy            — no exact dense match at all, but the suffix-stripped core
--                        (lcc_normalize_entity_name) shares a DISTINCTIVE whole-
--                        token-prefix core with an owner org -> human reviews
--                        (LLC names are exactly where false positives live).
-- Exact (any) beats fuzzy; already-linked (owner,person) pairs are excluded from
-- the ACTIONABLE candidate set so the surface is idempotent, but the
-- unique/ambiguous CLASS is decided on the full owner universe (a name that maps
-- to 2 owner orgs stays ambiguous even if one is already linked). Reuses the
-- existing `lcc_normalize_entity_name` normalizer (no fourth normalizer); the
-- fuzzy candidate gather is bounded by first-token equality + the distinctive
-- whole-token-prefix rule (mirrors owner-cross-reference.js `namingCoreMatches`,
-- which the JS `link` verdict re-applies verbatim). rank_value mirrors
-- v_owner_contact_worklist.
--
-- SECURITY INVOKER, read-only, additive. Reversible: DROP VIEW -> zero trace.
-- LCC-Opps only; no dia/gov writes.
CREATE OR REPLACE VIEW public.v_lcc_contact_company_link_candidates
WITH (security_invoker = true) AS
WITH owner_org AS (
  -- One row per owner ORG. EXISTS (not a JOIN) — an org carrying >=2 true_owner
  -- identities (the normal steady state, ~43 orgs) must NOT fan out into duplicate
  -- rows (which would double-count a contact in the final join).
  SELECT e.id AS owner_org_id, e.name AS owner_org_name, e.workspace_id AS owner_workspace_id,
         regexp_replace(lower(e.name), '[^a-z0-9]+', '', 'g') AS dense,
         lcc_normalize_entity_name(e.name) AS core_norm,
         COALESCE(NULLIF(pa.current_annual_rent_total, 0), cv.connected_property_value) AS rank_value
  FROM entities e
  LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = e.id
  LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = e.id
  WHERE e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'
    AND COALESCE((e.metadata ->> 'junk_name_flagged')::boolean, false) = false
    AND EXISTS (SELECT 1 FROM external_identities xi
                WHERE xi.entity_id = e.id AND xi.source_type = 'true_owner')
),
dense_count AS (  -- how many distinct owner orgs share each dense core (full universe)
  SELECT dense, count(DISTINCT owner_org_id) AS n
  FROM owner_org WHERE length(dense) >= 6 GROUP BY dense
),
contact AS (
  SELECT uc.unified_id, uc.entity_id AS person_entity_id, uc.company_name, pe.name AS person_name,
         regexp_replace(lower(uc.company_name), '[^a-z0-9]+', '', 'g') AS dense_co,
         lcc_normalize_entity_name(uc.company_name) AS core_norm_co
  FROM unified_contacts uc
  JOIN entities pe ON pe.id = uc.entity_id AND pe.entity_type = 'person' AND pe.merged_into_entity_id IS NULL
  WHERE NULLIF(btrim(uc.company_name), '') IS NOT NULL
),
-- all exact (dense-equal) pairs, with the full-universe owner count + linked flag.
exact_match AS (
  SELECT c.unified_id, c.person_entity_id, c.company_name,
         o.owner_org_id, o.owner_org_name, o.owner_workspace_id, o.rank_value,
         dc.n AS n_orgs_total,
         EXISTS (SELECT 1 FROM entity_relationships er
           WHERE er.relationship_type IN ('associated_with','contact_at','works_at')
             AND ((er.from_entity_id = o.owner_org_id AND er.to_entity_id = c.person_entity_id)
               OR (er.from_entity_id = c.person_entity_id AND er.to_entity_id = o.owner_org_id))) AS already_linked
  FROM contact c
  JOIN owner_org o ON o.dense = c.dense_co AND length(c.dense_co) >= 6
  JOIN dense_count dc ON dc.dense = c.dense_co
),
exact_agg AS (  -- actionable = unlinked candidate owners
  SELECT unified_id, max(n_orgs_total) AS n_orgs_total, count(*) AS n_actionable,
         (array_agg(owner_org_id ORDER BY rank_value DESC NULLS LAST, owner_org_id))[1] AS best_owner_id,
         jsonb_agg(DISTINCT jsonb_build_object('owner_org_id',owner_org_id,'owner_org_name',owner_org_name,
           'rank_value',rank_value,'match_kind','exact')) AS candidates
  FROM exact_match WHERE NOT already_linked GROUP BY unified_id
),
-- fuzzy only for contacts with NO exact dense match at all (linked or not).
fuzzy_pairs AS (
  SELECT c.unified_id, c.person_entity_id, c.company_name,
         o.owner_org_id, o.owner_org_name, o.owner_workspace_id, o.rank_value,
         CASE WHEN c.core_norm_co = o.core_norm THEN c.core_norm_co
              WHEN o.core_norm LIKE c.core_norm_co || ' %' THEN c.core_norm_co
              WHEN c.core_norm_co LIKE o.core_norm || ' %' THEN o.core_norm ELSE NULL END AS shared_core
  FROM contact c
  JOIN owner_org o ON split_part(o.core_norm,' ',1) = split_part(c.core_norm_co,' ',1)
    AND o.core_norm IS NOT NULL AND c.core_norm_co IS NOT NULL
  WHERE c.unified_id NOT IN (SELECT unified_id FROM exact_match)
    AND NOT EXISTS (SELECT 1 FROM entity_relationships er
      WHERE er.relationship_type IN ('associated_with','contact_at','works_at')
        AND ((er.from_entity_id = o.owner_org_id AND er.to_entity_id = c.person_entity_id)
          OR (er.from_entity_id = c.person_entity_id AND er.to_entity_id = o.owner_org_id)))
),
fuzzy_kept AS (
  SELECT * FROM fuzzy_pairs WHERE shared_core IS NOT NULL
    AND ( array_length(regexp_split_to_array(shared_core,'\s+'),1) >= 2
       OR ( length(shared_core) >= 8 AND shared_core NOT IN (
              'healthcare','national','american','united','global','pacific','western','eastern',
              'northern','southern','atlantic','premier','summit','capital','equity','realty',
              'property','properties','holdings','partners','associates','management','investments',
              'development','enterprises','group','trust','ventures','advisors','financial','commercial',
              'residential','industrial','retail','medical','senior','general','standard','consolidated',
              'integrated','metropolitan','central','liberty','heritage','legacy','community','sterling',
              'pinnacle','horizon','gateway','cornerstone','keystone','landmark','investment','realestate') ) )
),
fuzzy_agg AS (
  SELECT unified_id, count(DISTINCT owner_org_id) AS n_orgs_total, count(DISTINCT owner_org_id) AS n_actionable,
         (array_agg(owner_org_id ORDER BY rank_value DESC NULLS LAST, owner_org_id))[1] AS best_owner_id,
         jsonb_agg(DISTINCT jsonb_build_object('owner_org_id',owner_org_id,'owner_org_name',owner_org_name,
           'rank_value',rank_value,'shared_core',shared_core,'match_kind','fuzzy')) AS candidates
  FROM fuzzy_kept GROUP BY unified_id
),
classified AS (
  SELECT unified_id, n_orgs_total, best_owner_id, candidates,
         CASE WHEN n_orgs_total = 1 THEN 'exact_unique' ELSE 'exact_ambiguous' END AS match_class FROM exact_agg
  UNION ALL
  SELECT unified_id, n_orgs_total, best_owner_id, candidates, 'fuzzy' FROM fuzzy_agg
)
SELECT cl.unified_id, c.person_entity_id, c.person_name, c.company_name, cl.match_class,
       cl.n_orgs_total AS n_candidate_orgs, cl.best_owner_id AS owner_org_id, o.owner_org_name,
       o.owner_workspace_id AS workspace_id, o.rank_value, cl.candidates
FROM classified cl
JOIN contact c ON c.unified_id = cl.unified_id
JOIN owner_org o ON o.owner_org_id = cl.best_owner_id;

GRANT SELECT ON public.v_lcc_contact_company_link_candidates TO anon, authenticated, service_role;
