-- ============================================================================
-- Tier 4 Unit 3 — surface the SF-link-inheritance signal on the consolidated
-- entity-merge surface (route the name-matched duplicates to HUMAN review).
--
-- Grounding (live 2026-06-16): the SF-link "30k myth" is dead — LCC mirrors
-- 2,008 SF Accounts, ~all already linked to entities; the realistic NEW-link
-- ceiling needs the live SF connector account dump (not knowable from the DB).
-- The ONE DB-grounded, bounded win is the duplicates: of the 10,913 clean
-- unlinked orgs, 275 normalize-name-match an entity that ALREADY carries an SF
-- Account. Rolled up to merge groups, 84 groups MIX an SF-linked entity with
-- an unlinked one. Merging each unlinked duplicate into its linked twin BOTH
-- dedups the entity graph AND inherits the SF link (lcc_merge_entity moves
-- external_identities to the survivor). Merges stay HUMAN (Tier-2 doctrine) —
-- there is NO auto-merge cron; the merge_duplicate_entities Decision Center
-- lane is operator-triggered.
--
-- Problem: that lane filtered auto_mergeable=eq.true, so only 11 of the 84
-- SF-inheritance groups surfaced; the 73 review-class ones (which most need a
-- human) were invisible. This migration adds the signal so the lane can route
-- ALL 84 to review and flag the SF-inheritance bonus.
--
-- Append-only CREATE OR REPLACE (BD gotcha #1): two columns added at the END;
-- existing consumers (auto-merge worker selects specific columns) unaffected.
--
-- The full SF-link backfill (matching unlinked orgs to NEW SF accounts) is a
-- DEFERRED, connector-dependent follow-up — it requires pulling the live SF
-- account universe to know the real opportunity, and building speculative
-- match infra for an unknown ceiling is exactly the over-engineering this audit
-- avoided. Documented, not built.
-- ============================================================================

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
    best_role_score >= 1 AS auto_mergeable,
    -- Tier-4 Unit 3 (appended): SF-link-inheritance signal
    ( SELECT count(*) FROM unnest(member_ids_winner_first) mid
       WHERE EXISTS ( SELECT 1 FROM external_identities x
                       WHERE x.entity_id = mid
                         AND x.source_system = 'salesforce'
                         AND x.source_type = 'Account')) AS sf_linked_member_count,
    ( ( SELECT count(*) FROM unnest(member_ids_winner_first) mid
         WHERE EXISTS ( SELECT 1 FROM external_identities x
                         WHERE x.entity_id = mid
                           AND x.source_system = 'salesforce'
                           AND x.source_type = 'Account')) > 0
      AND
      ( SELECT count(*) FROM unnest(member_ids_winner_first) mid
         WHERE NOT EXISTS ( SELECT 1 FROM external_identities x
                             WHERE x.entity_id = mid
                               AND x.source_system = 'salesforce')) > 0
    ) AS sf_inheritance
   FROM groups;
