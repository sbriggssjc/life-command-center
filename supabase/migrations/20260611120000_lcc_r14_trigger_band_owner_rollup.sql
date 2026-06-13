-- ============================================================================
-- R14 — roll the property-trigger bands up to the owner (hybrid card)
-- ----------------------------------------------------------------------------
-- The priority queue mixes two grains. Relationship bands
-- (P0.4/P0.5/P-CONTACT/P-BUYER/P6/P7) are one row per OWNER. The four
-- property-trigger bands fan out one row per PROPERTY, so a multi-property
-- owner floods the queue (Wise Developments LLC: P1=8, P3=7, P8=3; Truist
-- Bank: P5=8). The queue unit is the NEXT ACTION, and the next action on a
-- trigger is ONE owner-level outreach ("several of your buildings have leases
-- rolling in <=24mo"), not N separate touches.
--
-- P-BUYER already solved exactly this: one card per parent with a rolled-up
-- portfolio (count + rollup rent) and the per-SPE detail reachable on drill.
-- R14 applies the SAME pattern to the four trigger bands:
--
--   band  reason                            per-property fact
--   P1    lease_expiry_24mo                 a lease expiring <=24mo
--   P3    ten_year_window                   ~10yr lease term remaining
--   P5    aged_building_value_add:built_Y   aged building
--   P8    agency_active_solicitations:N     gov agency active SAM solicitations
--
-- What changes:
--   * v_lcc_trigger_band_properties (NEW) — the per-property trigger rows
--     (the OLD grain) with the band fact, the property's rent (for the SUM),
--     and an urgency sort key. Single source of truth for BOTH the collapse
--     and the drill-down (mirrors how v_lcc_buyer_parent_rollup feeds P-BUYER).
--   * v_priority_queue_live — the four per-property trigger arms collapse to
--     ONE arm that emits one row per (entity, band, source_domain) via
--     DISTINCT ON, carrying the MOST URGENT property as the representative
--     (its source_property_id / reason / days_overdue). P2 stays per-property
--     (out of R14 scope, by the doctrine). Relationship bands are byte-
--     identical — only the trigger arms changed.
--   * v_lcc_trigger_band_rollup (NEW) — count + SUM(rent) per (entity, band,
--     domain); joined by v_priority_queue_enriched to surface the rollup and
--     to make rank_annual_rent the portfolio SUM for the band (so big owners
--     surface highest, the rank stays honest).
--   * lcc_trigger_band_properties(entity, band[, domain]) (NEW) — the fan-out
--     the card drills into (property_id, address, fact, rent), urgency-ordered.
--   * lcc_priority_queue_resolved (cache) — re-materialized from the updated
--     live view. The grain change is automatic (fewer rows for P1/P3/P5/P8);
--     the 17-col shape is unchanged, so the cache table + the */5 cron are
--     untouched. The trigger_* rollup columns live in the ENRICHED view (the
--     append-only join), exactly like P-BUYER's buyer_* columns — NOT in the
--     cache.
--
-- DB-safety: views + one STABLE function + a cache refresh. Cache-or-live safe
-- (empty cache => exact live computation), so DB-vs-Railway deploy order is
-- irrelevant. No table rewrites, no locks on auth/GoTrue, bounded-size work.
-- ============================================================================

-- 1. Base view: the per-property trigger rows (the OLD grain). One row per
--    (owner, property, band) where the trigger predicate holds. Predicates are
--    byte-identical to the gov_owner_props (P1/P3/P8) and aged_props (P5) arms
--    they replace. `rank_rent` is the property's own annual rent (what the
--    rollup SUMs). `urgency_key` is built so ASC = most urgent first.
CREATE OR REPLACE VIEW public.v_lcc_trigger_band_properties AS
WITH eer AS (
  SELECT e.id AS entity_id,
         e.name,
         e.workspace_id,
         COALESCE(e.behavioral_override, e.owner_role) AS effective_owner_role,
         e.owner_role_confidence
  FROM entities e
  WHERE e.merged_into_entity_id IS NULL
    AND COALESCE(e.behavioral_override, e.owner_role) = ANY (ARRAY['developer'::text, 'user_owner'::text])
),
props AS (
  SELECT eer.entity_id,
         eer.name,
         eer.workspace_id,
         eer.effective_owner_role,
         eer.owner_role_confidence,
         f.source_domain,
         f.source_property_id,
         a.lease_expiration,
         a.term_remaining,
         a.year_built,
         a.year_renovated,
         a.sam_active_opportunities,
         a.annual_rent
  FROM eer
    JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
    JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
)
-- P1 — lease expiring within 24 months (gov)
SELECT entity_id, name, workspace_id, effective_owner_role, owner_role_confidence,
       source_domain, source_property_id,
       'P1'::text AS priority_band,
       'lease_expiry_24mo'::text AS reason,
       EXTRACT(day FROM lease_expiration::timestamp with time zone - now())::integer AS days_overdue,
       annual_rent AS rank_rent,
       EXTRACT(epoch FROM lease_expiration::timestamp with time zone)::numeric AS urgency_key,
       to_char(lease_expiration::timestamp, 'Mon YYYY') AS trigger_fact
