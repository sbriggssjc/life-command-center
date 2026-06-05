-- R6 (2026-06-06): ownership-resolution gating. File 2 of 4 (LCC Opps).
-- Adds the P0.4 "Resolve ownership & control" band AHEAD of P0.5 and gates P0.5
-- ("Needs a BD opportunity opened") to resolution-complete entities only.
--
-- Doctrine: an opportunity is only the next action when the control structure is
-- ALREADY resolved AND connected. Grounding (live LCC Opps, 2026-06-06): of the
-- 402 P0.5 entities only 16 carry ANY Salesforce identity and 0 carry a linked
-- contact — so ~386 are mis-CTA'd ("Open opportunity" where "Resolve owner" is
-- the true next action). After this migration: P0.5 -> the genuinely-ready
-- (connected) entities; the rest move to P0.4. Buyer SPEs continue to leave the
-- band entirely (R5 + R6 tier-0) and roll into P-BUYER.
--
-- The gate = entity-level connection (SF Account identity OR a linked person/
-- contact). It needs NO cross-DB data, so it takes effect immediately on apply.
-- (tier-0 domain-truth resolution enriches context + routes some entities to
-- P-BUYER once the owner-facts mirror is populated by File 3's sync.)
--
-- Full redefinition of v_priority_queue (CREATE OR REPLACE restates the whole
-- view). Every UNION branch preserves the 17-column shape. The only changes vs
-- the R5 def: two new CTEs (connected_entities, entity_primary_property), a
-- connection predicate on the P0.5 branch, and a new P0.4 branch.

BEGIN;

CREATE OR REPLACE VIEW public.v_priority_queue AS
 WITH entity_effective_role AS (
         SELECT entities.id AS entity_id, entities.workspace_id, entities.name, entities.domain,
            COALESCE(entities.behavioral_override, entities.owner_role) AS effective_owner_role,
            entities.owner_role_confidence, entities.developer_status_active_until,
            entities.user_owner_tier, entities.primary_concern
           FROM entities WHERE entities.merged_into_entity_id IS NULL
        ), open_prospect_opps AS (
         SELECT bd_opportunities.entity_id, count(*) AS open_count,
            min(bd_opportunities.opened_at) AS oldest_open_at,
            array_agg(bd_opportunities.owner_user_id) FILTER (WHERE bd_opportunities.owner_user_id IS NOT NULL) AS owner_user_ids,
            array_agg(bd_opportunities.vertical) FILTER (WHERE bd_opportunities.vertical IS NOT NULL) AS verticals
           FROM bd_opportunities
          WHERE bd_opportunities.is_open = true AND bd_opportunities.type = 'prospect'::text
          GROUP BY bd_opportunities.entity_id
        ), cadence_state AS (
         SELECT touchpoint_cadence.entity_id, touchpoint_cadence.contact_id, touchpoint_cadence.owner_user_id,
            touchpoint_cadence.bd_opportunity_id, touchpoint_cadence.phase, touchpoint_cadence.priority_tier,
            touchpoint_cadence.current_touch, touchpoint_cadence.last_touch_at, touchpoint_cadence.next_touch_due,
            touchpoint_cadence.last_touch_type, touchpoint_cadence.domain AS cadence_domain
           FROM touchpoint_cadence
        ), gov_owner_props AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.effective_owner_role, eer.owner_role_confidence,
            f.source_domain, f.source_property_id, a.lease_expiration, a.firm_term_remaining,
            a.term_remaining, a.sam_active_opportunities
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true AND f.source_domain = 'gov'::text
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])
        ), recent_acquirers AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical, eer.effective_owner_role,
            eer.owner_role_confidence, count(*) AS recent_acq_count,
            min(f.ownership_start_date) AS earliest_recent_start, max(f.ownership_start_date) AS latest_recent_start
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text, 'buyer'::text])) AND f.ownership_start_date >= (CURRENT_DATE - '1 year 6 mons'::interval)
          GROUP BY eer.entity_id, eer.name, eer.workspace_id, eer.domain, eer.effective_owner_role, eer.owner_role_confidence
         HAVING count(*) >= 2
        ), aged_props AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.effective_owner_role, eer.owner_role_confidence,
            f.source_domain, f.source_property_id, a.year_built, a.year_renovated
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])) AND a.year_built IS NOT NULL AND a.year_built > 1800 AND a.year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer - 25) AND (a.year_renovated IS NULL OR a.year_renovated <= (EXTRACT(year FROM CURRENT_DATE)::integer - 15))
        ), connected_entities AS (
         -- R6 gate: an owner is "connected" when it carries a Salesforce Account
         -- identity OR a linked person/contact relationship. Resolution-complete.
         SELECT DISTINCT eer.entity_id
           FROM entity_effective_role eer
          WHERE EXISTS (SELECT 1 FROM external_identities ei WHERE ei.entity_id = eer.entity_id AND ei.source_system = 'salesforce'::text)
             OR EXISTS (SELECT 1 FROM entity_relationships er JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type WHERE er.from_entity_id = eer.entity_id)
             OR EXISTS (SELECT 1 FROM entity_relationships er JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type WHERE er.to_entity_id = eer.entity_id)
        ), entity_primary_property AS (
         -- One representative current property per entity (gov preferred, then
         -- highest rent) so a P0.4 row routes into the property resolution ladder.
         SELECT DISTINCT ON (f.entity_id) f.entity_id, f.source_domain, f.source_property_id
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current = true
          ORDER BY f.entity_id, (f.source_domain = 'gov'::text) DESC, f.annual_rent DESC NULLS LAST, f.source_property_id
        )
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P0'::text AS priority_band,
    'developer_overdue'::text AS reason, cs.next_touch_due,
    EXTRACT(day FROM now() - cs.next_touch_due)::integer AS days_overdue,
    cs.last_touch_at, cs.last_touch_type, eer.effective_owner_role, eer.owner_role_confidence,
    NULL::text AS source_domain, NULL::text AS source_property_id
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
     JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
  WHERE eer.effective_owner_role = 'developer'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now()
