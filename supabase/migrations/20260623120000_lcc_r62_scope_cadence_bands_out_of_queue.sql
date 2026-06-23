-- ============================================================================
-- R62 — scope cadence-due bands out of the Priority Queue (2026-06-23)
-- ----------------------------------------------------------------------------
-- The Priority Queue is BD PURSUIT (open opportunities, buyers, resolve
-- ownership/contact). Outreach CADENCE is owned by the dedicated, value-ranked
-- Cadence Dashboard (R34, v_bd_cadence_dashboard — every active cadence, no
-- phase filter). Three cadence-TOUCH bands duplicated that surface as unranked
-- rows bloating the BD queue (live: P7 steady_state_cadence_due = 602 rows,
-- 99.6% rank-zero; P6 onboarding_step_due = 1; P0 developer_overdue = 0):
--
--   P0  developer_overdue        (cadence touch)  → REMOVE
--   P6  onboarding_step_due       (cadence touch)  → REMOVE
--   P7  steady_state_cadence_due  (cadence touch)  → REMOVE
--
-- This migration DROPS those three UNION branches from v_priority_queue_live.
-- Nothing else changes — every other band's predicate is byte-identical to the
-- live definition (verified pre/post by an md5 of each band's ordered
-- entity_id set). The cadences themselves are untouched: they still exist,
-- still advance, and still surface on the Cadence Dashboard — they are simply
-- no longer mirrored into the BD queue.
--
-- KEPT IN THE QUEUE:
--   P0.4  resolve_ownership_control       (connect-work)
--   P0.5  open_bd_opportunity_needed
--   P1/P2/P3  gov lease/firm/10-yr triggers
--   P4    recent_acquisition_streak
--   P5    aged_building_value_add
--   P8    agency_active_solicitations
--   P-CONTACT  select_prospecting_contact (connect-work: pick who to contact
--              — a queue action that unblocks the cadence, NOT an outreach touch)
--   P-BUYER    repeat_buyer_relationship
--
-- All CTEs are RETAINED unchanged: reachable_cadence (and its feeders
-- person_connected_entities / self_contactable_person_entities / cadence_state)
-- is still consumed by the P-CONTACT branch; open_prospect_opps is still
-- consumed by P0.4 / P0.5.
--
-- Cache-or-live safe (R7 Phase 0 pattern): the view body is the source the
-- materialized cache (lcc_priority_queue_resolved) is rebuilt from, so the
-- migration ends by refreshing the cache; v_priority_queue_band_counts and
-- v_priority_queue_enriched read v_priority_queue by name and inherit the change
-- with no edit of their own. Apply on LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSIBILITY: re-add the three removed UNION-ALL branches (the
-- developer_overdue / onboarding_step_due / steady_state_cadence_due selects
-- from cadence_state — preserved in migration 20260719124000) and re-refresh
-- the cache → the bands return.
-- ============================================================================

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
          WHERE eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])
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
         SELECT DISTINCT eer.entity_id
           FROM entity_effective_role eer
          WHERE (EXISTS ( SELECT 1
                   FROM external_identities ei
                  WHERE ei.entity_id = eer.entity_id AND ei.source_system = 'salesforce'::text)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.from_entity_id = eer.entity_id)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.to_entity_id = eer.entity_id))
        ), person_connected_entities AS (
         SELECT DISTINCT eer.entity_id
           FROM entity_effective_role eer
          WHERE (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.from_entity_id = eer.entity_id)) OR (EXISTS ( SELECT 1
                   FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                  WHERE er.to_entity_id = eer.entity_id))
        ), self_contactable_person_entities AS (
         SELECT eer.entity_id
           FROM entity_effective_role eer
             JOIN entities e ON e.id = eer.entity_id
          WHERE e.entity_type = 'person'::entity_type AND (NULLIF(btrim(e.email), ''::text) IS NOT NULL OR NULLIF(btrim(e.phone), ''::text) IS NOT NULL) AND COALESCE((e.metadata ->> 'junk_name_flagged'::text)::boolean, false) = false AND COALESCE((e.metadata ->> 'orphan_flagged'::text)::boolean, false) = false AND char_length(btrim(e.name)) >= 3 AND char_length(btrim(e.name)) <= 60 AND e.name !~ '[0-9]'::text AND array_length(regexp_split_to_array(btrim(e.name), '\s+'::text), 1) >= 2 AND array_length(regexp_split_to_array(btrim(e.name), '\s+'::text), 1) <= 5 AND e.name !~* '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y'::text
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

-- Refresh the materialized queue cache so the dropped bands disappear
-- immediately (rather than waiting the */5 cron). Safe in a migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_refresh_priority_queue_resolved') THEN
    PERFORM public.lcc_refresh_priority_queue_resolved();
  END IF;
END $$;
