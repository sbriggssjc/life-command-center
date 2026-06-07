-- ============================================================================
-- R10 Unit 3a — retype person-typed firm entities → organization (cadence set)
-- ----------------------------------------------------------------------------
-- The pre-R7-2.5 capture bug minted firm names as `person` entities. The R10
-- contact-reachability gate + the prospecting-contact picker both key on
-- person-vs-org, so the typing must be corrected BEFORE the gate (Unit 3b).
--
-- Scope (conservative + bounded): cadence-bearing `person` entities whose NAME
-- carries a firm suffix (mirror of entity-link.js ENTITY_FIRM_SUFFIX_RE). Names
-- with no recognizable suffix (e.g. "Prologis") stay `person` — the gate parks
-- them anyway, and the picker offers "add contact" regardless of type.
--
-- Reversible soft update: the prior type is stashed in metadata
-- (`retyped_from`, `retype_source`) so a later pass can undo it. No hard delete.
-- Idempotent: re-running only matches rows still typed `person`.
-- ============================================================================

WITH fre AS (
  SELECT '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y' AS rx
),
targets AS (
  SELECT DISTINCT e.id
  FROM touchpoint_cadence tc
  JOIN entities e ON e.id = tc.entity_id
  WHERE e.entity_type = 'person'
    AND e.merged_into_entity_id IS NULL
    AND e.name ~* (SELECT rx FROM fre)
)
UPDATE entities e
SET entity_type = 'organization',
    metadata = COALESCE(e.metadata, '{}'::jsonb)
               || jsonb_build_object('retyped_from', 'person',
                                     'retype_source', 'r10_unit3',
                                     'retyped_at', now()::text)
FROM targets t
WHERE e.id = t.id
  AND e.entity_type = 'person';