UNION ALL
 -- R6 P0.4: resolution-incomplete (unconnected) owners — resolve & connect FIRST.
 SELECT eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical,
    NULL::uuid, NULL::uuid, NULL::uuid, 'P0.4'::text, 'resolve_ownership_control'::text,
    NULL::timestamp with time zone, NULL::integer, NULL::timestamp with time zone, NULL::text,
    eer.effective_owner_role, eer.owner_role_confidence, epp.source_domain, epp.source_property_id
   FROM entity_effective_role eer
     LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
     LEFT JOIN entity_primary_property epp ON epp.entity_id = eer.entity_id
  WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text]))
    AND opp.entity_id IS NULL
    AND eer.entity_id NOT IN (SELECT entity_id FROM public.v_lcc_buyer_spe_entities)
    AND eer.entity_id NOT IN (SELECT entity_id FROM connected_entities)
UNION ALL
 -- P0.5 now requires resolution-complete (connected). Buyer SPEs still excluded.
 SELECT eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical,
    NULL::uuid, NULL::uuid, NULL::uuid, 'P0.5'::text, 'open_bd_opportunity_needed'::text,
    NULL::timestamp with time zone, NULL::integer, NULL::timestamp with time zone, NULL::text,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM entity_effective_role eer
     LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
  WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text]))
    AND opp.entity_id IS NULL
    AND eer.entity_id NOT IN (SELECT entity_id FROM public.v_lcc_buyer_spe_entities)
    AND eer.entity_id IN (SELECT entity_id FROM connected_entities)
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P1'::text, 'lease_expiry_24mo'::text, NULL::timestamp with time zone,
    EXTRACT(day FROM gop.lease_expiration::timestamp with time zone - now())::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.lease_expiration IS NOT NULL AND gop.lease_expiration >= CURRENT_DATE AND gop.lease_expiration <= (CURRENT_DATE + '2 years'::interval)::date
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P2'::text, 'firm_term_ending_24mo'::text, NULL::timestamp with time zone, NULL::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.firm_term_remaining IS NOT NULL AND gop.firm_term_remaining > 0::numeric AND gop.firm_term_remaining < 2::numeric
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P3'::text, 'ten_year_window'::text, NULL::timestamp with time zone, NULL::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.term_remaining IS NOT NULL AND gop.term_remaining >= 8::numeric AND gop.term_remaining <= 12::numeric
UNION ALL
 SELECT ra.entity_id, ra.name, ra.workspace_id, ra.vertical, NULL::uuid, NULL::uuid, NULL::uuid,
    'P4'::text, 'recent_acquisition_streak:'::text || ra.recent_acq_count, NULL::timestamp with time zone,
    ra.recent_acq_count::integer, ra.latest_recent_start::timestamp with time zone, 'acquisition'::text,
    ra.effective_owner_role, ra.owner_role_confidence, NULL::text, NULL::text
   FROM recent_acquirers ra
UNION ALL
 SELECT ap.entity_id, ap.name, ap.workspace_id, ap.source_domain AS vertical, NULL::uuid, NULL::uuid, NULL::uuid,
    'P5'::text, 'aged_building_value_add:built_'::text || ap.year_built::text, NULL::timestamp with time zone,
    EXTRACT(year FROM CURRENT_DATE)::integer - ap.year_built, NULL::timestamp with time zone, NULL::text,
    ap.effective_owner_role, ap.owner_role_confidence, ap.source_domain, ap.source_property_id
   FROM aged_props ap
UNION ALL
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P6'::text,
    'onboarding_step_due_'::text || COALESCE(cs.current_touch::text, '0'::text), cs.next_touch_due,
    EXTRACT(day FROM now() - cs.next_touch_due)::integer, cs.last_touch_at, cs.last_touch_type,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
  WHERE cs.phase = 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now()
