-- ============================================================================
-- C1b — gate owner_needs_salesforce `lane_no_consumer` (gov)   2026-09-08
--       (executing C1 §2 / docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md)
--
-- Mirrors the existing `owner_needs_sos` gate (already `lane_no_consumer` in
-- this same view, both before and after C1a) for `owner_needs_salesforce`.
-- C1 measured this lane at 1,675 admitted rows / $4.01B -- 66% of everything
-- the gov producer mints -- with 0 real completions ever and its only
-- consumer being the SEPARATE `sf_link_candidate` Decision Center lane
-- (which the mirror fix in C1a just connected to this gate's own predicate).
-- Minting into a research-task lane that has no capture path and whose real
-- consumer lives elsewhere is exactly the badge-that-is-noise failure the
-- Consumption-Layer doctrine exists to stop (C1 recommendation: "gate 1,702").
--
-- APPLIED AFTER C1a (20260908130100), on purpose: it changes gate_pass on the
-- SAME arm C1a just repointed, and must read C1a's corrected WHERE clause
-- (ro.sf_account_id, not u.sf_account_id) so the population being gated is
-- the real, resized gap -- not the stale unified_contacts-keyed one.
--
-- ⚠️ `gate_value` stays computed (unchanged from C1a) -- re-admitting the
-- lane the day a real consumer exists (or C1d's writeback scope widens to
-- cover it) is one predicate flip, per the owner_needs_sos precedent.
--
-- ⚠️ THIS DOES NOT TOUCH THE MEMBERSHIP PROBE. `nbaFeedGateFilter('probe')`
-- (life-command-center api/_shared/nba-feed-sweep.js) is deliberately UNGATED
-- and reads presence in v_next_best_research regardless of gate_pass -- so a
-- row that leaves the feed (C1a: ro.sf_account_id now set) still lets the
-- probe close the matching open task. Gating admits/mints only.
--
-- ⚠️ THIS DOES NOT WIDEN THE GATE TO ANY OTHER LANE. property_missing_*,
-- owner_needs_sos (already gated) and every other arm are untouched.
--
-- REVERSAL: restore `gate_pass`/`gate_reason` on the owner_needs_salesforce
-- arm to the C1a body (drop the `false AS gate_pass` / `'lane_no_consumer'`
-- override below and re-apply the value/placeholder/public-body CASE).
-- ============================================================================

create or replace view public.v_ownership_gaps as
 SELECT 'property_missing_recorded_owner'::text AS gap_type,
    'property'::text AS entity_kind,
    p.property_id::text AS entity_id,
    (((COALESCE(p.address, ''::text) || ' '::text) || COALESCE(p.city, ''::text)) || ' '::text) || COALESCE(p.state, ''::text) AS label,
    (COALESCE(p.investment_score, 0::numeric) +
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM available_listings al
              WHERE al.property_id = p.property_id AND lower(COALESCE(al.listing_status, 'active'::text)) = 'active'::text)) THEN 50
            ELSE 0
        END::numeric)::integer AS priority,
    (p.gross_rent >= gov_research_gate_value_floor()) AS gate_pass,
    CASE WHEN p.gross_rent IS NULL THEN 'value_unknown'
         WHEN p.gross_rent < gov_research_gate_value_floor() THEN 'below_value_floor'
         ELSE 'admitted' END AS gate_reason,
    p.gross_rent AS gate_value
   FROM properties p
  WHERE p.recorded_owner_id IS NULL
UNION ALL
 SELECT 'property_missing_true_owner'::text AS gap_type,
    'property'::text AS entity_kind,
    p.property_id::text AS entity_id,
    (COALESCE(p.address, ''::text) || ' '::text) || COALESCE(p.city, ''::text) AS label,
    COALESCE(p.investment_score, 0::numeric)::integer AS priority,
    (p.gross_rent >= gov_research_gate_value_floor()) AS gate_pass,
    CASE WHEN p.gross_rent IS NULL THEN 'value_unknown'
         WHEN p.gross_rent < gov_research_gate_value_floor() THEN 'below_value_floor'
         ELSE 'admitted' END AS gate_reason,
    p.gross_rent AS gate_value
   FROM properties p
  WHERE p.true_owner_id IS NULL AND p.recorded_owner_id IS NOT NULL
