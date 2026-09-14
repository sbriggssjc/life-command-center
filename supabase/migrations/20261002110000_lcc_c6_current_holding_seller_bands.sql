-- ============================================================================
-- C6 — let a CURRENT HOLDING satisfy the gov seller-side bands, gated on
--      reachability.  (LCC Opps, xengecqvemvfknjvbvrq)
--
-- THE DEFECT (measured 2026-08-28, re-measured 2026-08-29)
-- --------------------------------------------------------
-- `gov_owner_props` gated every gov deal-timing band on
--     effective_owner_role = ANY (ARRAY['developer','user_owner'])
-- `entities.owner_role` is a PARTY-LEVEL identity; the bands ask a PER-ASSET
-- question.  The CTE has ALREADY joined lcc_entity_portfolio_facts on
-- `is_current = true` -- the per-asset ownership fact -- and then discards it in
-- favour of the entity's global label.  Consequences:
--   * `user_owner` is 0 of 66,874 live entities -- half the gate has never
--     matched a row (Dead-End playbook Class 22).
--   * 578 owners typed `buyer` hold a gov property with a lease expiring inside
--     24 months, $410.4M (Boyd Watterson 45 gov assets, Prologis, RMR Group,
--     HC Government Realty Trust).  Their labels are CORRECT; they are also the
--     current owner of an expiring building (Class 24).
--
-- THE CHANGE
-- ----------
-- In `gov_owner_props` ONLY, the role predicate is replaced by the P112
-- reachability precondition.  Current holding is already established by the
-- existing `f.is_current = true` join, so the CTE now reads:
--     the entity holds a CURRENT gov asset AND the owner is REACHABLE.
-- Applies to the four gov deal-timing arms that read `gov_owner_props`:
-- P1 lease_expiry_24mo, P2 firm_term_ending_24mo, P3 ten_year_window,
-- P8 agency_active_solicitations.
--
-- REACHABILITY = an `owner_contact_pivot` row with a non-null
-- `active_contact_entity_id` -- the fact the Tier 0 arc (P188/P194
-- `applyTier0Attach`) WRITES and `v_owner_contact_enrich_queue` already keys on.
-- No second definition is introduced.  `v_lcc_owner_reachability` was read
-- first, as CLAUDE.md requires, and is NOT usable here: it is a single-row
-- AGGREGATE view exposing no per-owner membership, and its `owners` CTE is
-- scoped through `lcc_property_owner` + asset entities -- a different population
-- from this queue's portfolio-facts join (overlap with the pivot is 263 of
-- 1,441 / 495).  Reconstructing `reachable_hero_qualified` inline would be a
-- second copy of a definition (the normaliser drift this repo warns about) and
-- would gate on a population boundary unrelated to reachability.
--
-- WITHOUT the reachability gate the same change emits 3,235 rows over 2,719
-- owners of whom only 11% can be contacted -- cadences that can never advance
-- and only age into "overdue".  That is the documented P112 failure at scale.
-- Reachability is load-bearing, not a nicety.
--
-- ⚠️ P5 / `aged_props` KEEPS ITS ROLE GATE -- deliberately, for three measured
--    reasons: P5 is 83% of the naive flood (58 -> 1,681); "built 25+ years ago,
--    not renovated in 15" implies no timing at all; and `aged_props` joins
--    lcc_entity_portfolio_facts with NO source_domain filter, so it covers dia
--    too (26 -> 565 dia rows).  Changing it would be a cross-domain change.
--    Nothing in this arc has been.
--
-- ⚠️ FIRING A BAND IS NOT CHOOSING THE PITCH.  account-based-contact-
--    intelligence.md is explicit that acquisitions and disposition are
--    different contacts, tones and buckets.  This change makes the signal
--    VISIBLE; which bucket the call lands in is C4a, Scott's doctrine call, and
--    is deliberately still open.  No bucket, tone or prospecting column is
--    added here.
--
-- MEASURED EFFECT (v_priority_queue_live, live view, 2026-08-29)
--   band  today            after
--   P1     74 rows          149    (predicted 149)
--   P2     32 rows           95    (predicted  95)
--   P3     61 rows          163    (predicted 163)
--   P8     76 rows          213    (predicted 213)
--   four  243 rows / 194 assets / 148 owners
--         -> 620 rows / 497 assets / 303 owners
--   ⚠️ The brief's "497 rows" is the DISTINCT (entity, source_property_id)
--      count, not the row count.  The queue emits one row per
--      (owner, property, band), so an asset tripping both P1 and P8 emits two
--      rows.  620 and 497 are both correct about different questions; the
--      per-band figures and the 303 owners match the prediction exactly.
--
--   Unchanged, verified: P5 58 . P0.4 555 . P0.5 148 . P-CONTACT 231 .
--   P-BUYER 22 . P4 12 . every dia row (dia rows only ever arise in P5/P4/
--   P-CONTACT/P-BUYER, none of which this touches).
--
-- NO COLUMNS ADDED OR REORDERED (CREATE OR REPLACE VIEW is append-only for
-- columns; 42P16).  The whole view body is restated here, per P194: "read the
-- live definition as the authority" is not a substitute for committing the
-- view -- the next rebuild silently regresses otherwise.
--
-- ⚠️ THE QUEUE READS A MATERIALIZED CACHE (`lcc_priority_queue_resolved`,
--    refreshed every 5 min by `lcc-priority-queue-refresh`).  This migration
--    calls `lcc_refresh_priority_queue_resolved()` at the end so the cache
--    cannot sit stale behind the new view.
--
-- REVERSAL: see the footer.  The prior body is this body with the
-- `gov_owner_props` WHERE clause restored to the role gate; it is additionally
-- captured verbatim into `lcc_c6_view_backup` by this migration.
-- ============================================================================

