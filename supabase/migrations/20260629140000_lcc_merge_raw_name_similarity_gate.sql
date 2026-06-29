-- ===========================================================================
-- Trustworthy entity auto-merge: raw-name-similarity gate
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-29
--
-- WHY (grounded live 2026-06-29)
-- ------------------------------
-- v_lcc_merge_candidates groups orgs by lcc_normalize_entity_name, which STRIPS
-- descriptive tokens (properties / capital / group / trust / holdings / partners)
-- to collapse formatting variants. But that normalizer OVER-collapses genuinely-
-- distinct companies to the same key, e.g.
--   "Realty Trust Group LLC"  + "Capital Realty"           -> norm "realty"
--   "American Realty Capital"  + "American Properties Realty LLC" -> "american realty"
-- A blanket auto-merge of those would corrupt the entity graph. This round gates
-- auto_mergeable on RAW-name similarity (which preserves the distinguishing
-- tokens the normalizer dropped) so only genuine formatting variants auto-merge,
-- and ADDS a Salesforce-corroborated tier so safe variants the role gate never
-- saw (no classified owner_role) can auto-merge too.
--
-- GROUNDING that shaped the design (live, read-only):
--   * 2,303 candidate groups; cur auto_mergeable = 0 (the 550 role-based set was
--     already merged). Of the 2,303 only 71 carry a classified owner_role, and
--     ALL 71 are connectivity-#1b-PINNED (freshly-bridged unknown member) -> the
--     role path yields 0 today regardless. So an additive role-path tightening is
--     correct-but-inert now; it protects the path once a pinned owner is enriched
--     off 'unknown'.
--   * The real, safe growth is the SF-corroborated tier: 607 SF-linked groups,
--     105 of them unpinned + raw-name-compatible. 101 of those carry <=1 distinct
--     SF Account -> SAFE to auto-merge (the SF link is the canonical anchor; the
--     rest of the group is a capture dup). 4 carry >=2 distinct SF Accounts
--     (e.g. "Physicians Realty Trust" + "Physicians Realty LP" = a REIT + its
--     operating partnership, two real accounts) -> HELD for human review.
--   * Similarity cleanly separates: legit variants score >= 0.667 (min in the
--     auto set), wrong-family collapses score <= 0.45 ("Cottonwood Partners" vs
--     "Cottonwood Capital" 0.41; "Capital Realty" vs "Realty Trust Group" 0.23).
--     Threshold 0.60 sits in the gap. A word-prefix/equality OR catches the short
--     suffix-addition case the trigram score under-rates.
--
-- DESIGN
-- ------
--   auto_mergeable :=
--        NOT connectivity-pinned                       (preserve CONNECTIVITY #1b)
--    AND raw_name_compatible                            (NEW: every loser ~ winner)
--    AND ( best_role_score >= 1                         (role tier, now compat-gated)
--       OR (sf_linked_member_count >= 1                 (NEW SF-corroborated tier)
--           AND distinct_sf_accounts <= 1) )            (never collapse 2 SF accts)
--
-- The raw-name guard is ADDITIVE: it can only SHRINK the auto set to the safe
-- members, never widen it to unsafe ones. The SF-corroborated tier is the growth.
-- lcc_apply_fuzzy_merges (WHERE auto_mergeable = true) is unchanged -> re-running
-- it merges exactly the now-trustworthy set. Anything held (incompatible / multi-
-- SF-account / role-less-without-SF / pinned) stays in the Decision Center merge
-- lane for individual human review, with a `review_reason` for transparency.
--
-- CREATE OR REPLACE VIEW: columns 1..11 unchanged in name/type/order; four new
-- columns (raw_name_compatible / min_loser_sim / distinct_sf_accounts /
-- review_reason) APPENDED at the end (append-only rule satisfied). No JS change.
-- ===========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. lcc_clean_name_for_sim(text) — light cleanup for the similarity compare.
--    Lowercase, punctuation -> space, strip ONLY hard legal FORMS (llc/inc/corp/
--    co/lp/llp/ltd/na/the/...) — deliberately KEEPS the descriptive tokens
--    (properties/capital/group/trust/...) the normalizer drops, so distinct
--    companies that share a norm_name stay distinguishable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_clean_name_for_sim(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9 ]+', ' ', 'g'),
        '\m(llc|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|na|the)\M', ' ', 'g'),
      '\s+', ' ', 'g')),
    '');
$$;

-- ---------------------------------------------------------------------------
-- 2. lcc_name_pair_compatible(a, b) — TRUE when two raw names are genuine
--    formatting variants of each other: equal / word-prefix containment / or
--    trigram similarity >= 0.60 over the cleaned forms. NULL (empty) clean -> false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_name_pair_compatible(p_a text, p_b text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  WITH x AS (
    SELECT public.lcc_clean_name_for_sim(p_a) AS ca,
           public.lcc_clean_name_for_sim(p_b) AS cb
  )
  SELECT CASE
    WHEN ca IS NULL OR cb IS NULL THEN false
    WHEN ca = cb                 THEN true
    WHEN ca LIKE cb || ' %'      THEN true   -- cb is a word-boundary prefix of ca
    WHEN cb LIKE ca || ' %'      THEN true   -- ca is a word-boundary prefix of cb
    ELSE similarity(ca, cb) >= 0.60
  END
  FROM x;
$$;

-- ---------------------------------------------------------------------------
-- 3. v_lcc_merge_candidates — raw-name-similarity-gated auto_mergeable + the
--    SF-corroborated tier. Body reproduces the CONNECTIVITY #1b definition
--    (migration 20260617124000) verbatim, changing only auto_mergeable and
--    appending the four diagnostic columns.
-- ---------------------------------------------------------------------------
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
    -- Trustworthy auto-merge gate: not pinned AND raw-name-compatible AND
    -- (a classified role OR an SF-corroborated single-account group).
    ( NOT pinned
      AND raw_name_compatible
      AND ( best_role_score >= 1
            OR ( sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1 ) )
    ) AS auto_mergeable,
    sf_linked_member_count,
    ( sf_linked_member_count > 0 AND non_sf_member_count > 0 ) AS sf_inheritance,
    -- --- appended diagnostics (Unit 3: surface why a group is held) ---
    raw_name_compatible,
    round(min_loser_sim::numeric, 3) AS min_loser_sim,
    distinct_sf_accounts,
    CASE
      WHEN ( NOT pinned AND raw_name_compatible
             AND ( best_role_score >= 1 OR ( sf_linked_member_count >= 1 AND distinct_sf_accounts <= 1 ) ) )
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
