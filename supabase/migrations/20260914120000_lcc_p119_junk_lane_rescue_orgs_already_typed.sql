-- ===========================================================================
-- P119 -- junk lane: rescue the orgs the 2026-06-17 round could not reach
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- Doctrine item 2 (auto-retire): a decision whose PREMISE has cleared must not
-- keep asking. `r7_phase2_5_person_plausibility` flagged entities whose names
-- were "not plausible PERSON names" -- correct at the time, because the capture
-- pipeline was minting firm names as people. Migration 20260617120000 then
-- retyped and un-flagged them... but its target set required
-- `entity_type = 'person'`. Entities ALREADY typed `organization` carried the
-- same, now-void flag and were never reached.
--
-- For an ORGANIZATION, "this is not a plausible person name" is not a defect --
-- it is the expected state. The premise is void, so the decision retires.
--
-- Live before: 206 open junk_entity_name, of which 42 match ALL of: typed
-- organization, not merged, not already reviewed, no pipe-composite, carries a
-- firm suffix (the SAME regex 20260617120000 used, mirroring entity-link.js
-- ENTITY_FIRM_SUFFIX_RE), and flagged by exactly that person-plausibility
-- sweep. Examples: Blackstone Real Estate Partners VIII, Ares Real Estate
-- Income Trust, BH Properties, 29th Street Capital -- real firms held OUT of
-- the BD graph by a stale flag (the priority-queue bands exclude junk-flagged).
--
-- DELIBERATELY EXCLUDED, each for a stated reason:
--   * 8 flagged by connectivity1b_artifact_sweep -- a DIFFERENT premise that
--     still stands ("Bria Properties LLC by Stan Johnson Co").
--   * brokerage-polluted names ("... by <brokerage>") -- P116: a brokerage is
--     the agent, never the principal, and cleaning such a name is what SURFACES
--     a duplicate, so it must not be silently readmitted.
--   * 45 pipe-composites -- left for the split path, as 20260617120000 did.
--   * every non-suffix name ("Bakery", "Description:", "Managing Director") --
--     genuinely junk; the lane keeps them.
--
-- BLAST RADIUS (measured BEFORE applying):
--   already on a cadence .... 42 of 42   -> ZERO new cadences created
--   own assets .............. 21
--   have portfolio facts .... 19
--   reachable ............... 11
--   open opportunities ......  0
-- Pure recovery of entities already inside outreach but invisible in the queue.
-- Not a new producer.
--
-- RESULT (verified live): junk lane 206 -> 164; Decision Center open 448 -> 406;
-- 42 rescued, 42 superseded, 0 rescued rows left flagged.
--
-- Reversible + idempotent, mirroring 20260617120000.
-- REVERSAL:
--   UPDATE entities SET metadata = metadata || jsonb_build_object('junk_name_flagged','true')
--    WHERE metadata->>'junk_rescue_source' = 'p119_org_already_typed';
--   UPDATE lcc_decisions SET status='open'
--    WHERE effects->>'superseded_reason' = 'p119_premise_void_for_organization';
-- ===========================================================================

WITH fre AS (
  SELECT '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y' AS rx
),
targets AS (
  SELECT e.id
  FROM public.entities e
  JOIN public.lcc_decisions d
    ON d.subject_entity_id = e.id
   AND d.decision_type = 'junk_entity_name'
   AND d.status = 'open'
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND (e.metadata->>'junk_name_flagged') = 'true'
    AND COALESCE(e.metadata->>'junk_name_reviewed','') <> 'true'
    AND COALESCE(e.metadata->>'junk_rescue_source','') <> 'p119_org_already_typed'
    AND e.metadata->>'junk_name_source' = 'r7_phase2_5_person_plausibility'
    AND position('|' IN e.name) = 0
    AND e.name ~* (SELECT rx FROM fre)
    AND NOT public.lcc_owner_name_is_brokerage(e.name)
    AND e.name !~* '\s+by\s+\S'
),
upd AS (
  UPDATE public.entities e
  SET metadata = COALESCE(e.metadata,'{}'::jsonb) || jsonb_build_object(
        'junk_name_flagged',     'false',
        'junk_name_flagged_was', 'true',
        'junk_name_rescued',     'true',
        'junk_rescue_source',    'p119_org_already_typed',
        'junk_rescue_reason',    'person-plausibility flag is void for an entity typed organization',
        'junk_rescued_at',       now()::text),
      updated_at = now()
  FROM targets t
  WHERE e.id = t.id
  RETURNING e.id
)
UPDATE public.lcc_decisions d
SET status = 'superseded',
    updated_at = now(),
    effects = COALESCE(d.effects,'{}'::jsonb) || jsonb_build_object(
      'superseded_reason', 'p119_premise_void_for_organization',
      'rescued_source',    'p119_org_already_typed')
WHERE d.decision_type = 'junk_entity_name'
  AND d.status = 'open'
  AND d.subject_entity_id IN (SELECT id FROM upd);
