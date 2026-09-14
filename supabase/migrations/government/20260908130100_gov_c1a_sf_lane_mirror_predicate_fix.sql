-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- C1a — repair the gov SF-link mirror gap (resizes owner_needs_salesforce)
--       2026-09-08 (executing C1 §1 / life-command-center
--       docs/audits/C1_SALESFORCE_LANES_CONSUMER_OR_RETIRE_2026-08-27.md §"the
--       lane's predicate and its only writer can be on different columns")
--
-- The `sf_link_candidate` Decision-Center verdict path
-- (life-command-center api/admin.js, `handleReviewVerdict` sf_link_candidate
-- branch) PATCHes `recorded_owners.sf_account_id` / `true_owners.sf_account_id`
-- (via sfLinkColumn/sfLinkTarget, api/_handlers/sf-link-review.js). The A5c
-- research-task gate (20260908120000_gov_a5c_research_task_value_gate.sql)
-- reads `unified_contacts.sf_account_id IS NULL` as the gap predicate for
-- `owner_needs_salesforce`. Nothing mirrors one column to the other, so a
-- human who successfully links a gov owner through the Decision Center does
-- NOT clear the research task -- it stays open and is re-minted forever.
--
-- Measured by C1 2026-08-27 (re-measure live before trusting this figure --
-- CLAUDE.md "re-measure a dated blocker before quoting it"):
--   1,961 gov owners already linked -> 1,407 have a unified_contacts row ->
--   1,292 of THOSE still read sf_account_id NULL, only 29 agree. 96 of the
--   1,675 gov rows the A5c value gate admits ($314.7M) were already-resolved
--   work wearing an open badge.
--
-- ── WHY REPOINT, NOT DUAL-WRITE ──────────────────────────────────────────────
-- Grepped this repo for every reader of `unified_contacts.sf_account_id` as
-- authoritative for the gov owner-needs-salesforce gap (life-command-center,
-- 2026-09-08): the ONLY consumer of that column for this purpose is this one
-- view arm. `unified_contacts` on gov is ALSO the pre-cutover CONTACTS_HUB
-- snapshot (CLAUDE.md: frozen-ish, last touched 2026-08-17 pre-cutover, a
-- trickle since) -- a second store the writer would have to keep in lock-step
-- for no reader. Repointing to `recorded_owners.sf_account_id` (the column the
-- verdict path ACTUALLY writes, and the one gov's OWN provenance ladder
-- already ranks -- sf_link_review_human@1 / splink_v1@50, see
-- 20260819120000_lcc_w4_4_provenance_citizen_sf_link.sql on LCC Opps) is one
-- column, one source of truth, no second store to drift.
--
-- ⚠️ IF this migration is ever found to be wrong (a second reader of
-- unified_contacts.sf_account_id for THIS gap surfaces), dual-write instead of
-- reverting to the old predicate -- see the reversal note below.
--
-- WHAT CHANGES, WHAT DOES NOT
--   - `entity_kind`/`entity_id` on the arm stay `unified_entity` / `u.unified_id`
--     -- unchanged, deliberately. This migration repoints the GAP PREDICATE
--     (what counts as "still needs a link"), not the task's subject identity.
--     Changing entity_id would orphan the ~1,675 open/queued research_tasks
--     rows keyed on the old id space -- a materially bigger, unverified change
--     this migration does not make.
--   - The `unified_contacts u` / `recorded_owners ro` join is UNCHANGED (it
--     already exists in the arm, `LEFT JOIN recorded_owners ro ON
--     ro.recorded_owner_id = u.recorded_owner_id`) -- only the gate predicate
--     moves from `u.sf_account_id` to `ro.sf_account_id`.
--   - `owns_no_property` / `value_unknown` / `below_value_floor` /
--     `placeholder_owner` / `public_body_not_prospected` gate reasons and the
--     value floor are UNTOUCHED (A5c, not this migration's concern).
--
-- ⚠️ A ROW WITH `ro.recorded_owner_id IS NULL` (no recorded_owner bridge at
-- all) previously read `u.sf_account_id IS NULL` -> gap. Under the repoint,
-- `ro.sf_account_id` is NULL by construction (the LEFT JOIN produced no row),
-- so it STILL reads as a gap -- behaviourally identical for that population,
-- just via a different column. No new exclusion is introduced.
--
-- REVERSAL: re-apply the prior body (u.sf_account_id IS NULL) below, or -- if
-- a second reader of unified_contacts.sf_account_id for this gap is found --
-- widen the CASE to require BOTH columns null (dual-write posture) rather than
-- reverting outright.
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
    -- C1a: gate on the column the sf_link_candidate verdict path ACTUALLY
    -- writes (recorded_owners.sf_account_id), not on unified_contacts, which
    -- no writer in this repo touches for this purpose. gate_pass/gate_reason
    -- are UNCHANGED from A5c -- the fix is the WHERE clause below, which is
    -- what makes a row DISAPPEAR from the feed the moment a human links it,
    -- so the generator's membership probe (which reads absence-from-feed as
    -- "the gap resolved") auto-closes the matching open task. Gating the
    -- exclusion into gate_reason instead (leaving the row present but
    -- unadmitted) would NOT close the task -- the probe reads presence in
    -- v_next_best_research, not gate_pass. Mirrors the shape dia's sibling
    -- arm already uses (`WHERE tw.salesforce_id IS NULL`, not a CASE branch).
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
  -- C1a: the ONLY line this migration changes is this predicate --
  -- `u.sf_account_id` (never written) -> `ro.sf_account_id` (what
  -- sf_link_candidate actually PATCHes). A row with no recorded_owner bridge
  -- at all (ro.recorded_owner_id IS NULL from the LEFT JOIN) still reads
  -- ro.sf_account_id AS NULL, so that population's behaviour is unchanged.
  WHERE u.recorded_owner_id IS NOT NULL AND ro.sf_account_id IS NULL;

comment on view public.v_ownership_gaps is
  'C1a (2026-09-08): owner_needs_salesforce gates on recorded_owners.sf_account_id '
  '-- the column sf_link_candidate actually writes -- not unified_contacts, which '
  'no writer touches for this purpose. See '
  '20260908130100_gov_c1a_sf_lane_mirror_predicate_fix.sql for the measured gap '
  '(1,292 of 1,961 linked owners were reading as still-open before this fix).';

-- v_next_best_research is unchanged in shape (still SELECTs from
-- v_ownership_gaps and passes gate_pass/gate_reason/gate_value through), but
-- CREATE OR REPLACE VIEW re-resolves against the view it reads, so no separate
-- edit is required here -- restated anyway per the "a second copy that is
-- correct beats no copy at all" rule (P194/N18) so this migration is a
-- complete, standalone record of what ships.
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
'A5c/C1a: carries the producer''s VALUE GATE. `gate_pass` is what the research-task '
'generator''s ranked mint head filters on; `gate_reason` names why a row is '
'excluded (lane_no_consumer / placeholder_owner / public_body_not_prospected / '
'owns_no_property / value_unknown / below_value_floor). A row whose '
'recorded_owners.sf_account_id is now set is ABSENT from this feed entirely '
'(C1a) rather than present-but-unadmitted -- that absence is what lets the '
'generator''s membership PROBE auto-close the matching open task. '
'The generator''s membership PROBE must read this view UNGATED — it answers '
'"does the gap still exist", not "is it worth working"; probing the gated view '
'would auto-close every gated-out subject as gap_resolved.';
