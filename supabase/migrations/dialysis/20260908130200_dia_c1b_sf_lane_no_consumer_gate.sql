-- ============================================================================
-- C1b — gate true_owner_needs_salesforce `lane_no_consumer` (dia) 2026-09-08
--       (executing C1 §2 / life-command-center
--       docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md)
--
-- Mirrors the existing `owner_needs_sos` gate (already `lane_no_consumer` in
-- this same view) for `true_owner_needs_salesforce`. C1 measured this lane at
-- 27 admitted owners / $21.7M with 0 real completions ever -- its real
-- consumer is the SEPARATE `sf_link_candidate` Decision Center lane, and
-- C1d ships the missing LCC->domain writeback as its own automated unit
-- (`sf-link-reconcile.js` Unit 4) rather than through this research-task lane.
--
-- ⚠️ `gate_value` stays computed (unchanged from the A5c gate) -- re-admitting
-- is one predicate flip on the day this lane grows a real human-worked
-- capture path distinct from C1d's deterministic automation.
--
-- ⚠️ THIS DOES NOT TOUCH THE MEMBERSHIP PROBE (nba-feed-sweep.js,
-- nbaFeedGateFilter('probe') stays ungated) and DOES NOT WIDEN THE GATE to
-- any other dia lane -- property_missing_recorded_owner,
-- property_missing_true_owner, property_missing_county_record and
-- owner_needs_sos (already gated) are all untouched.
--
-- REVERSAL: restore `gate_pass`/`gate_reason` on the
-- true_owner_needs_salesforce arm to the A5c body (drop the
-- `false AS gate_pass` / `'lane_no_consumer'` override below and re-apply the
-- merged_tombstone/placeholder/operator/value CASE).
-- ============================================================================

create or replace view public.v_ownership_gaps as
 SELECT 'property_missing_recorded_owner'::text AS gap_type,
    'property'::text AS entity_kind,
    p.property_id::text AS entity_id,
    (((COALESCE(p.address, ''::text) || ' '::text) || COALESCE(p.city, ''::character varying)::text) || ' '::text) || COALESCE(p.state, ''::character varying)::text AS label,
    COALESCE(p.priority_score, 0) +
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM available_listings al
              WHERE al.property_id = p.property_id AND COALESCE(al.is_active, false))) THEN 50
            ELSE 0
        END AS priority,
    (pv.annual_rent >= dia_research_gate_value_floor()) AS gate_pass,
    CASE WHEN pv.annual_rent IS NULL THEN 'value_unknown'
         WHEN pv.annual_rent < dia_research_gate_value_floor() THEN 'below_value_floor'
         ELSE 'admitted' END AS gate_reason,
    pv.annual_rent AS gate_value
   FROM properties p
   LEFT JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
  WHERE p.recorded_owner_id IS NULL
UNION ALL
 SELECT 'property_missing_true_owner'::text AS gap_type,
    'property'::text AS entity_kind,
    p.property_id::text AS entity_id,
    (COALESCE(p.address, ''::text) || ' '::text) || COALESCE(p.city, ''::character varying)::text AS label,
    COALESCE(p.priority_score, 0) AS priority,
    (pv.annual_rent >= dia_research_gate_value_floor()) AS gate_pass,
    CASE WHEN pv.annual_rent IS NULL THEN 'value_unknown'
         WHEN pv.annual_rent < dia_research_gate_value_floor() THEN 'below_value_floor'
         ELSE 'admitted' END AS gate_reason,
    pv.annual_rent AS gate_value
   FROM properties p
   LEFT JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
  WHERE p.true_owner_id IS NULL AND p.recorded_owner_id IS NOT NULL
UNION ALL
 SELECT 'property_missing_county_record'::text AS gap_type,
    'property'::text AS entity_kind,
    p.property_id::text AS entity_id,
    (COALESCE(p.address, ''::text) || ' '::text) || COALESCE(p.city, ''::character varying)::text AS label,
    COALESCE(p.priority_score, 0) AS priority,
    (pv.annual_rent >= dia_research_gate_value_floor()) AS gate_pass,
    CASE WHEN pv.annual_rent IS NULL THEN 'value_unknown'
         WHEN pv.annual_rent < dia_research_gate_value_floor() THEN 'below_value_floor'
         ELSE 'admitted' END AS gate_reason,
    pv.annual_rent AS gate_value
   FROM properties p
   LEFT JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
  WHERE p.latest_deed_grantee IS NULL AND p.address ~ '\d'::text