FROM props
WHERE source_domain = 'gov'::text
  AND lease_expiration IS NOT NULL
  AND lease_expiration >= CURRENT_DATE
  AND lease_expiration <= (CURRENT_DATE + '2 years'::interval)::date
UNION ALL
-- P3 — ~10yr lease term remaining (gov)
SELECT entity_id, name, workspace_id, effective_owner_role, owner_role_confidence,
       source_domain, source_property_id,
       'P3'::text,
       'ten_year_window'::text,
       NULL::integer AS days_overdue,
       annual_rent,
       abs(term_remaining - 10::numeric) AS urgency_key,
       round(term_remaining, 1)::text || ' yr term left' AS trigger_fact
FROM props
WHERE source_domain = 'gov'::text
  AND term_remaining IS NOT NULL
  AND term_remaining >= 8::numeric
  AND term_remaining <= 12::numeric
UNION ALL
-- P5 — aged building value-add (cross-domain)
SELECT entity_id, name, workspace_id, effective_owner_role, owner_role_confidence,
       source_domain, source_property_id,
       'P5'::text,
       'aged_building_value_add:built_'::text || year_built::text,
       (EXTRACT(year FROM CURRENT_DATE)::integer - year_built) AS days_overdue,
       annual_rent,
       year_built::numeric AS urgency_key,
       'built ' || year_built::text AS trigger_fact
FROM props
WHERE year_built IS NOT NULL
  AND year_built > 1800
  AND year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer - 25)
  AND (year_renovated IS NULL OR year_renovated <= (EXTRACT(year FROM CURRENT_DATE)::integer - 15))
UNION ALL
-- P8 — gov agency active SAM solicitations (gov)
SELECT entity_id, name, workspace_id, effective_owner_role, owner_role_confidence,
       source_domain, source_property_id,
       'P8'::text,
       'agency_active_solicitations:'::text || sam_active_opportunities,
       sam_active_opportunities AS days_overdue,
       annual_rent,
       (- sam_active_opportunities)::numeric AS urgency_key,
       sam_active_opportunities::text || ' active solicitation' || CASE WHEN sam_active_opportunities = 1 THEN '' ELSE 's' END AS trigger_fact
FROM props
WHERE sam_active_opportunities IS NOT NULL
  AND sam_active_opportunities > 0;

-- 2. Rollup: count + SUM(rent) per (entity, band, domain). The enriched view
--    joins this for the trigger_* columns + the band-portfolio rank value.
CREATE OR REPLACE VIEW public.v_lcc_trigger_band_rollup AS
SELECT entity_id,
       priority_band,
       source_domain,
       count(*)::bigint AS trigger_property_count,
       COALESCE(sum(rank_rent), 0::numeric) AS trigger_rollup_annual_rent
FROM public.v_lcc_trigger_band_properties
GROUP BY entity_id, priority_band, source_domain;

-- 3. Fan-out function the card drills into: the owner's properties in this band
--    (and optionally one domain), urgency-ordered. Mirrors the P-BUYER cohort
--    functions (lcc_listing_*). STABLE, name-keyed lookups.
CREATE OR REPLACE FUNCTION public.lcc_trigger_band_properties(
  p_entity_id uuid,
  p_band text,
  p_domain text DEFAULT NULL
)
RETURNS TABLE(
  source_domain text,
  source_property_id text,
  address text,
  city text,
  state text,
  trigger_fact text,
  days_metric integer,
  annual_rent numeric
)
LANGUAGE sql
STABLE
AS $fn$
  SELECT tb.source_domain,
         tb.source_property_id,
         a.address,
         a.city,
         a.state,
         tb.trigger_fact,
         tb.days_overdue AS days_metric,
         tb.rank_rent AS annual_rent
  FROM public.v_lcc_trigger_band_properties tb
    LEFT JOIN public.lcc_property_attributes a
      ON a.source_domain = tb.source_domain
     AND a.source_property_id = tb.source_property_id
  WHERE tb.entity_id = p_entity_id
    AND tb.priority_band = p_band
    AND (p_domain IS NULL OR tb.source_domain = p_domain)
  ORDER BY tb.urgency_key, tb.source_property_id;
$fn$;