UNION ALL
 SELECT 'owner_needs_sos'::text AS gap_type,
    'recorded_owner'::text AS entity_kind,
    ro.recorded_owner_id::text AS entity_id,
    ro.name AS label,
    10 AS priority,
    -- LANE HAS NO CONSUMER. SOS-direct is blocked at the bot-wall
    -- (government-lease CLAUDE.md section 25: W9_1_SOS_DIRECT off, every
    -- adapter honest-blocked, the weekly `--apply` schedule DISABLED). A task
    -- nobody can complete is not actionable at any value. `gate_value` is still
    -- computed so re-admitting the lane on the day SOS-direct is unblocked is
    -- one predicate change.
    false AS gate_pass,
    'lane_no_consumer'::text AS gate_reason,
    ov.owner_rent AS gate_value
   FROM recorded_owners ro
   LEFT JOIN LATERAL (
      SELECT sum(p.gross_rent) AS owner_rent
        FROM properties p WHERE p.recorded_owner_id = ro.recorded_owner_id
   ) ov ON true
  WHERE ro.registered_agent_name IS NULL AND NOT is_generic_gov_owner(ro.name)
UNION ALL
 SELECT 'owner_needs_salesforce'::text AS gap_type,
    'unified_entity'::text AS entity_kind,
    u.unified_id::text AS entity_id,
    u.company_name AS label,
    20 AS priority,
    -- C1b: LANE HAS NO CONSUMER OF ITS OWN. The real consumer is the
    -- sf_link_candidate Decision Center lane (source: sf_link_research_queue
    -- -> admin.js verdict path), a DIFFERENT surface entirely -- this
    -- research-task lane has 0 real completions ever (C1 measured all 596
    -- historical closures were the A5a auto-close). Always false; the value
    -- gate below and `gate_value` are still computed so re-admitting is one
    -- predicate flip on the day this lane grows a real capture path.
    false AS gate_pass,
    'lane_no_consumer'::text AS gate_reason,
    ov.owner_rent AS gate_value
   FROM unified_contacts u
   LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = u.recorded_owner_id
   LEFT JOIN LATERAL (
      SELECT count(*) AS n_props, sum(p.gross_rent) AS owner_rent
        FROM properties p WHERE p.recorded_owner_id = u.recorded_owner_id
   ) ov ON true
  -- Unchanged from C1a -- the predicate that makes a row disappear from the
  -- feed the moment recorded_owners.sf_account_id is set (so the probe can
  -- still auto-close a task once the OTHER lane resolves it).
  WHERE u.recorded_owner_id IS NOT NULL AND ro.sf_account_id IS NULL;

comment on view public.v_ownership_gaps is
  'C1a+C1b (2026-09-08): owner_needs_salesforce gates on '
  'recorded_owners.sf_account_id (the column sf_link_candidate actually '
  'writes) and is gate_pass=false/lane_no_consumer -- its real consumer is the '
  'sf_link_candidate Decision Center lane, a different surface. See '
  'docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md.';

create or replace view public.v_next_best_research as
 SELECT gap_type AS research_type,
    entity_kind,
    entity_id,
    label,
    priority,
        CASE gap_type
            WHEN 'property_missing_recorded_owner'::text THEN ('Pull recorded owner for "'::text || label) || '" — GSA lessor / CoStar public record / county deed'::text
            WHEN 'property_missing_true_owner'::text THEN ('Resolve beneficial owner for "'::text || label) || '" — SOS managers / CoStar ownership'::text
            WHEN 'owner_needs_sos'::text THEN ('SOS lookup "'::text || label) || '" — registered agent, managers/members, filing #'::text
            WHEN 'owner_needs_salesforce'::text THEN ('Link or create Salesforce account for "'::text || label) || '"'::text
            ELSE ((('Research: '::text || gap_type) || ' for "'::text) || label) || '"'::text
        END AS instructions,
    'government'::text AS domain,
    COALESCE(g.gate_pass, false) AS gate_pass,
    g.gate_reason,
    g.gate_value
   FROM v_ownership_gaps g
  ORDER BY priority DESC, gap_type;

comment on view public.v_next_best_research is
'A5c/C1a/C1b: carries the producer''s VALUE GATE. `gate_pass` is what the research-task '
'generator''s ranked mint head filters on; `gate_reason` names why a row is '
'excluded (lane_no_consumer / placeholder_owner / public_body_not_prospected / '
'owns_no_property / value_unknown / below_value_floor). owner_needs_salesforce '
'and owner_needs_sos are both permanently lane_no_consumer until a real '
'capture path exists. '
'The generator''s membership PROBE must read this view UNGATED — it answers '
'"does the gap still exist", not "is it worth working"; probing the gated view '
'would auto-close every gated-out subject as gap_resolved.';