-- Capture the prior definition verbatim so reversal needs no transcription.
CREATE TABLE IF NOT EXISTS public.lcc_c6_view_backup (
  id            bigserial PRIMARY KEY,
  view_name     text        NOT NULL,
  def           text        NOT NULL,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  batch_tag     text
);

INSERT INTO public.lcc_c6_view_backup (view_name, def, batch_tag)
SELECT 'v_priority_queue_live',
       pg_get_viewdef('public.v_priority_queue_live'::regclass, true),
       'c6_20260829'
WHERE NOT EXISTS (
  SELECT 1 FROM public.lcc_c6_view_backup
   WHERE view_name = 'v_priority_queue_live' AND batch_tag = 'c6_20260829'
);

CREATE OR REPLACE VIEW public.v_priority_queue_live AS
 WITH entity_effective_role AS (
         SELECT entities.id AS entity_id,
            entities.workspace_id,
            entities.name,
            entities.domain,
            COALESCE(entities.behavioral_override, entities.owner_role) AS effective_owner_role,
            entities.owner_role_confidence,
            entities.developer_status_active_until,
            entities.user_owner_tier,
            entities.primary_concern
           FROM entities
          WHERE entities.merged_into_entity_id IS NULL
        ), open_prospect_opps AS (
         SELECT bd_opportunities.entity_id,
            count(*) AS open_count,
            min(bd_opportunities.opened_at) AS oldest_open_at,
            array_agg(bd_opportunities.owner_user_id) FILTER (WHERE bd_opportunities.owner_user_id IS NOT NULL) AS owner_user_ids,
            array_agg(bd_opportunities.vertical) FILTER (WHERE bd_opportunities.vertical IS NOT NULL) AS verticals
           FROM bd_opportunities
          WHERE bd_opportunities.is_open = true AND bd_opportunities.type = 'prospect'::text
          GROUP BY bd_opportunities.entity_id
        ), cadence_state AS (
         SELECT touchpoint_cadence.entity_id,
            touchpoint_cadence.contact_id,
            touchpoint_cadence.sf_contact_id,
            touchpoint_cadence.owner_user_id,
            touchpoint_cadence.bd_opportunity_id,
            touchpoint_cadence.phase,
            touchpoint_cadence.priority_tier,
            touchpoint_cadence.current_touch,
            touchpoint_cadence.last_touch_at,
            touchpoint_cadence.next_touch_due,
            touchpoint_cadence.last_touch_type,
            touchpoint_cadence.domain AS cadence_domain
           FROM touchpoint_cadence
        ), gov_owner_props AS (
         -- C6: the band is a PER-ASSET question and `f.is_current = true` below
         -- already answers it.  The party-level role gate that used to sit here
         -- (`effective_owner_role = ANY (ARRAY['developer','user_owner'])`) is
         -- replaced by the P112 reachability precondition, so every emitted row
         -- is callable.  See the header for the measured alternative.
         SELECT eer.entity_id,
            eer.name,
            eer.workspace_id,
            eer.effective_owner_role,
            eer.owner_role_confidence,
            f.source_domain,
            f.source_property_id,
            a.lease_expiration,
            a.firm_term_remaining,
            a.term_remaining,
            a.sam_active_opportunities
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true AND f.source_domain = 'gov'::text
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE (EXISTS ( SELECT 1
                   FROM owner_contact_pivot ocp
                  WHERE ocp.entity_id = eer.entity_id AND ocp.active_contact_entity_id IS NOT NULL))
        ), recent_acquirers AS (
         SELECT eer.entity_id,
            eer.name,
            eer.workspace_id,
            eer.domain AS vertical,
            eer.effective_owner_role,
            eer.owner_role_confidence,
            count(*) AS recent_acq_count,
            min(f.ownership_start_date) AS earliest_recent_start,
            max(f.ownership_start_date) AS latest_recent_start
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text, 'buyer'::text])) AND f.ownership_start_date >= (CURRENT_DATE - '1 year 6 mons'::interval)
          GROUP BY eer.entity_id, eer.name, eer.workspace_id, eer.domain, eer.effective_owner_role, eer.owner_role_confidence
         HAVING count(*) >= 2
        ), aged_props AS (
         -- C6: P5 KEEPS the role gate on purpose.  It is 83% of the naive
         -- flood (58 -> 1,681), it implies no timing, and this CTE has NO
         -- source_domain filter so it covers dia too (26 -> 565 dia rows).
         SELECT eer.entity_id,
            eer.name,
            eer.workspace_id,
            eer.effective_owner_role,
            eer.owner_role_confidence,
            f.source_domain,
            f.source_property_id,
            a.year_built,
            a.year_renovated
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])) AND a.year_built IS NOT NULL AND a.year_built > 1800 AND a.year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer - 25) AND (a.year_renovated IS NULL OR a.year_renovated <= (EXTRACT(year FROM CURRENT_DATE)::integer - 15))
        ), connected_entities AS (
         SELECT e0.id AS entity_id
           FROM entities e0
          WHERE e0.merged_into_entity_id IS NULL AND ((EXISTS ( SELECT 1
                   FROM external_identities ei
                  WHERE ei.entity_id = e0.id AND ei.source_system = 'salesforce'::text)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.from_entity_id = e0.id)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.to_entity_id = e0.id)))
        ), person_connected_entities AS (
         SELECT e0.id AS entity_id
           FROM entities e0
          WHERE e0.merged_into_entity_id IS NULL AND ((EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.from_entity_id = e0.id)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.to_entity_id = e0.id)))
        ), self_contactable_person_entities AS (
         SELECT e.id AS entity_id
           FROM entities e
          WHERE e.merged_into_entity_id IS NULL AND e.entity_type = 'person'::entity_type AND (NULLIF(btrim(e.email), ''::text) IS NOT NULL OR NULLIF(btrim(e.phone), ''::text) IS NOT NULL) AND COALESCE((e.metadata ->> 'junk_name_flagged'::text)::boolean, false) = false AND COALESCE((e.metadata ->> 'orphan_flagged'::text)::boolean, false) = false AND char_length(btrim(e.name)) >= 3 AND char_length(btrim(e.name)) <= 60 AND e.name !~ '[0-9]'::text AND array_length(regexp_split_to_array(btrim(e.name), '\s+'::text), 1) >= 2 AND array_length(regexp_split_to_array(btrim(e.name), '\s+'::text), 1) <= 5 AND e.name !~* '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y'::text
        ), reachable_cadence AS (
         SELECT cs.entity_id
           FROM cadence_state cs
          WHERE cs.entity_id IS NOT NULL AND (cs.sf_contact_id IS NOT NULL OR cs.contact_id IS NOT NULL OR (cs.entity_id IN ( SELECT person_connected_entities.entity_id
                   FROM person_connected_entities)) OR (cs.entity_id IN ( SELECT self_contactable_person_entities.entity_id
                   FROM self_contactable_person_entities)))
        ), entity_primary_property AS (
         SELECT DISTINCT ON (f.entity_id) f.entity_id,
            f.source_domain,
            f.source_property_id
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current = true
          ORDER BY f.entity_id, (f.source_domain = 'gov'::text) DESC, f.annual_rent DESC NULLS LAST, f.source_property_id
        )
 SELECT eer.entity_id,
    eer.name,
    eer.workspace_id,
    eer.domain AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P0.4'::text AS priority_band,
    'resolve_ownership_control'::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    NULL::integer AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    eer.effective_owner_role,
    eer.owner_role_confidence,
    epp.source_domain,
    epp.source_property_id
   FROM entity_effective_role eer
     LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
     LEFT JOIN entity_primary_property epp ON epp.entity_id = eer.entity_id
  WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])) AND opp.entity_id IS NULL AND NOT (eer.entity_id IN ( SELECT v_lcc_buyer_spe_entities.entity_id
           FROM v_lcc_buyer_spe_entities)) AND NOT (eer.entity_id IN ( SELECT connected_entities.entity_id
           FROM connected_entities))