UNION ALL
 SELECT 'owner_needs_sos'::text AS gap_type,
    'recorded_owner'::text AS entity_kind,
    ro.recorded_owner_id::text AS entity_id,
    ro.name AS label,
    10 AS priority,
    -- ⚠️ LANE HAS NO CONSUMER. SOS-direct is blocked at the bot-wall
    -- (government-lease CLAUDE.md §25). Always false; the value is still
    -- computed so re-admitting is one predicate change.
    false AS gate_pass,
    'lane_no_consumer'::text AS gate_reason,
    ov.owner_rent AS gate_value
   FROM recorded_owners ro
   LEFT JOIN LATERAL (
      SELECT sum(pv.annual_rent) AS owner_rent
        FROM properties p
        JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
       WHERE p.recorded_owner_id = ro.recorded_owner_id
   ) ov ON true
  WHERE ro.registered_agent_name IS NULL AND ro.name !~* '^(city|county|state|town) of '::text
UNION ALL
 SELECT 'true_owner_needs_salesforce'::text AS gap_type,
    'true_owner'::text AS entity_kind,
    tw.true_owner_id::text AS entity_id,
    tw.name AS label,
    20 AS priority,
    -- C1b: LANE HAS NO CONSUMER OF ITS OWN. C1 measured 27 admitted owners /
    -- $21.7M / 0 real completions ever. The real consumer is the deterministic
    -- LCC->domain writeback shipped as sf-link-reconcile.js Unit 4 (C1d),
    -- which fills dia.true_owners.salesforce_id directly from an already-
    -- resolved, unambiguous LCC-side SF Account link -- not via this
    -- research-task lane. Always false; `gate_value` stays computed so
    -- re-admitting is one predicate flip if a human-worked capture path is
    -- ever built for the residue C1d cannot resolve unambiguously.
    false AS gate_pass,
    'lane_no_consumer'::text AS gate_reason,
    tv.owner_rent AS gate_value
   FROM true_owners tw
   LEFT JOIN LATERAL (
      SELECT count(*) AS n_props, sum(pv.annual_rent) AS owner_rent
        FROM properties p
        LEFT JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
       WHERE p.true_owner_id = tw.true_owner_id
   ) tv ON true
  WHERE tw.salesforce_id IS NULL;

comment on view public.v_ownership_gaps is
  'A5c+C1b (2026-09-08): true_owner_needs_salesforce is gate_pass=false/'
  'lane_no_consumer -- its real consumer is C1d''s deterministic writeback '
  '(sf-link-reconcile.js Unit 4) and the sf_link_candidate Decision Center '
  'lane, not this research-task lane. See '
  'docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md.';

create or replace view public.v_next_best_research as
 SELECT g.gap_type AS research_type,
    g.entity_kind,
    g.entity_id,
    g.label,
    g.priority,
        CASE g.gap_type
            WHEN 'property_missing_recorded_owner'::text THEN ('Pull recorded owner for "'::text || g.label) || '" — county deed / CoStar / RCA'::text
            WHEN 'property_missing_true_owner'::text THEN ('Resolve beneficial owner for "'::text || g.label) || '" — SOS managers / CoStar ownership'::text
            WHEN 'property_missing_county_record'::text THEN ('Pull county deed + assessor + tax-mailing owner for "'::text || g.label) || '"'::text
            WHEN 'owner_needs_sos'::text THEN ('SOS lookup "'::text || g.label) || '" — registered agent, managers/members, filing #'::text
            WHEN 'true_owner_needs_salesforce'::text THEN ('Link or create Salesforce account for "'::text || g.label) || '"'::text
            ELSE ((('Research: '::text || g.gap_type) || ' for "'::text) || g.label) || '"'::text
        END AS instructions,
    'dialysis'::text AS domain,
    COALESCE(g.gate_pass, false) AS gate_pass,
    g.gate_reason,
    g.gate_value
   FROM v_ownership_gaps g
  ORDER BY g.priority DESC, g.gap_type;

comment on view public.v_next_best_research is
'A5c+C1b: carries the producer''s VALUE GATE. `gate_pass` is what the research-task '
'generator''s ranked mint head filters on; `gate_reason` names why a row is '
'excluded (lane_no_consumer / merged_tombstone / placeholder_owner / '
'operator_not_owner / owns_no_property / value_unknown / below_value_floor). '
'true_owner_needs_salesforce and owner_needs_sos are both permanently '
'lane_no_consumer. '
'⚠️ The generator''s membership PROBE must read this view UNGATED — it answers '
'"does the gap still exist", not "is it worth working"; probing the gated view '
'would auto-close every gated-out subject as gap_resolved.';
