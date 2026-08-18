-- ============================================================================
-- P139 — register `gov_ownership_transition` as an owner-evidence source.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- No writer, no data. This teaches the EXISTING supersession engine how to rank
-- a source that does not exist in the evidence table yet, so the feeder that
-- follows (scripts/feed-gov-ownership-transitions.mjs) has somewhere correct to
-- land.
--
-- TIER 3, alongside rel_purchase -- deliberately NOT above it.
--   CLAUDE.md's reasoning for the ladder is that domain_true_owner outranks
--   rel_purchase "because it is the domain's curated CURRENT owner-of-record,
--   whereas a purchase edge is ONE historical transaction." A gov
--   ownership_history row is also ONE historical transaction -- a dated
--   transfer, not a claim about who owns the asset today. So it belongs WITH
--   rel_purchase, and within the tier the DATE decides, which is exactly the
--   supersession behaviour wanted.
--
-- field_source_priority 18 -- just above rel_purchase (20), below
-- domain_true_owner (10).
--
--   THE TWO LADDERS DIFFER ON PURPOSE, and a reader will otherwise take the
--   mismatch for a mistake. The supersession TIER asks "what KIND of claim is
--   this" -- both are historical transactions, so parity. The merge PRIORITY
--   asks "if these disagree on the same field, who wins" -- and the domain's own
--   recorded transfer beats an edge inferred from a relationship graph.
--
-- enforce_mode 'record_only' matches every other row on this field.
--
-- NO-OP GATE (verified live): registering a source with zero rows must change
-- nothing. Before and after, v_lcc_owner_supersession_review is identical --
--   tie_on_winning_date 678/236 · person_shaped_winner 59/59
--   brokerage_named_as_owner 23/23 · purchase_tier_no_org_marker 10/10
-- and v_lcc_owner_supersession_candidates holds 770 rows. The ladder grows
-- 5 -> 6 rows; v_field_provenance_unranked stays at its pre-existing 35.
--
-- REVERSAL:
--   delete from field_source_priority
--    where target_table='lcc.lcc_property_owner' and field_name='owner_entity_id'
--      and source='gov_ownership_transition';
--   -- then re-create the view without the P139 CASE arm.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('lcc.lcc_property_owner', 'owner_entity_id', 'gov_ownership_transition', 18, 'record_only',
   'P139. gov.ownership_history dated prior->new transfer, surfaced by '
   || 'v_ownership_transitions_portfolio and joined ID-to-ID via '
   || 'external_identities(gov, true_owner). Ranked above rel_purchase because it '
   || 'is the domain''s own recorded transfer rather than an edge inferred from a '
   || 'relationship graph; ranked below domain_true_owner because it describes ONE '
   || 'transaction rather than the curated current owner. Sits in supersession '
   || 'TIER 3 with rel_purchase so the transfer DATE, not the source, decides.')
ON CONFLICT DO NOTHING;

-- Add the tier arm. Column list and order unchanged (CREATE OR REPLACE VIEW is
-- append-only for columns); only the CASE gains a branch.
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
        ), u AS (
         SELECT ev.entity_id, ev.candidate_owner_entity, ev.source, ev.weight,
            ev.observed_at, ev.detail, ev.updated_at
           FROM ev JOIN unresolved x ON x.entity_id = ev.entity_id
        ), tiered AS (
         SELECT u.entity_id, u.candidate_owner_entity, u.source, u.observed_at,
                CASE u.source
                    WHEN 'manual'::text                   THEN 1
                    WHEN 'domain_true_owner'::text        THEN 2
                    WHEN 'rel_purchase'::text             THEN 3
                    WHEN 'gov_ownership_transition'::text THEN 3   -- P139
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