UNION ALL
 SELECT eer.entity_id,
    eer.name,
    eer.workspace_id,
    eer.domain AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P0.5'::text AS priority_band,
    'open_bd_opportunity_needed'::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    NULL::integer AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    eer.effective_owner_role,
    eer.owner_role_confidence,
    NULL::text AS source_domain,
    NULL::text AS source_property_id
   FROM entity_effective_role eer
     LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
  WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])) AND opp.entity_id IS NULL AND NOT (eer.entity_id IN ( SELECT v_lcc_buyer_spe_entities.entity_id
           FROM v_lcc_buyer_spe_entities)) AND (eer.entity_id IN ( SELECT connected_entities.entity_id
           FROM connected_entities))
UNION ALL
 SELECT gop.entity_id,
    gop.name,
    gop.workspace_id,
    'gov'::text AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P1'::text AS priority_band,
    'lease_expiry_24mo'::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    EXTRACT(day FROM gop.lease_expiration::timestamp with time zone - now())::integer AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    gop.effective_owner_role,
    gop.owner_role_confidence,
    gop.source_domain,
    gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.lease_expiration IS NOT NULL AND gop.lease_expiration >= CURRENT_DATE AND gop.lease_expiration <= (CURRENT_DATE + '2 years'::interval)::date
UNION ALL
 SELECT gop.entity_id,
    gop.name,
    gop.workspace_id,
    'gov'::text AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P2'::text AS priority_band,
    'firm_term_ending_24mo'::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    NULL::integer AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    gop.effective_owner_role,
    gop.owner_role_confidence,
    gop.source_domain,
    gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.firm_term_remaining IS NOT NULL AND gop.firm_term_remaining > 0::numeric AND gop.firm_term_remaining < 2::numeric
