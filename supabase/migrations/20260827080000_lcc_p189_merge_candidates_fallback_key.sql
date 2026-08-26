-- P189 step 2 — give the duplicate-entity detector a FALLBACK GROUPING KEY, so it stops being
-- structurally blind to 1,089 live organisations carrying $185.1M of current annual rent.
--
-- THE DEFECT (P189 step 1 made it visible; this closes it):
--   `v_lcc_merge_candidates` filters `WHERE norm_name IS NOT NULL`. `lcc_normalize_entity_name()`
--   strips group/partners/capital/holdings/company/trust ON TOP OF legal forms, so an
--   acronym-named firm has nothing left and normalizes to NULL. Those rows were never in the
--   view at all -- RMR Group, GI Partners, AVG Partners, NGP Capital, MMI Capital.
--   Playbook Class 11: the zero was the instrument, not a finding.
--
-- THE FIX: fall back to `lcc_owner_domain_core()` (P187, order-preserving) for exactly that
--   population, namespaced `dc:<core>` so a fallback key can NEVER collide with a norm_name key
--   (lcc_normalize_entity_name strips punctuation, so it can never emit a colon).
--
-- ⚠️ WHY THIS CANNOT DISTURB THE 3,053 AUTO-MERGEABLE GROUPS -- measured, not asserted:
--   the blind population is **1,089 rows, ALL of them norm_name IS NULL and ZERO of them the
--   empty string** (verified live 2026-08-26). They are therefore EXACTLY the set the old
--   `WHERE norm_name IS NOT NULL` filter excluded, and are DISJOINT from every existing group.
--   No existing group's key, membership, winner or auto_mergeable value can change, because no
--   existing group gains or loses a member. The migration foot asserts this as a hard gate.
--
-- ⚠️ AND FALLBACK GROUPS ARE FORCED `auto_mergeable = false`, ALWAYS.
--   `lcc_apply_fuzzy_merges()` loops `WHERE auto_mergeable = true` and calls `lcc_merge_entity`
--   on every loser. Admitting a new population to a DESTRUCTIVE path on a grouping key nobody
--   has graded would be indefensible. `lcc_owner_domain_core` is a GROUPING key here, never an
--   IDENTITY key -- grouping-for-review and identity-for-write are different jobs (CLAUDE.md:
--   "Century Park Partners" == "Century Park Properties LLC" under the normalizer). Every one of
--   these is human-confirmed, and the merge itself still goes through `lcc_merge_entity` (P160
--   backref repoints, P153 cycle guard, tombstone-survivor resolution) -- never by hand.
--
-- ⚠️ THE `>= 5` CORE-LENGTH FLOOR IS DELIBERATELY THE SAME NUMBER AS
--   `v_lcc_merge_candidates_normalizer_blind`. Two definitions of one population is the
--   normaliser drift this repo keeps getting bitten by. It costs us the bare "RMR" entity
--   (core `rmr`, 3 chars); "RMR Group" x5 still groups, which is the §4 verification target.
--
-- ⚠️ A SECOND BLIND SPOT IS **NOT** CLOSED HERE, AND THE OBVIOUS FIX WAS MEASURED AND REJECTED.
--   A wording difference defeats the normalizer even when it returns a value (Easterly ->
--   `easterly gov reit` vs `easterly government`). Prompt 189 proposed grouping on the shared
--   Tier 0 bench email domain instead. Graded live over every same-domain owner pair, gated on
--   `NOT lcc_is_spe_shell_name` + strict-core containment or a shared 8-char opening:
--     net-new pairs the detector cannot already see:  **4**
--     of which genuine duplicates:                    **1**  (Easterly Gov Properties (REIT)
--                                                             <> Easterly Government Properties)
--     of which sponsor<->SPE or SPE<->SPE:            **3**  (Woodbranch Management <> Woodbranch
--                                                             Lafayette VA LLC; CENTENNIAL CAMPUS
--                                                             PROPERTY <> Centennial Bay;
--                                                             UIRC-GSA V Douglas <> V VAN HORN)
--     plus 13 further NGP sponsor<->SPE pairs (NGP <> NGP VI PHOENIX AZ LLC, ...), zero of them
--     duplicates.
--   **25% precision. A domain-keyed duplicate view would be a noise generator**, which is the
--   Consumption-Layer failure this repo names explicitly (a badge that is mostly noise trains
--   the operator to ignore the surface). The domain IS shared -- because an SPE family shares
--   its sponsor's domain. That is the P190/P193 sponsor->SPE relationship, already modelled; it
--   is real evidence answering a DIFFERENT question, the P188 "Gary George" shape. The one true
--   positive is a single named pair and belongs in the lane as one proposal, not behind a view.
--
-- REVERSAL: re-run the prior body from 20260630120000_lcc_merge_sf_corroborated_pinned_widen.sql
--   (this view writes nothing; it is a read surface).

