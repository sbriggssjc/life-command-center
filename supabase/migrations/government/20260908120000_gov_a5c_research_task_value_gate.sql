-- ============================================================================
-- A5c — VALUE-GATE THE RESEARCH-TASK PRODUCER (gov)          2026-08-27
--
-- Sibling of supabase/migrations/dialysis/20260908120000_dia_a5c_*.sql; read
-- that header for the full rationale and the seven rules. gov-specific notes:
--
--   * NO OPERATOR ARM, AND THAT IS DELIBERATE. dia files the TENANT in the
--     owner slot at scale (P113 — 7,926 of 11,783 dia properties point at an
--     `is_operator_not_owner` row). gov has no such conflation: the tenant is a
--     federal agency, and `v_property_owner_facts_portfolio.true_owner_is_operator`
--     returns constant false on this side. Adding an operator arm here would be
--     a predicate that can never fire — noise, not safety.
--
--   * `is_generic_gov_owner` IS the public-body guard and it is applied to the
--     SF arm as `public_body_not_prospected` (the P131 precedent: a municipality
--     is not a prospect). Measured 2026-08-27 it fires on **0** rows of that
--     lane — reported as measured rather than dropped, because it discriminates
--     elsewhere (it already gates the SOS arm's WHERE clause).
--
--   * VALUE IS `properties.gross_rent` — the rent the government pays the
--     lessor, already the canonical gov rent everywhere else in this repo.
--     Per OWNER (summed across the owner's properties) on the owner-keyed arm,
--     per property on the property-keyed arms.
--
--   * ⚠️ THE STALE-HUB SUSPICION WAS CHECKED AND REFUTED. `unified_contacts` on
--     gov is the pre-cutover snapshot (`CONTACTS_HUB=ops`): 30,714 rows, 5
--     updated in 7 days. So "no `sf_account_id`" could have been a stale
--     verdict about a link made on the live hub after the 2026-08-17 cutover.
--     Sampled 40 admitted subjects against LCC Opps `unified_contacts`:
--     **40 of 40 exist there and 0 carry an sf_account_id.** The gap is real.
--     Measured, not assumed.
--
-- MEASURED EFFECT (gov, 2026-08-27, before -> after):
--   property_missing_recorded_owner 11,180 -> 656     property_missing_true_owner 28 -> 1
--   owner_needs_salesforce          13,724 -> 1,675   owner_needs_sos          16,873 -> 0
--   gov pool 41,805 -> 2,332 admitted (5.6%). Row count unchanged (no join fan-out).
--
-- PERFORMANCE, measured both directions (the two reads have different shapes):
--   ranked mint head, gated  1,149 ms -> 591 ms   (FASTER: the constant-false SOS
--                                                  arm is pruned and the sort set
--                                                  drops 41,805 -> 2,332)
--   membership probe, ungated   44 ms ->  51 ms   (the gate's LATERAL aggregates
--                                                  report `never executed` — the
--                                                  id predicate still pushes into
--                                                  every UNION arm)
--
-- REVERSAL: re-apply the previous bodies of both views (CREATE OR REPLACE, no
-- data touched) and drop the two functions; revert the JS in the same step.
-- ============================================================================

create or replace function public.gov_research_gate_value_floor()
returns numeric language sql immutable
set search_path to 'public','pg_temp'
as $$ select 500000::numeric $$;

comment on function public.gov_research_gate_value_floor() is
'A5c: the annual-rent floor a research-task subject must clear to be emitted. '
'$500k — deliberately the SAME number as the gov asset-mint floor, '
'CADENCE_SIGNAL_MIN_VALUE and P161''s weak-role floor. One knob, one place.';

-- NARROW and SCOPED TO THIS GATE. Delegates the general question to the
-- existing gov_is_strong_junk_owner_name (verified on named rows: it already
-- catches Unknown / N/A / Various / Undisclosed / TBD / None) and adds only the
-- anchored literals it was measured NOT to catch. Blast radius over every live
-- gov owner name and company_name: 1 row (`John Doe`, a genuine placeholder),
-- 0 real firms. Do not export into the shared junk guards.
create or replace function public.gov_research_gate_is_placeholder_owner(p_name text)
returns boolean language plpgsql immutable
set search_path to 'public','extensions','pg_temp'
as $$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN true; END IF;
  n := lower(btrim(p_name));
  IF n = '' THEN RETURN true; END IF;
  IF gov_is_strong_junk_owner_name(p_name) THEN RETURN true; END IF;
  IF n IN ('independent','other','state owned','multiple','current owner',
           'recorded owner','the owner','no owner','not applicable',
           'see above','same','john doe','jane doe') THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

comment on function public.gov_research_gate_is_placeholder_owner(text) is
'A5c: narrow placeholder-name gate for the research-task producer ONLY. '
'Scoped to this gate on purpose — do not export into the shared junk guards, '
'where a false positive is destructive.';

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
    (NOT gov_research_gate_is_placeholder_owner(COALESCE(u.company_name, ro.name))
     AND NOT is_generic_gov_owner(COALESCE(ro.name, u.company_name))
     AND COALESCE(ov.n_props, 0) > 0
     AND ov.owner_rent >= gov_research_gate_value_floor()) AS gate_pass,
    CASE
      WHEN gov_research_gate_is_placeholder_owner(COALESCE(u.company_name, ro.name)) THEN 'placeholder_owner'
      WHEN is_generic_gov_owner(COALESCE(ro.name, u.company_name)) THEN 'public_body_not_prospected'
      WHEN COALESCE(ov.n_props, 0) = 0 THEN 'owns_no_property'
      WHEN ov.owner_rent IS NULL THEN 'value_unknown'
      WHEN ov.owner_rent < gov_research_gate_value_floor() THEN 'below_value_floor'
      ELSE 'admitted' END AS gate_reason,
    ov.owner_rent AS gate_value
   FROM unified_contacts u
   LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = u.recorded_owner_id
   LEFT JOIN LATERAL (
      SELECT count(*) AS n_props, sum(p.gross_rent) AS owner_rent
        FROM properties p WHERE p.recorded_owner_id = u.recorded_owner_id
   ) ov ON true
  WHERE u.recorded_owner_id IS NOT NULL AND u.sf_account_id IS NULL;

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
'A5c: carries the producer''s VALUE GATE. `gate_pass` is what the research-task '
'generator''s ranked mint head filters on; `gate_reason` names why a row is '
'excluded (lane_no_consumer / placeholder_owner / public_body_not_prospected / '
'owns_no_property / value_unknown / below_value_floor). '
'The generator''s membership PROBE must read this view UNGATED — it answers '
'"does the gap still exist", not "is it worth working"; probing the gated view '
'would auto-close every gated-out subject as gap_resolved.';