UNION ALL
 SELECT gop.entity_id,
    gop.name,
    gop.workspace_id,
    'gov'::text AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P3'::text AS priority_band,
    'ten_year_window'::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    NULL::integer AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    gop.effective_owner_role,
    gop.owner_role_confidence,
    gop.source_domain,
    gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.term_remaining IS NOT NULL AND gop.term_remaining >= 8::numeric AND gop.term_remaining <= 12::numeric
UNION ALL
 SELECT ra.entity_id,
    ra.name,
    ra.workspace_id,
    ra.vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P4'::text AS priority_band,
    'recent_acquisition_streak:'::text || ra.recent_acq_count AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    ra.recent_acq_count::integer AS days_overdue,
    ra.latest_recent_start::timestamp with time zone AS last_touch_at,
    'acquisition'::text AS last_touch_type,
    ra.effective_owner_role,
    ra.owner_role_confidence,
    NULL::text AS source_domain,
    NULL::text AS source_property_id
   FROM recent_acquirers ra
UNION ALL
 SELECT ap.entity_id,
    ap.name,
    ap.workspace_id,
    ap.source_domain AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P5'::text AS priority_band,
    'aged_building_value_add:built_'::text || ap.year_built::text AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    EXTRACT(year FROM CURRENT_DATE)::integer - ap.year_built AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    ap.effective_owner_role,
    ap.owner_role_confidence,
    ap.source_domain,
    ap.source_property_id
   FROM aged_props ap