-- 4. Rewrite v_priority_queue_live: the four per-property trigger arms collapse
--    to ONE arm (DISTINCT ON the representative). Everything else (P0/P0.4/P0.5/
--    P2/P4/P6/P7/P-CONTACT/P-BUYER) is byte-identical to the prior definition.
--    The aged_props CTE (P5's only feeder) is dropped — its rows now come from
--    the base view's P5 branch.
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
        ), reachable_cadence AS (
         SELECT cs.entity_id
           FROM cadence_state cs
          WHERE cs.entity_id IS NOT NULL AND (cs.sf_contact_id IS NOT NULL OR cs.contact_id IS NOT NULL OR (cs.entity_id IN ( SELECT connected_entities.entity_id
                   FROM connected_entities)))
        ), entity_primary_property AS (
         SELECT DISTINCT ON (f.entity_id) f.entity_id,
            f.source_domain,
            f.source_property_id
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current = true
          ORDER BY f.entity_id, (f.source_domain = 'gov'::text) DESC, f.annual_rent DESC NULLS LAST, f.source_property_id
        )
 SELECT cs.entity_id,
    eer.name,
    eer.workspace_id,
    COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id,
    cs.contact_id,
    cs.bd_opportunity_id,
    'P0'::text AS priority_band,
    'developer_overdue'::text AS reason,
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
     JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
  WHERE eer.effective_owner_role = 'developer'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND (cs.entity_id IN ( SELECT reachable_cadence.entity_id
           FROM reachable_cadence))
UNION ALL
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
-- R14: the four property-trigger bands (P1/P3/P5/P8), collapsed to ONE row per
-- (entity, band, source_domain) — the MOST URGENT property is the representative
-- (its source_property_id / reason / days_overdue ride the card). The count +
-- rollup rent are added by v_priority_queue_enriched (the P-BUYER pattern). The
-- DISTINCT ON arm carries its own ORDER BY, so it must be parenthesized inside
-- the UNION.
 (SELECT DISTINCT ON (tb.entity_id, tb.priority_band, tb.source_domain)
    tb.entity_id,
    tb.name,
    tb.workspace_id,
    tb.source_domain AS vertical,
    NULL::uuid AS owner_user_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS bd_opportunity_id,
    tb.priority_band,
    tb.reason,
    NULL::timestamp with time zone AS next_touch_due,
    tb.days_overdue,
    NULL::timestamp with time zone AS last_touch_at,
    NULL::text AS last_touch_type,
    tb.effective_owner_role,
    tb.owner_role_confidence,
    tb.source_domain,
    tb.source_property_id
   FROM v_lcc_trigger_band_properties tb
  ORDER BY tb.entity_id, tb.priority_band, tb.source_domain, tb.urgency_key, tb.source_property_id)
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
 SELECT cs.entity_id,
    eer.name,
    eer.workspace_id,
    COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id,
    cs.contact_id,
    cs.bd_opportunity_id,
    'P6'::text AS priority_band,
    'onboarding_step_due_'::text || COALESCE(cs.current_touch::text, '0'::text) AS reason,
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
  WHERE cs.phase = 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND (cs.entity_id IN ( SELECT reachable_cadence.entity_id
           FROM reachable_cadence))
UNION ALL
 SELECT cs.entity_id,
    eer.name,
    eer.workspace_id,
    COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id,
    cs.contact_id,
    cs.bd_opportunity_id,
    'P7'::text AS priority_band,
    'steady_state_cadence_due'::text AS reason,
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
  WHERE COALESCE(cs.phase, 'steady_state'::text) <> 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND (cs.entity_id IN ( SELECT reachable_cadence.entity_id
           FROM reachable_cadence)) AND NOT (EXISTS ( SELECT 1
           FROM open_prospect_opps opp
          WHERE opp.entity_id = cs.entity_id AND eer.effective_owner_role = 'developer'::text))
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
          WHERE rc.entity_id = cs.entity_id))
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

