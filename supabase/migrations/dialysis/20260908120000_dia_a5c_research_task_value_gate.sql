-- ============================================================================
-- A5c — VALUE-GATE THE RESEARCH-TASK PRODUCER (dia)          2026-08-27
--
-- A5a fixed the producer's truncated-feed auto-close and, in doing so, showed
-- what a CORRECT producer emits: `would_insert` = 1,000 gov + 1,586 dia on one
-- `limit=2000` run, with cron 35 firing every 30 minutes and 69,448 gap rows
-- that had never had a task. That is a producer with no value gate, and the
-- population is mostly worthless — measured on the dia
-- `true_owner_needs_salesforce` lane: 5,239 of 6,324 owners hold ZERO
-- properties, and operators + literal placeholders carry 5,364 of the 6,442
-- properties (the documented P113 tenant-in-the-owner-slot trap at scale).
--
-- Minting 6,324 items so an operator can find the few that matter is the
-- badge-that-is-noise failure the Consumption-Layer doctrine exists to stop.
--
-- ⚠️ THE GATE IS IN THE SELECTION, NOT IN A SURFACE FILTER. It is appended to
-- `v_ownership_gaps` (where each arm's own facts live) and passed through
-- `v_next_best_research`, so the producer's RANKED HEAD is drawn from the
-- admitted population. A downstream filter would still pay to mint, would let
-- the head fill with rows nobody can work, and would let the badge lie.
--
-- ⚠️ AND THE MEMBERSHIP PROBE MUST NOT READ IT. `handleGenerateResearchTasks`
-- settles its auto-close by asking the feed whether each open subject is still
-- a gap. That question is "does the gap still exist", NOT "is it worth
-- working". A probe that filtered on the gate would find every gated-out
-- subject absent and close it as `gap_resolved` — a second false claim of
-- exactly the kind A5a removed. The JS keeps the two reads apart and
-- `test/nba-feed-value-gate.test.mjs` pins the asymmetry.
--
-- THE RULES ENCODED HERE
--   1. OPERATORS ARE EXCLUDED BY RECORDED FACT, NEVER BY A NAME TEST. P113 is
--      explicit: a second name-based operator test drifts from the first and
--      the panel and the feeder then disagree. Three recorded facts are read —
--      `is_operator_not_owner`, `owner_type='operator'`, `owner_role='operator'`.
--      Measured 2026-08-27: the flag alone catches 25 owners / 4,343 properties;
--      all three together catch 36 / 4,479. The extra 11 are Kaiser Permanente,
--      Mayo Clinic Dialysis, Atlantis Healthcare Group, Wake Forest University…
--      — real operators the flag has never been set on. That is a gap in the
--      flag, filed as backlog, NOT a licence to add a name test.
--   2. PLACEHOLDERS REUSE THE EXISTING GUARD. `dia_is_strong_junk_owner_name`
--      already catches Unknown / N/A / Various / Undisclosed / TBD / None. It
--      does NOT catch `Independent` (754 properties), `Other` (110) or
--      `State Owned` (20) — measured, not assumed — so this gate adds a NARROW,
--      ANCHORED, EXACT-MATCH extension scoped to itself (the
--      `lcc_p131_is_document_row_label` precedent). Blast radius measured over
--      every live owner name BEFORE shipping: 3 `true_owners` + 3
--      `recorded_owners`, all three of them genuine placeholders, ZERO real
--      firms. It is deliberately not exported into the shared junk guards,
--      where a false positive is destructive.
--   3. VALUE IS THE CANONICAL RENT, NOT A NEW ONE. `annual_rent` on
--      `v_property_attributes_portfolio` is the figure LCC already consumes as
--      truth (`proj.rent_now` — a confirmed anchor or lease rent, projected to
--      today). `properties.last_known_rent` / `.rent_imputed` would admit more
--      rows and would be a SECOND definition of value that drifts from the
--      panel's. One definition, even when it is the thinner one.
--   4. VALUE IS PER OWNER on an owner-keyed arm — summed across the owner's
--      properties — and per property on a property-keyed arm. Never per task.
--   5. ⚠️ UNKNOWN IS NOT SMALL. A null rent is `value_unknown` and is GATED,
--      never admitted through the floor (P161 measured this exact trade and
--      gated it). It is a named bucket, not silent loss: dia rent coverage is
--      4,154 of 11,796 properties (35%), so `value_unknown` is large and is
--      the real constraint on this lane — filed as backlog A5e, not papered
--      over by loosening the floor.
--   6. THE FLOOR IS THE EXISTING KNOB. $500k — the same number as the gov
--      asset-mint floor, `CADENCE_SIGNAL_MIN_VALUE` and P161's weak-role floor.
--      One function so there is one place to change it.
--   7. A LANE WITH NO CONSUMER EMITS NOTHING. `owner_needs_sos` (dia 7,204 +
--      gov 16,873 = 24,077 rows) is gated to zero: its acquisition path is
--      externally blocked at the bot-wall (government-lease CLAUDE.md §25 —
--      `W9_1_SOS_DIRECT` off, every adapter honest-blocked, the weekly `--apply`
--      schedule DISABLED). A task nobody can complete is not actionable at any
--      value. The reason is RECORDED per row and `gate_value` is still computed,
--      so re-admitting the lane is one predicate change on the day SOS-direct
--      is unblocked.
--
-- MEASURED EFFECT (dia, 2026-08-27, before → after):
--   true_owner_needs_salesforce  6,324 → 40    property_missing_recorded_owner 6,354 → 62
--   property_missing_county_rec  9,761 → 109   owner_needs_sos                 7,204 → 0
--   dia pool 29,643 → 211 admitted (0.7%).
--
-- REVERSAL: re-apply the previous bodies of `v_ownership_gaps` and
-- `v_next_best_research` (both are CREATE OR REPLACE, no data is touched) and
-- drop the two functions. The producer's gate filter no-ops against a view
-- without the column only in the sense that the request 400s — so revert the
-- JS in the same step.
-- ============================================================================

-- ── The single value knob (mirrors lcc_weak_role_value_floor's shape) ────────
create or replace function public.dia_research_gate_value_floor()
returns numeric language sql immutable
set search_path to 'public','pg_temp'
as $$ select 500000::numeric $$;

comment on function public.dia_research_gate_value_floor() is
'A5c: the annual-rent floor a research-task subject must clear to be emitted. '
'$500k — deliberately the SAME number as the gov asset-mint floor, '
'CADENCE_SIGNAL_MIN_VALUE and P161''s weak-role floor. One knob, one place.';

-- ── Placeholder owner names this gate must not emit ─────────────────────────
-- NARROW and SCOPED TO THIS GATE. It delegates the general question to the
-- existing dia_is_strong_junk_owner_name and adds only the anchored literals
-- that guard was measured NOT to catch. Never reuse it as a general name
-- filter — there a false positive deletes a real owner.
create or replace function public.dia_research_gate_is_placeholder_owner(p_name text)
returns boolean language plpgsql immutable
set search_path to 'public','extensions','pg_temp'
as $$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN true; END IF;
  n := lower(btrim(p_name));
  IF n = '' THEN RETURN true; END IF;
  -- Reuse first. This already covers unknown / n/a / various / undisclosed /
  -- tbd / none — verified on named rows 2026-08-27.
  IF dia_is_strong_junk_owner_name(p_name) THEN RETURN true; END IF;
  -- The measured remainder. Exact match only: a `contains` rule swallows real
  -- firms (P158a). Blast radius over every live owner name: 3 true_owners +
  -- 3 recorded_owners, all genuine placeholders, 0 real firms.
  IF n IN ('independent','other','state owned','multiple','current owner',
           'recorded owner','the owner','no owner','not applicable',
           'see above','same','john doe','jane doe') THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

comment on function public.dia_research_gate_is_placeholder_owner(text) is
'A5c: narrow placeholder-name gate for the research-task producer ONLY. '
'Delegates to dia_is_strong_junk_owner_name, then adds the anchored literals '
'that guard misses (Independent / Other / State Owned). Scoped to this gate '
'on purpose — do not export into the shared junk guards.';

-- ── v_ownership_gaps: gate columns APPENDED (CREATE OR REPLACE is column
--    append-only; every new column goes at the END of the SELECT list) ───────
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
    -- A5c gate (property-keyed arm: value is the property's own canonical rent)
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
    -- A5c gate (owner-keyed arm: value is summed across the OWNER's portfolio)
    (tw.merged_into_true_owner_id IS NULL
     AND NOT dia_research_gate_is_placeholder_owner(tw.name)
     AND NOT (COALESCE(tw.is_operator_not_owner, false)
              OR lower(COALESCE(tw.owner_type, '')) = 'operator'
              OR lower(COALESCE(tw.owner_role, '')) = 'operator')
     AND COALESCE(tv.n_props, 0) > 0
     AND tv.owner_rent >= dia_research_gate_value_floor()) AS gate_pass,
    CASE
      WHEN tw.merged_into_true_owner_id IS NOT NULL THEN 'merged_tombstone'
      WHEN dia_research_gate_is_placeholder_owner(tw.name) THEN 'placeholder_owner'
      WHEN COALESCE(tw.is_operator_not_owner, false)
           OR lower(COALESCE(tw.owner_type, '')) = 'operator'
           OR lower(COALESCE(tw.owner_role, '')) = 'operator' THEN 'operator_not_owner'
      WHEN COALESCE(tv.n_props, 0) = 0 THEN 'owns_no_property'
      WHEN tv.owner_rent IS NULL THEN 'value_unknown'
      WHEN tv.owner_rent < dia_research_gate_value_floor() THEN 'below_value_floor'
      ELSE 'admitted' END AS gate_reason,
    tv.owner_rent AS gate_value
   FROM true_owners tw
   LEFT JOIN LATERAL (
      SELECT count(*) AS n_props, sum(pv.annual_rent) AS owner_rent
        FROM properties p
        LEFT JOIN v_property_attributes_portfolio pv ON pv.property_id = p.property_id
       WHERE p.true_owner_id = tw.true_owner_id
   ) tv ON true
  WHERE tw.salesforce_id IS NULL;

-- ── v_next_best_research: pass the gate through (appended at the END) ───────
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
'A5c: carries the producer''s VALUE GATE. `gate_pass` is what the research-task '
'generator''s ranked mint head filters on; `gate_reason` names why a row is '
'excluded (lane_no_consumer / merged_tombstone / placeholder_owner / '
'operator_not_owner / owns_no_property / value_unknown / below_value_floor). '
'⚠️ The generator''s membership PROBE must read this view UNGATED — it answers '
'"does the gap still exist", not "is it worth working"; probing the gated view '
'would auto-close every gated-out subject as gap_resolved.';