UNION ALL
 SELECT cs.entity_id,
    eer.name,
    eer.workspace_id,
    COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id,
    cs.contact_id,
    cs.bd_opportunity_id,
    'P-CONTACT'::text AS priority_band,
    'select_prospecting_contact'::text AS reason,
    cs.next_touch_due,
    EXTRACT(day FROM now() - cs.next_touch_due)::integer AS days_overdue,
    cs.last_touch_at,
    cs.last_touch_type,
    eer.effective_owner_role,
    eer.owner_role_confidence,
    NULL::text AS source_domain,
    NULL::text AS source_property_id
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
  WHERE cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND cs.entity_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM reachable_cadence rc
          WHERE rc.entity_id = cs.entity_id)) AND NOT (EXISTS ( SELECT 1
           FROM entities je
          WHERE je.id = cs.entity_id AND COALESCE((je.metadata ->> 'junk_name_flagged'::text)::boolean, false) = true))
UNION ALL
 SELECT gop.entity_id,
    gop.name,
    gop.workspace_id,
    'gov'::text AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P8'::text AS priority_band,
    'agency_active_solicitations:'::text || gop.sam_active_opportunities AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    gop.sam_active_opportunities AS days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    gop.effective_owner_role,
    gop.owner_role_confidence,
    gop.source_domain,
    gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.sam_active_opportunities IS NOT NULL AND gop.sam_active_opportunities > 0
UNION ALL
 SELECT br.parent_entity_id AS entity_id,
    pe.name,
    pe.workspace_id,
    br.domain AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    'P-BUYER'::text AS priority_band,
    'repeat_buyer_relationship:'::text || br.spe_count AS reason,
    NULL::timestamp with time zone AS next_touch_due,
    br.spe_count::integer AS days_overdue,
    br.last_acquisition_date::timestamp with time zone AS last_touch_at,
    'acquisition'::text AS last_touch_type,
    'buyer'::text AS effective_owner_role,
    NULL::numeric(3,2) AS owner_role_confidence,
    NULL::text AS source_domain,
    NULL::text AS source_property_id
   FROM v_lcc_buyer_parent_rollup br
     JOIN entities pe ON pe.id = br.parent_entity_id AND pe.merged_into_entity_id IS NULL
  WHERE br.spe_count >= 1;

-- The queue is served from a materialized cache; refresh it so it cannot sit
-- stale behind the new view (and so a post-apply measurement of the cache and
-- of the live view agree).
SELECT lcc_refresh_priority_queue_resolved();

-- ============================================================================
-- REVERSAL RUNBOOK
-- ----------------------------------------------------------------------------
-- Restore the role gate by re-running this file's CREATE OR REPLACE VIEW with
-- the `gov_owner_props` WHERE clause changed back to:
--
--     WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text]))
--
-- Nothing else in the body differs.  The exact prior definition is also stored
-- verbatim, so reversal needs no transcription:
--
--     SELECT def FROM public.lcc_c6_view_backup
--      WHERE view_name = 'v_priority_queue_live' AND batch_tag = 'c6_20260829';
--
-- Then re-run:  SELECT lcc_refresh_priority_queue_resolved();
-- ============================================================================