-- 5. v_priority_queue_enriched — append the trigger_* rollup columns at the END
--    (append-only rule), join the rollup, and make rank_annual_rent the band
--    portfolio SUM for trigger rows (NULLIF(trigger_rollup,0) FIRST in the
--    coalesce — relationship bands fall through to the unchanged behavior).
--    trigger_top_fact is derived from the representative property's attributes
--    (pa), so the card needs no reason-parsing and no per-row LATERAL.
CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS
 SELECT q.entity_id,
    q.name,
    q.workspace_id,
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END AS vertical,
    q.owner_user_id,
    q.contact_id,
    q.bd_opportunity_id,
    q.priority_band,
    q.reason,
    q.next_touch_due,
    q.days_overdue,
    q.last_touch_at,
    q.last_touch_type,
    q.effective_owner_role,
    q.owner_role_confidence,
    COALESCE(p.total_property_count, 0::bigint) AS total_property_count,
    COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
    COALESCE(p.dia_property_count, 0::bigint) AS dia_property_count,
    COALESCE(p.gov_property_count, 0::bigint) AS gov_property_count,
    COALESCE(p.is_cross_vertical, false) AS is_cross_vertical,
    p.earliest_acquisition_date,
    p.latest_acquisition_date,
    p.latest_disposition_date,
    COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
    p.avg_cap_rate,
        CASE q.source_domain
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.source_domain
        END AS source_domain,
    q.source_property_id,
    pa.address AS source_property_address,
    pa.city AS source_property_city,
    pa.state AS source_property_state,
    pa.lease_expiration AS source_property_lease_expiration,
    pa.firm_term_remaining AS source_property_firm_term_remaining,
    pa.term_remaining AS source_property_term_remaining,
    br.spe_count AS buyer_spe_count,
    br.rollup_property_count AS buyer_rollup_property_count,
    br.rollup_annual_rent AS buyer_rollup_annual_rent,
    br.last_acquisition_date AS buyer_last_acquisition_date,
    br.sf_account_id AS buyer_sf_account_id,
    br.needs_sf_mapping AS buyer_needs_sf_mapping,
    rs.resolve_reason,
    rs.true_owner_name AS resolve_true_owner_name,
    rs.is_connected AS resolve_is_connected,
    pa.annual_rent AS source_property_rent,
    pa.noi AS source_property_noi,
    COALESCE(NULLIF(tr.trigger_rollup_annual_rent, 0::numeric), NULLIF(COALESCE(p.current_annual_rent_total, 0::numeric), 0::numeric), NULLIF(pa.annual_rent, 0::numeric), NULLIF(br.rollup_annual_rent, 0::numeric)) AS rank_annual_rent,
    -- R14 trigger rollup (P1/P3/P5/P8 only; NULL on every other band)
    tr.trigger_property_count,
    tr.trigger_rollup_annual_rent,
        CASE q.priority_band
            WHEN 'P1'::text THEN
                CASE WHEN pa.lease_expiration IS NOT NULL THEN to_char(pa.lease_expiration::timestamp, 'Mon YYYY') ELSE NULL::text END
            WHEN 'P3'::text THEN
                CASE WHEN pa.term_remaining IS NOT NULL THEN round(pa.term_remaining, 1)::text || ' yr term left' ELSE NULL::text END
            WHEN 'P5'::text THEN
                CASE WHEN pa.year_built IS NOT NULL THEN 'built '::text || pa.year_built::text ELSE NULL::text END
            WHEN 'P8'::text THEN
                CASE WHEN pa.sam_active_opportunities IS NOT NULL THEN pa.sam_active_opportunities::text || ' active solicitation'::text || CASE WHEN pa.sam_active_opportunities = 1 THEN ''::text ELSE 's'::text END ELSE NULL::text END
            ELSE NULL::text
        END AS trigger_top_fact
   FROM v_priority_queue q
     LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
     LEFT JOIN v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER'::text AND br.parent_entity_id = q.entity_id
     LEFT JOIN v_lcc_trigger_band_rollup tr ON q.priority_band = ANY (ARRAY['P1'::text, 'P3'::text, 'P5'::text, 'P8'::text]) AND tr.entity_id = q.entity_id AND tr.priority_band = q.priority_band AND tr.source_domain = q.source_domain
     LEFT JOIN LATERAL ( SELECT tof.true_owner_name,
            conn.is_connected,
                CASE
                    WHEN conn.is_connected THEN 'connected'::text
                    WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(q.name) THEN 'true_owner_known_connect'::text
                    WHEN lcc_is_spe_shell_name(q.name) THEN 'recorded_owner_shell_true_owner_unresolved'::text
                    ELSE 'owner_known_connect'::text
                END AS resolve_reason
           FROM ( SELECT (EXISTS ( SELECT 1
                           FROM external_identities ei
                          WHERE ei.entity_id = q.entity_id AND ei.source_system = 'salesforce'::text)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.from_entity_id = q.entity_id)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.to_entity_id = q.entity_id)) AS is_connected) conn
             LEFT JOIN LATERAL ( SELECT pof.true_owner_name
                   FROM lcc_entity_portfolio_facts pf
                     JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
                  WHERE pf.entity_id = q.entity_id AND pf.is_current = true
                  ORDER BY pf.ownership_start_date DESC NULLS LAST
                 LIMIT 1) tof ON true) rs ON true
  WHERE q.entity_id IS NOT NULL AND
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END IS NOT NULL;

-- 6. Re-materialize the cache from the updated live view. The grain change for
--    P1/P3/P5/P8 (fewer rows) lands immediately; the */5 cron keeps it fresh.
SELECT public.lcc_refresh_priority_queue_resolved();
