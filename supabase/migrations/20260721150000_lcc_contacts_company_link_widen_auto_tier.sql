-- ============================================================================
-- Contact→company link: widen the safe auto-tier with an ITERATIVE name-core
-- normalizer + fire the consumer (2026-07-21)
-- LCC Opps · additive · reversible · append-only VIEW change
-- ----------------------------------------------------------------------------
-- Phase 1b (20260721140000) auto-applies only the exact_unique tier (DENSE core,
-- suffixes KEPT), so the ~634 single-candidate rows that failed dense equality
-- ONLY on a legal suffix / a leading "The" / a parenthetical / a `|` dual
-- affiliation landed in the review lane instead of auto-linking:
--   Blake Real Estate ↔ Blake Real Estate Inc
--   Xenia Management Corp ↔ Xenia Management
--   Kingsbarn Realty Capital ↔ Kingsbarn Realty
--   Claremont Group Llc | Brewran Islip ↔ The Claremont Group
--   HC Government Realty Trust Inc ↔ HC Government Realty Trust
--
-- This migration:
--   1. Adds an AGGRESSIVE mode to the EXISTING normalizer (a 2-arg overload of
--      lcc_normalize_entity_name — NOT a fifth normalizer). It ITERATIVELY strips
--      trailing descriptor tokens until stable (a single-pass strip stalls at
--      "claremontgroup" and never reaches "claremont" — the loop is mandatory),
--      plus parenthetical removal, `|` dual-affiliation split, a leading "the",
--      then a dense collapse. A thin JS mirror (aggressiveCompanyCore in
--      api/_shared/contacts-company-link.js) is kept in lockstep by
--      test/contacts-company-link.test.mjs (SQL↔JS agreement on a fixture list),
--      so the SQL view and the JS resolver can never drift.
--   2. Appends an `auto_appliable` column to v_lcc_contact_company_link_candidates:
--      n_candidate_orgs = 1  (the existing single-candidate ambiguity gate — this
--      is what keeps it safe; the multi-candidate "Cambridge Holdings" rows never
--      enter this tier) AND aggressive-core equality between company_name and
--      owner_org_name AND core length ≥ 4 (the measured-safe floor) AND the person
--      guards still pass. The worker (and the backlog drain) apply this set.
--   3. Registers the missing CONSUMER cron so the auto-tier fires on arrival
--      instead of accumulating in the lane (the account backfill produced data
--      without a scheduled consumer — this fixes the mechanism, not just the
--      backlog).
--
-- False-positive verification (live 2026-07-21): every auto-appliable pair across
-- the full 4–9 char core range was inspected — ZERO cross-firm collisions; each
-- collapse is the SAME firm with descriptor noise removed. The n_candidate_orgs=1
-- gate + the descriptor-only strip make it safe.
--
-- Reversible: DROP the 2-arg function, re-create the prior view body (append-only,
-- so just drop the auto_appliable column), unschedule the cron → zero trace.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lcc_normalize_entity_name(text, boolean) — the AGGRESSIVE mode overload.
--    p_aggressive=false delegates to the untouched 1-arg normalizer, so every
--    existing consumer is unaffected. p_aggressive=true is the descriptor-core
--    used ONLY by the contact→company-link auto tier (gated by n=1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_normalize_entity_name(p_name text, p_aggressive boolean)
RETURNS text AS $$
DECLARE
  v    text;
  prev text;
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT p_aggressive THEN
    RETURN public.lcc_normalize_entity_name(p_name);   -- the untouched 1-arg
  END IF;
  v := lower(p_name);
  v := regexp_replace(v, '\([^)]*\)', ' ', 'g');        -- drop parentheticals
  v := split_part(v, '|', 1);                            -- keep before the first `|`
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');        -- separators -> single space
  v := btrim(v);
  v := regexp_replace(v, '^the\s+', '');                 -- leading "the"
  -- Iterative trailing descriptor strip: repeat until the string stops changing.
  -- A single trailing token per pass would stall ("claremont group llc" ->
  -- "claremont group" and stop), so the loop is required. "real estate" is a
  -- two-word descriptor, stripped as a phrase.
  LOOP
    prev := v;
    v := regexp_replace(v, '\s+real\s+estate$', '');
    v := regexp_replace(v,
      '\s+(inc|llc|lp|llp|ltd|corp|corporation|company|co|trust|group|holdings|partners|properties|props|realty|management|mgmt|associates|enterprises|capital|development|developers)$',
      '');
    v := btrim(v);
    EXIT WHEN v = prev;
  END LOOP;
  RETURN regexp_replace(v, '[^a-z0-9]+', '', 'g');       -- dense core
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION public.lcc_normalize_entity_name(text, boolean) IS
  'Aggressive descriptor-core mode of lcc_normalize_entity_name (2026-07-21). '
  'p_aggressive=true: parenthetical removal + before-first-pipe + leading "the" + '
  'ITERATIVE trailing descriptor strip + dense collapse. Used ONLY by the '
  'contact->company-link auto tier (gated by n_candidate_orgs=1). JS mirror: '
  'aggressiveCompanyCore in api/_shared/contacts-company-link.js. '
  'p_aggressive=false delegates to the untouched 1-arg normalizer.';

-- ---------------------------------------------------------------------------
-- 2. v_lcc_contact_company_link_candidates — reproduce the Phase-1b body
--    VERBATIM and APPEND the auto_appliable column (append-only rule).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_contact_company_link_candidates
WITH (security_invoker = true) AS
WITH owner_org AS (
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
dense_count AS (
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
exact_agg AS (
  SELECT unified_id, max(n_orgs_total) AS n_orgs_total, count(*) AS n_actionable,
         (array_agg(owner_org_id ORDER BY rank_value DESC NULLS LAST, owner_org_id))[1] AS best_owner_id,
         jsonb_agg(DISTINCT jsonb_build_object('owner_org_id',owner_org_id,'owner_org_name',owner_org_name,
           'rank_value',rank_value,'match_kind','exact')) AS candidates
  FROM exact_match WHERE NOT already_linked GROUP BY unified_id
),
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
       o.owner_workspace_id AS workspace_id, o.rank_value, cl.candidates,
       -- APPENDED (append-only): the widened safe auto-tier. n=1 (the ambiguity
       -- gate) + aggressive descriptor-core equality + len>=4 + person guards.
       COALESCE(
         cl.n_orgs_total = 1
         AND public.lcc_normalize_entity_name(c.company_name, true) <> ''
         AND public.lcc_normalize_entity_name(c.company_name, true)
             = public.lcc_normalize_entity_name(o.owner_org_name, true)
         AND length(public.lcc_normalize_entity_name(c.company_name, true)) >= 4
         AND public.lcc_looks_like_person(c.person_name)
         AND NOT public.lcc_is_rejected_contact_name(c.person_name),
         false
       ) AS auto_appliable
FROM classified cl
JOIN contact c ON c.unified_id = cl.unified_id
JOIN owner_org o ON o.owner_org_id = cl.best_owner_id;

GRANT SELECT ON public.v_lcc_contact_company_link_candidates TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The missing CONSUMER cron — fire the auto-tier so new contacts match on
--    arrival instead of accumulating (the producer had no scheduled consumer).
--    Gentle daily cadence; the worker is bounded (limit + wall-clock) and
--    idempotent (an applied edge drops the row out of the view).
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('lcc-contacts-company-link')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-contacts-company-link');

SELECT cron.schedule(
  'lcc-contacts-company-link',
  '27 4 * * *',  -- daily 04:27 UTC (off-peak, away from the 05:xx sync train)
  $$SELECT public.lcc_cron_post('/api/contacts-company-link-tick?limit=300','{}'::jsonb,'vercel')$$
);
