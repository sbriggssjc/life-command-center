-- ===========================================================================
-- Merge lane: widen the safe auto-merge to SF-corroborated, name-compatible
-- bridged_unknown_pinned groups
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-30
--
-- WHY (grounded live 2026-06-30)
-- ------------------------------
-- CONNECTIVITY #1b (migration 20260617124000) pinned every same-norm_name org
-- group containing a freshly-bridged owner (owner_role='unknown',
-- metadata.bridge_source IN ('connectivity_inuse_owner','connectivity1_inuse_unknown_owner'))
-- OUT of auto-merge until the twin-surfacing + human review. That pin was
-- deliberate and is RETAINED — but it over-holds a large class of GENUINE
-- duplicates: the merge lane still shows ~2,900 cards that are clearly the same
-- company captured under name variants (Boyer / DRA Advisors / Granger /
-- Huntington National Bank / Healthcare Realty Trust / …).
--
-- Of the 1,904 bridged_unknown_pinned groups (live):
--   * 469  raw_name_compatible AND distinct_sf_accounts = 1  <- the SAFE widen
--   * 14   raw_name_compatible AND distinct_sf_accounts >= 2 <- HELD (two real SF accounts)
--   * 1,382 raw_name_compatible AND distinct_sf_accounts = 0 <- HELD (no SF corroboration)
--   * 39   NOT raw_name_compatible                           <- HELD (distinct firms:
--          "Excelsior Capital" vs "The Excelsior Group" vs "Excelsior Partners";
--          "American Realty Capital" vs "American Properties Realty"; Nephron Cap
--          vs Nephron Prop; …)
--
-- For the 469 SAFE class: same-name variants (raw_name_compatible) anchored by
-- exactly ONE real Salesforce account (distinct_sf_accounts = 1). The multiple
-- domain true_owner bridges those members carry are the SAME owner captured
-- repeatedly, so the pin over-holds genuine dupes.
--
-- BRIDGE-SAFETY (why co-bridging multiple true_owners onto the survivor is OK):
--   * lcc_merge_entity moves every member's external_identities (incl. the
--     several (dia|gov, true_owner) bridges) onto the survivor. A survivor
--     carrying MULTIPLE true_owner identities is ALREADY the normal, tolerated
--     steady state — 43 LCC org entities carry >=2 true_owner identities today
--     (the bridge mints exactly that for any multi-property / multi-domain owner).
--   * The R6 / owner-facts resolver reads FROM a domain property -> its
--     true_owner -> (via the bridge) the LCC entity. Each domain true_owner
--     bridges to EXACTLY ONE entity (0 true_owner ids point at >1 entity live),
--     so a one-entity -> many-true_owner mapping is correct, not corruption, and
--     the merge introduces NO new identity collisions inside the 469 set.
--   * raw_name_compatible already requires EVERY member name to be a formatting
--     variant of the winner name, and a connectivity_inuse_owner member's entity
--     name IS its domain true_owner name -> so the existing gate already enforces
--     "the group's domain true_owners are dup-compatible." No extra guard needed;
--     the new tier still REQUIRES raw_name_compatible, so the 39 distinct-firm
--     name-incompatible groups can never qualify.
--
-- DESIGN
-- ------
--   auto_mergeable :=
--        raw_name_compatible
--    AND (
--          ( NOT pinned                                  -- the existing safe tiers
--            AND ( best_role_score >= 1
--                  OR ( sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1 ) ) )
--       OR ( pinned                                      -- NEW: SF-corroborated pinned tier
--            AND distinct_sf_accounts = 1 ) )            -- exactly one real SF account
--
--   distinct_sf_accounts = 1 implies >=1 SF-linked member, so the SF corroboration
--   is intrinsic. Pinned groups with 0 SF / >=2 SF / name-incompatible STAY held
--   in the lane (auto_mergeable=false rows still LIST for manual review) with a
--   review_reason for transparency. lcc_apply_fuzzy_merges (WHERE auto_mergeable
--   = true) is unchanged -> re-running it merges exactly the now-trustworthy set.
--
-- CREATE OR REPLACE VIEW: column list/order/type UNCHANGED (only the
-- auto_mergeable expression and the review_reason first arm change), so the
-- append-only rule is satisfied. No JS change required for this DDL.
-- ===========================================================================

