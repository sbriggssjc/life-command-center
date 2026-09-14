-- ============================================================================
-- P145 — when an SPE and its own parent both bid for one asset, the SPE wins.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19. 104 resolved.
-- ----------------------------------------------------------------------------
-- P144 established WHY the tie lane never moved: `buyer` (the SPE on the deed)
-- and `true_buyer` (the beneficial owner behind it) are both `purchases`, so one
-- sale produces two candidates at an identical date. A date cannot break that --
-- they are identical BY CONSTRUCTION. Three separate ordering datasets were
-- thrown at this lane (SF notes 0, dia workbook 7, gov transitions 18) before
-- anyone opened it.
--
-- Measured BOTH directions before choosing, rather than arguing the semantics:
--     prefer the PARENT   ->  63 assets resolve
--     prefer the SPE      -> 118 assets resolve, and 108 of those already carry
--                            a P144 parent_of edge
--
-- The SPE wins on every axis. It is the legal owner of record, which is what
-- `lcc_property_owner` means; it resolves nearly twice as many; and BD reach is
-- NOT lost, because P144's parent_of edge puts the parent one hop away where the
-- reachability resolver already walks. Before P144 existed, preferring the
-- parent was the only way to keep that reach -- which is precisely why this
-- decision was not takeable earlier in the day.
--
-- THE RULE: drop a candidate that is the PARENT of another candidate on the same
-- asset. Deliberately NOT "prefer buyer over true_buyer" -- the evidence rows
-- carry no role (detail holds only `rel`), so the relationship graph expresses
-- it instead, and the rule stays correct if a future feeder emits the same shape
-- from a different source.
--
-- LIVE EFFECT (dry measurement and applied result agreed exactly):
--     unique winners  190 -> 293
--     ties            233 -> 130      (-44%)
--     140 parent candidates suppressed · 104 resolved this batch
--     lcc_property_owner 3,809 -> 3,913
--
-- If the surviving SPE later fails the brokerage or org-marker guard, the asset
-- lands in review rather than falling back to the parent. Deliberate: the
-- conservative outcome, and the parent is still one hop away for a human.
--
-- REVERSAL: re-create the view without the `suppressed` CTE and its LEFT JOIN;
--           delete from lcc_property_owner where source='supersession'
--            and entity_id in (select entity_id from lcc_owner_supersession_log
--                               where batch_tag='p145_spe_precedence_20260819');
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_owner_supersession_candidates AS
 WITH ev AS (
         SELECT e.entity_id, e.candidate_owner_entity, e.source, e.weight,
            e.observed_at, e.detail, e.updated_at
           FROM lcc_property_owner_evidence e
          WHERE NOT (e.candidate_owner_entity IN ( SELECT lcc_owner_operator_block.owner_entity_id
                   FROM lcc_owner_operator_block))
        ), unresolved AS (
         SELECT DISTINCT ev.entity_id
           FROM ev LEFT JOIN lcc_property_owner po ON po.entity_id = ev.entity_id
          WHERE po.entity_id IS NULL
        ), u0 AS (
         SELECT ev.entity_id, ev.candidate_owner_entity, ev.source, ev.weight,
            ev.observed_at, ev.detail, ev.updated_at
           FROM ev JOIN unresolved x ON x.entity_id = ev.entity_id
        ), suppressed AS (
         -- P145: this candidate is the PARENT of another candidate on the same
         -- asset, so it is the same party one level up. Drop it; keep the SPE.
         SELECT DISTINCT a.entity_id, a.candidate_owner_entity
           FROM u0 a
           JOIN entity_relationships p
             ON p.to_entity_id = a.candidate_owner_entity
            AND p.relationship_type = 'associated_with'
            AND p.metadata->>'role' = 'parent_of'
           JOIN u0 b
             ON b.entity_id = a.entity_id
            AND b.candidate_owner_entity = p.from_entity_id
        ), u AS (
         SELECT u0.* FROM u0
           LEFT JOIN suppressed s
             ON s.entity_id = u0.entity_id
            AND s.candidate_owner_entity = u0.candidate_owner_entity
          WHERE s.entity_id IS NULL
        ), tiered AS (
         SELECT u.entity_id, u.candidate_owner_entity, u.source, u.observed_at,
                CASE u.source
                    WHEN 'manual'::text                   THEN 1
                    WHEN 'domain_true_owner'::text        THEN 2
                    WHEN 'rel_purchase'::text             THEN 3
                    WHEN 'gov_ownership_transition'::text THEN 3
                    WHEN 'sf_seller'::text                THEN 4
                    ELSE 5
                END AS tier
           FROM u
        ), best_tier AS (
         SELECT tiered.entity_id, min(tiered.tier) AS tier
           FROM tiered GROUP BY tiered.entity_id
        ), in_tier AS (
         SELECT t.entity_id, t.candidate_owner_entity, t.source, t.observed_at, t.tier
           FROM tiered t JOIN best_tier b ON b.entity_id = t.entity_id AND b.tier = t.tier
        ), latest AS (
         SELECT in_tier.entity_id, max(in_tier.observed_at) AS win_date
           FROM in_tier GROUP BY in_tier.entity_id
        ), runner AS (
         SELECT i_1.entity_id, max(i_1.observed_at) AS runner_up_date
           FROM in_tier i_1 JOIN latest l_1 ON l_1.entity_id = i_1.entity_id
          WHERE i_1.observed_at < l_1.win_date
          GROUP BY i_1.entity_id
        )
 SELECT i.entity_id,
    i.candidate_owner_entity AS owner_entity_id,
    oe.name AS owner_name,
    oe.entity_type AS owner_entity_type,
    i.tier,
    i.source AS tier_source,
    l.win_date,
    r.runner_up_date,
    count(*) OVER (PARTITION BY i.entity_id) AS winners_at_date,
    count(*) OVER (PARTITION BY i.entity_id) = 1 AS is_unique
   FROM in_tier i
     JOIN latest l ON l.entity_id = i.entity_id AND i.observed_at = l.win_date
     LEFT JOIN runner r ON r.entity_id = i.entity_id
     LEFT JOIN entities oe ON oe.id = i.candidate_owner_entity;