CREATE OR REPLACE VIEW public.v_lcc_merge_candidates AS
WITH normalized AS (
  SELECT e.id, e.name, e.canonical_name, e.owner_role, e.owner_role_confidence, e.domain,
         lcc_normalize_entity_name(e.name) AS norm_name,
         lcc_owner_domain_core(e.name)     AS domain_core,
         (SELECT count(*) FROM lcc_entity_portfolio_facts f WHERE f.entity_id = e.id) AS portfolio_size
  FROM entities e
  WHERE e.entity_type = 'organization'::entity_type
    AND e.merged_into_entity_id IS NULL
    AND e.name IS NOT NULL
), qualifying AS (
  SELECT n.*,
         -- existing rows keep their EXACT key; only the previously-excluded NULL population
         -- gets a namespaced fallback key, so the two can never collide.
         CASE WHEN n.norm_name IS NOT NULL THEN n.norm_name
              ELSE 'dc:' || n.domain_core END AS group_key,
         (n.norm_name IS NULL)                AS via_fallback
  FROM normalized n
  WHERE n.norm_name IS NOT NULL
     OR length(n.domain_core) >= 5
), groups AS (
  SELECT q.group_key,
         array_agg(q.id ORDER BY (CASE q.owner_role WHEN 'developer' THEN 1 WHEN 'operator' THEN 2
                                                    WHEN 'user_owner' THEN 3 WHEN 'buyer' THEN 4
                                                    ELSE 5 END),
                                 q.portfolio_size DESC, length(q.name) DESC, q.id) AS member_ids_winner_first,
         array_agg(q.name ORDER BY (CASE q.owner_role WHEN 'developer' THEN 1 WHEN 'operator' THEN 2
                                                      WHEN 'user_owner' THEN 3 WHEN 'buyer' THEN 4
                                                      ELSE 5 END),
                                   q.portfolio_size DESC, length(q.name) DESC, q.id) AS member_names_winner_first,
         array_agg(DISTINCT q.domain) FILTER (WHERE q.domain IS NOT NULL) AS domains,
         count(*) AS member_count,
         max(CASE q.owner_role WHEN 'developer' THEN 4 WHEN 'operator' THEN 3
                               WHEN 'user_owner' THEN 2 WHEN 'buyer' THEN 1 ELSE 0 END) AS best_role_score,
         bool_or(q.via_fallback) AS via_fallback
  FROM qualifying q
  GROUP BY q.group_key
  HAVING count(*) >= 2
), scored AS (
  SELECT g.*,
    (SELECT count(*) FROM unnest(g.member_ids_winner_first) mid
      WHERE EXISTS (SELECT 1 FROM external_identities x
                     WHERE x.entity_id = mid AND x.source_system='salesforce' AND x.source_type='Account')) AS sf_linked_member_count,
    (SELECT count(*) FROM unnest(g.member_ids_winner_first) mid
      WHERE NOT EXISTS (SELECT 1 FROM external_identities x
                         WHERE x.entity_id = mid AND x.source_system='salesforce')) AS non_sf_member_count,
    (SELECT count(DISTINCT x.external_id)::integer FROM unnest(g.member_ids_winner_first) mid
       JOIN external_identities x ON x.entity_id = mid AND x.source_system='salesforce' AND x.source_type='Account') AS distinct_sf_accounts,
    EXISTS (SELECT 1 FROM entities pe
             WHERE pe.id = ANY (g.member_ids_winner_first) AND pe.owner_role='unknown'
               AND (pe.metadata ->> 'bridge_source') = 'connectivity_inuse_owner') AS pinned,
    NOT EXISTS (SELECT 1 FROM unnest(g.member_names_winner_first[2:]) ln
                 WHERE NOT lcc_name_pair_compatible(g.member_names_winner_first[1], ln)) AS raw_name_compatible,
    (SELECT min(similarity(lcc_clean_name_for_sim(g.member_names_winner_first[1]), lcc_clean_name_for_sim(ln)))
       FROM unnest(g.member_names_winner_first[2:]) ln) AS min_loser_sim
  FROM groups g
)
SELECT group_key AS norm_name,
       member_ids_winner_first[1]   AS winner_id,
       member_names_winner_first[1] AS winner_name,
       member_ids_winner_first[2:]  AS loser_ids,
       member_names_winner_first[2:] AS loser_names,
       member_count,
       domains,
       best_role_score,
       -- a fallback-keyed group is NEVER auto-mergeable: lcc_apply_fuzzy_merges() consumes this
       -- flag destructively, and this grouping key has not been graded for identity.
       NOT via_fallback
         AND (raw_name_compatible
              AND (NOT pinned AND (best_role_score >= 1
                                   OR sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1)
                   OR pinned AND distinct_sf_accounts = 1)) AS auto_mergeable,
       sf_linked_member_count,
       sf_linked_member_count > 0 AND non_sf_member_count > 0 AS sf_inheritance,
       raw_name_compatible,
       round(min_loser_sim::numeric, 3) AS min_loser_sim,
       distinct_sf_accounts,
       CASE
         WHEN via_fallback THEN 'normalizer_blind_review_only'
         WHEN raw_name_compatible
              AND (NOT pinned AND (best_role_score >= 1
                                   OR sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1)
                   OR pinned AND distinct_sf_accounts = 1) THEN NULL::text
         WHEN pinned THEN 'bridged_unknown_pinned'
         WHEN NOT raw_name_compatible THEN 'low_name_similarity'
         WHEN sf_linked_member_count >= 1 AND distinct_sf_accounts >= 2 THEN 'multiple_sf_accounts'
         WHEN best_role_score = 0 AND sf_linked_member_count = 0 THEN 'no_role_or_sf_signal'
         ELSE 'review'
       END AS review_reason,
       -- appended LAST (CREATE OR REPLACE VIEW is append-only for columns)
       CASE WHEN via_fallback THEN 'domain_core_fallback' ELSE 'normalized' END AS group_basis
FROM scored;

GRANT SELECT ON public.v_lcc_merge_candidates TO authenticated;

COMMENT ON VIEW public.v_lcc_merge_candidates IS
  'Duplicate-organisation candidate groups. Grouped by lcc_normalize_entity_name(); P189 adds a '
  'namespaced ''dc:<lcc_owner_domain_core>'' FALLBACK key for the 1,089 live orgs that normalizer '
  'returns NULL for (RMR Group, GI Partners, AVG Partners, NGP Capital) -- previously invisible to '
  'this view entirely. Read group_basis to tell them apart. A fallback-keyed group is ALWAYS '
  'auto_mergeable=false (review_reason=''normalizer_blind_review_only'') because '
  'lcc_apply_fuzzy_merges() consumes auto_mergeable destructively and the fallback key is a '
  'GROUPING key, not an identity key. Every merge is human-confirmed and goes through '
  'lcc_merge_entity.';
