-- ============================================================================
-- Follow-up — junk_entity_name lane rescope, Unit 1: auto-retype mistyped orgs
-- ----------------------------------------------------------------------------
-- Grounding (live 2026-06-17): the junk_entity_name Decision Center lane held
-- ~749 open entities. 601 are typed `person`; of those, 541 carry an
-- unambiguous firm/org suffix (no pipe) — they are legitimate ORGANIZATIONS
-- mistyped as persons by the pre-R7-2.5 capture bug, then junk-flagged by the
-- r7_phase2_5_person_plausibility guard (which junk-flagged firm names instead
-- of retyping them). Sample: "1000 American Way Associates", "Acadia Realty",
-- "Abbey Company", "Acquisition Fund", "256 Realty Co", "Acuity Private Capital".
-- Being junk-flagged HOLDS them out of the BD graph (priority-queue bands
-- exclude junk_name_flagged) — so this recovers real owner/firm entities.
--
-- This extends the R10 Unit-3a retype (which only covered CADENCE-bearing
-- persons) to ALL junk-flagged person entities whose NAME carries a firm
-- suffix. SAME regex (mirror of entity-link.js ENTITY_FIRM_SUFFIX_RE), SAME
-- reversible-metadata pattern. Conservative: firm suffix only; pipe-composites
-- (46, "<person> | <firm>") and no-suffix persons (49, genuine junk: street
-- fragments / "by <broker>" / "Buyer Contacts" bleed) are NOT touched.
--
-- Reversible (no hard delete): prior type + the original junk flag are stashed
-- in metadata; revert = set entity_type back from `retyped_from`, restore
-- junk_name_flagged. Idempotent: only matches rows still typed `person` AND
-- still flagged.
-- ============================================================================

WITH fre AS (
  SELECT '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y' AS rx
),
targets AS (
  SELECT e.id
  FROM entities e
  WHERE e.entity_type = 'person'
    AND e.merged_into_entity_id IS NULL
    AND (e.metadata->>'junk_name_flagged') = 'true'
    AND COALESCE(e.metadata->>'junk_name_reviewed','') <> 'true'
    AND e.name ~* (SELECT rx FROM fre)
    AND position('|' IN e.name) = 0            -- leave pipe-composites for the split path
),
upd AS (
  UPDATE entities e
  SET entity_type = 'organization',
      metadata = COALESCE(e.metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'retyped_from', 'person',
                      'retype_source', 'followup_junk_lane_rescope',
                      'retyped_at', now()::text,
                      'junk_name_flagged', 'false',          -- recover into the BD graph
                      'junk_name_flagged_was', 'true',       -- reversible: original value
                      'junk_name_rescued', 'true')
  FROM targets t
  WHERE e.id = t.id
    AND e.entity_type = 'person'
  RETURNING e.id
)
-- Supersede any OPEN junk_entity_name decision for the rescued entities so the
-- lane drains immediately (the seed predicate now fails for them too).
UPDATE lcc_decisions d
SET status = 'superseded',
    updated_at = now(),
    effects = COALESCE(d.effects, '{}'::jsonb)
              || jsonb_build_object('superseded_reason', 'rescued_org_retype',
                                    'rescued_source', 'followup_junk_lane_rescope')
WHERE d.decision_type = 'junk_entity_name'
  AND d.status = 'open'
  AND d.subject_entity_id IN (SELECT id FROM upd);
