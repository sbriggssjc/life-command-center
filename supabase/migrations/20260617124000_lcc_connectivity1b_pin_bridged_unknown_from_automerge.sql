-- ===========================================================================
-- CONNECTIVITY #1b — Condition #3: pin freshly-bridged unknown owners OUT of
-- the org auto-merge eligibility
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The conservative drains bridged ~3,900 in-use owners as owner_role='unknown'.
-- v_lcc_merge_candidates.auto_mergeable = (best_role_score >= 1), so a MIXED
-- same-norm_name group (a freshly-bridged unknown + a pre-existing classified
-- twin) is auto_mergeable=true -> lcc_apply_fuzzy_merges merges the unknown LOSER
-- into the classified winner. Scott's directive: don't auto-merge the freshly-
-- bridged owners until the twin-surfacing step + human review.
--
-- v_lcc_merge_candidates.auto_mergeable is the SINGLE eligibility gate both
-- lcc_apply_fuzzy_merges overloads read (WHERE auto_mergeable = true), so pinning
-- it here covers every auto-merge path (manual call OR a future cron). The flag
-- is forced FALSE for any group containing a PROTECTED member —
-- bridge_source='connectivity_inuse_owner' AND owner_role='unknown'. The group
-- STILL LISTS in the lane (auto_mergeable=false rows are visible for manual
-- review) — surfaced, never auto-merged. Once the classified cron enriches a
-- bridged owner to a real archetype (no longer 'unknown'), it re-enters normal
-- auto-merge eligibility automatically.
--
-- CREATE OR REPLACE VIEW: column list/order/type unchanged (only the
-- auto_mergeable expression changes), so the append-only rule is satisfied.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_lcc_merge_candidates AS
 WITH normalized AS (
         SELECT e.id,
            e.name,
            e.canonical_name,
            e.owner_role,
            e.owner_role_confidence,
            e.domain,
            lcc_normalize_entity_name(e.name) AS norm_name,
            ( SELECT count(*) AS count
                   FROM lcc_entity_portfolio_facts f
                  WHERE f.entity_id = e.id) AS portfolio_size
           FROM entities e
          WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.name IS NOT NULL
        ), qualifying AS (
         SELECT normalized.id,
            normalized.name,
            normalized.canonical_name,
            normalized.owner_role,
            normalized.owner_role_confidence,
            normalized.domain,
            normalized.norm_name,
            normalized.portfolio_size
           FROM normalized
          WHERE normalized.norm_name IS NOT NULL
        ), groups AS (
         SELECT qualifying.norm_name,
            array_agg(qualifying.id ORDER BY (
                CASE qualifying.owner_role
                    WHEN 'developer'::text THEN 1
                    WHEN 'operator'::text THEN 2
                    WHEN 'user_owner'::text THEN 3
                    WHEN 'buyer'::text THEN 4
                    ELSE 5
                END), qualifying.portfolio_size DESC, (length(qualifying.name)) DESC, qualifying.id) AS member_ids_winner_first,
            array_agg(qualifying.name ORDER BY (
                CASE qualifying.owner_role
                    WHEN 'developer'::text THEN 1
                    WHEN 'operator'::text THEN 2
                    WHEN 'user_owner'::text THEN 3
                    WHEN 'buyer'::text THEN 4
                    ELSE 5
                END), qualifying.portfolio_size DESC, (length(qualifying.name)) DESC, qualifying.id) AS member_names_winner_first,
            array_agg(DISTINCT qualifying.domain) FILTER (WHERE qualifying.domain IS NOT NULL) AS domains,
            count(*) AS member_count,
            max(
                CASE qualifying.owner_role
                    WHEN 'developer'::text THEN 4
                    WHEN 'operator'::text THEN 3
                    WHEN 'user_owner'::text THEN 2
                    WHEN 'buyer'::text THEN 1
                    ELSE 0
                END) AS best_role_score
           FROM qualifying
          GROUP BY qualifying.norm_name
         HAVING count(*) >= 2
        )
 SELECT norm_name,
    member_ids_winner_first[1] AS winner_id,
    member_names_winner_first[1] AS winner_name,
    member_ids_winner_first[2:] AS loser_ids,
    member_names_winner_first[2:] AS loser_names,
    member_count,
    domains,
    best_role_score,
    -- CONNECTIVITY #1b Condition #3: never auto-merge a group that contains a
    -- freshly-bridged, still-unclassified owner. (Surfaced for manual review;
    -- re-eligible once enriched off 'unknown'.)
    best_role_score >= 1 AND NOT (EXISTS ( SELECT 1
           FROM entities pe
          WHERE pe.id = ANY (groups.member_ids_winner_first)
            AND pe.owner_role = 'unknown'::text
            AND (pe.metadata ->> 'bridge_source'::text) = 'connectivity_inuse_owner'::text)) AS auto_mergeable,
    ( SELECT count(*) AS count
           FROM unnest(groups.member_ids_winner_first) mid(mid)
          WHERE (EXISTS ( SELECT 1
                   FROM external_identities x
                  WHERE x.entity_id = mid.mid AND x.source_system = 'salesforce'::text AND x.source_type = 'Account'::text))) AS sf_linked_member_count,
    (( SELECT count(*) AS count
           FROM unnest(groups.member_ids_winner_first) mid(mid)
          WHERE (EXISTS ( SELECT 1
                   FROM external_identities x
                  WHERE x.entity_id = mid.mid AND x.source_system = 'salesforce'::text AND x.source_type = 'Account'::text)))) > 0 AND (( SELECT count(*) AS count
           FROM unnest(groups.member_ids_winner_first) mid(mid)
          WHERE NOT (EXISTS ( SELECT 1
                   FROM external_identities x
                  WHERE x.entity_id = mid.mid AND x.source_system = 'salesforce'::text)))) > 0 AS sf_inheritance
   FROM groups;