BEGIN;

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
        ), scored AS (
         SELECT g.norm_name,
            g.member_ids_winner_first,
            g.member_names_winner_first,
            g.domains,
            g.member_count,
            g.best_role_score,
            -- SF Account-linked member count (the sf_inheritance / SF-tier signal).
            ( SELECT count(*) AS count
                   FROM unnest(g.member_ids_winner_first) mid(mid)
                  WHERE (EXISTS ( SELECT 1
                           FROM external_identities x
                          WHERE x.entity_id = mid.mid AND x.source_system = 'salesforce'::text AND x.source_type = 'Account'::text))) AS sf_linked_member_count,
            -- Members with NO salesforce identity of any kind (sf_inheritance arm).
            ( SELECT count(*) AS count
                   FROM unnest(g.member_ids_winner_first) mid(mid)
                  WHERE NOT (EXISTS ( SELECT 1
                           FROM external_identities x
                          WHERE x.entity_id = mid.mid AND x.source_system = 'salesforce'::text))) AS non_sf_member_count,
            -- Distinct SF Accounts across the group: >=2 = two real companies, never auto-merge.
            ( SELECT count(DISTINCT x.external_id)::int
                   FROM unnest(g.member_ids_winner_first) mid(mid)
                   JOIN external_identities x ON x.entity_id = mid.mid
                        AND x.source_system = 'salesforce'::text AND x.source_type = 'Account'::text) AS distinct_sf_accounts,
            -- CONNECTIVITY #1b pin: a freshly-bridged, still-unclassified owner.
            EXISTS ( SELECT 1
                   FROM entities pe
                  WHERE pe.id = ANY (g.member_ids_winner_first)
                    AND pe.owner_role = 'unknown'::text
                    AND (pe.metadata ->> 'bridge_source'::text) = 'connectivity_inuse_owner'::text) AS pinned,
            -- Raw-name guard: every loser is a genuine formatting variant of the winner.
            NOT EXISTS ( SELECT 1
                   FROM unnest(g.member_names_winner_first[2:]) ln(ln)
                  WHERE NOT public.lcc_name_pair_compatible(g.member_names_winner_first[1], ln.ln)) AS raw_name_compatible,
            -- Worst loser->winner cleaned-name similarity (transparency).
            ( SELECT min(similarity(public.lcc_clean_name_for_sim(g.member_names_winner_first[1]),
                                    public.lcc_clean_name_for_sim(ln.ln)))
                   FROM unnest(g.member_names_winner_first[2:]) ln(ln)) AS min_loser_sim
           FROM groups g
        )
 SELECT norm_name,
    member_ids_winner_first[1] AS winner_id,
    member_names_winner_first[1] AS winner_name,
    member_ids_winner_first[2:] AS loser_ids,
    member_names_winner_first[2:] AS loser_names,
    member_count,
    domains,
    best_role_score,
    -- Trustworthy auto-merge gate. raw-name-compatible is REQUIRED in every tier
    -- (so distinct-firm name-incompatible groups never qualify), then:
    --   * NOT pinned: a classified role OR an SF-corroborated single-account group;
    --   * pinned (CONNECTIVITY #1b): widened ONLY to the SF-corroborated, single-
    --     account class (distinct_sf_accounts = 1) — same-name variants anchored by
    --     exactly one real Salesforce account. 0-SF / multi-SF pinned groups stay held.
    ( raw_name_compatible
      AND (
            ( NOT pinned
              AND ( best_role_score >= 1
                    OR ( sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1 ) ) )
         OR ( pinned
              AND distinct_sf_accounts = 1 )
      )
    ) AS auto_mergeable,
    sf_linked_member_count,
    ( sf_linked_member_count > 0 AND non_sf_member_count > 0 ) AS sf_inheritance,
    -- --- appended diagnostics (surface why a group is held) ---
    raw_name_compatible,
    round(min_loser_sim::numeric, 3) AS min_loser_sim,
    distinct_sf_accounts,
    CASE
      WHEN ( raw_name_compatible
             AND ( ( NOT pinned
                     AND ( best_role_score >= 1
                           OR ( sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1 ) ) )
                OR ( pinned AND distinct_sf_accounts = 1 ) ) )
        THEN NULL
      WHEN pinned THEN 'bridged_unknown_pinned'
      WHEN NOT raw_name_compatible THEN 'low_name_similarity'
      WHEN sf_linked_member_count >= 1 AND distinct_sf_accounts >= 2 THEN 'multiple_sf_accounts'
      WHEN best_role_score = 0 AND sf_linked_member_count = 0 THEN 'no_role_or_sf_signal'
      ELSE 'review'
    END AS review_reason
   FROM scored;

GRANT SELECT ON public.v_lcc_merge_candidates TO authenticated;

COMMIT;