UNION ALL
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P7'::text, 'steady_state_cadence_due'::text,
    cs.next_touch_due, EXTRACT(day FROM now() - cs.next_touch_due)::integer, cs.last_touch_at, cs.last_touch_type,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
  WHERE COALESCE(cs.phase, 'steady_state'::text) <> 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND NOT (EXISTS ( SELECT 1 FROM open_prospect_opps opp WHERE opp.entity_id = cs.entity_id AND eer.effective_owner_role = 'developer'::text))
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P8'::text, 'agency_active_solicitations:'::text || gop.sam_active_opportunities, NULL::timestamp with time zone,
    gop.sam_active_opportunities, NULL::timestamp with time zone, NULL::text, gop.effective_owner_role,
    gop.owner_role_confidence, gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.sam_active_opportunities IS NOT NULL AND gop.sam_active_opportunities > 0
UNION ALL
 SELECT br.parent_entity_id AS entity_id, pe.name, pe.workspace_id, br.domain AS vertical,
    NULL::uuid, NULL::uuid, NULL::uuid, 'P-BUYER'::text,
    'repeat_buyer_relationship:'::text || br.spe_count, NULL::timestamp with time zone,
    br.spe_count::integer, br.last_acquisition_date::timestamp with time zone, 'acquisition'::text,
    'buyer'::text, NULL::numeric(3,2), NULL::text, NULL::text
   FROM public.v_lcc_buyer_parent_rollup br
     JOIN entities pe ON pe.id = br.parent_entity_id AND pe.merged_into_entity_id IS NULL
  WHERE br.spe_count >= 1;

-- ---------------------------------------------------------------------------
-- Enriched view: append R6 resolution-state columns (append-only — preserves
-- the existing column order/positions for older callers).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS
 SELECT q.entity_id, q.name, q.workspace_id,
        CASE q.vertical WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.vertical END AS vertical,
    q.owner_user_id, q.contact_id, q.bd_opportunity_id, q.priority_band, q.reason, q.next_touch_due,
    q.days_overdue, q.last_touch_at, q.last_touch_type, q.effective_owner_role, q.owner_role_confidence,
    COALESCE(p.total_property_count, 0::bigint) AS total_property_count,
    COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
    COALESCE(p.dia_property_count, 0::bigint) AS dia_property_count,
    COALESCE(p.gov_property_count, 0::bigint) AS gov_property_count,
    COALESCE(p.is_cross_vertical, false) AS is_cross_vertical,
    p.earliest_acquisition_date, p.latest_acquisition_date, p.latest_disposition_date,
    COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
    p.avg_cap_rate,
        CASE q.source_domain WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.source_domain END AS source_domain,
    q.source_property_id, pa.address AS source_property_address, pa.city AS source_property_city,
    pa.state AS source_property_state, pa.lease_expiration AS source_property_lease_expiration,
    pa.firm_term_remaining AS source_property_firm_term_remaining,
    pa.term_remaining AS source_property_term_remaining,
    br.spe_count             AS buyer_spe_count,
    br.rollup_property_count AS buyer_rollup_property_count,
    br.rollup_annual_rent    AS buyer_rollup_annual_rent,
    br.last_acquisition_date AS buyer_last_acquisition_date,
    br.sf_account_id         AS buyer_sf_account_id,
    br.needs_sf_mapping      AS buyer_needs_sf_mapping,
    -- R6 appended columns (resolution context). Computed CHEAPLY per row (no
    -- buyer-parent resolver on this hot path — buyer SPEs aren't in P0.4/P0.5,
    -- and P-BUYER already carries the parent via the buyer_* columns). The full
    -- parent-aware resolution lives in v_lcc_entity_resolution_state.
    rs.resolve_reason,
    rs.true_owner_name AS resolve_true_owner_name,
    rs.is_connected    AS resolve_is_connected
   FROM v_priority_queue q
     LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
     LEFT JOIN public.v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER' AND br.parent_entity_id = q.entity_id
     LEFT JOIN LATERAL (
       SELECT
         tof.true_owner_name,
         conn.is_connected,
         CASE
           WHEN conn.is_connected THEN 'connected'
           WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(q.name)
             THEN 'true_owner_known_connect'
           WHEN public.lcc_is_spe_shell_name(q.name)
             THEN 'recorded_owner_shell_true_owner_unresolved'
           ELSE 'owner_known_connect'
         END AS resolve_reason
       FROM (
         SELECT (
           EXISTS (SELECT 1 FROM external_identities ei WHERE ei.entity_id = q.entity_id AND ei.source_system = 'salesforce')
           OR EXISTS (SELECT 1 FROM entity_relationships er JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person' WHERE er.from_entity_id = q.entity_id)
           OR EXISTS (SELECT 1 FROM entity_relationships er JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person' WHERE er.to_entity_id = q.entity_id)
         ) AS is_connected
       ) conn
       LEFT JOIN LATERAL (
         SELECT pof.true_owner_name
         FROM lcc_entity_portfolio_facts pf
         JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
         WHERE pf.entity_id = q.entity_id AND pf.is_current = true
         ORDER BY pf.ownership_start_date DESC NULLS LAST LIMIT 1
       ) tof ON true
     ) rs ON true
  WHERE q.entity_id IS NOT NULL AND
        CASE q.vertical WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.vertical END IS NOT NULL;

COMMIT;
