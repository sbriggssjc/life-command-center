-- ============================================================================
-- Follow-up — junk_entity_name lane rescope, Unit A: correct the 47 deal-string
-- retypes that Unit 1 flipped to "clean" orgs WITHOUT the deal-string exclusion.
-- ----------------------------------------------------------------------------
-- Grounding (live 2026-06-17): of the 541 firm-suffixed persons Unit 1
-- (migration 20260617120000) retyped to `organization`, 47 carry a deal-string
-- capture artifact in their NAME — the EXACT class the ensureEntityLink Unit-2
-- guard (DEAL_STRING_RE) rejects going forward. Unit 1 just didn't apply that
-- same exclusion before flipping them to "clean" orgs, so this corrects the
-- inconsistency. (The 2 "(REIT)" descriptor rows are legitimate org names, NOT
-- artifacts — deliberately out of scope.)
--
-- Two classes (measured live):
--   * 1 pure SENTENCE FRAGMENT — "The property is currently 100% occupied by
--     DaVita Dialysis". NOT an entity at all; Unit 1 wrongly retyped it.
--     -> REVERT the retype (back to `retyped_from`) AND quarantine as true junk
--        (reuse the R13 Unit-3 `junk_name_reviewed` "stop asking" hook +
--        `junk_confirmed`). It IS junk -> restore junk_name_flagged.
--   * 46 BROKER-ATTRIBUTION / ALIAS — "<Real Org> by <net-lease broker>"
--     (Stan Johnson Co / CBRE / Newmark…), plus " via <fund>", " AKA <alias>",
--     " c/o <people>". The entity IS a real org (the type flip was right); the
--     NAME is contaminated, and several (NGP Capital, Boyd Watterson…) already
--     exist as CLEAN registered entities -> dirty-named DUPLICATES.
--     -> CLEAN the name (strip the trailing  by/via/AKA/c-o  artifact; stash the
--        original in metadata.name_before_dealstring_clean), recompute
--        canonical_name (SQL mirror of entity-link.js normalizeCanonicalName),
--        KEEP entity_type='organization'. Routing to the merge lane is then
--        AUTOMATIC: the cleaned org joins its clean twin in
--        v_lcc_merge_candidates (member_count>=2) for HUMAN review — NO blind
--        auto-merge (Tier-2 doctrine). Where the cleaned name looks like a
--        person AND has no org twin, flag metadata.dealstring_type_suspect so
--        the reviewer can retype (surface, don't bury).
--
-- Reversible (no hard delete): original name + prior state stashed in metadata;
-- revert = restore name/canonical_name/entity_type from the *_before_* keys.
-- Idempotent: guarded on the dealstring_cleaned / dealstring_reverted flags.
--
-- KNOWN LIMITATION (surfaced, not forked): short cleaned names like
-- "NGP Capital" normalize to NULL under lcc_normalize_entity_name (the function
-- drops the "Capital" suffix -> "ngp" -> <4 chars -> NULL), so the merge VIEW
-- cannot surface those dups even though a clean twin exists. We record a
-- metadata.dealstring_merge_twin_canonical pointer for those so the pair is
-- still discoverable; fixing the normalize-NULL gap is a separate blessed change
-- to the shared merge machinery.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The pure sentence fragment: NOT an org. Revert the retype + quarantine.
-- ----------------------------------------------------------------------------
WITH sel AS (
  SELECT e.id, COALESCE(NULLIF(e.metadata->>'retyped_from',''), 'person') AS retyped_from
  FROM entities e
  WHERE e.metadata->>'retype_source' = 'followup_junk_lane_rescope'
    AND e.metadata ? 'retyped_from'
    AND e.merged_into_entity_id IS NULL
    AND e.entity_type = 'organization'
    AND e.name ~* '(is\s+currently|occupied|the\s+property|square\s+feet)'
    AND COALESCE(e.metadata->>'dealstring_reverted','') <> 'true'
),
rev AS (
  UPDATE entities e
  SET entity_type = sel.retyped_from::entity_type,
      metadata = COALESCE(e.metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'entity_type_before_dealstring_revert', e.entity_type::text,
                      'dealstring_reverted', 'true',
                      'dealstring_correction_source', 'followup_junk_lane_dealstring_correct',
                      'dealstring_corrected_at', now()::text,
                      'junk_name_flagged', 'true',     -- it IS junk (Unit 1 had cleared it)
                      'junk_name_reviewed', 'true',    -- R13 "stop asking" hook
                      'junk_confirmed', 'true',
                      'junk_confirmed_source', 'followup_junk_lane_dealstring_correct'),
      updated_at = now()
  FROM sel
  WHERE e.id = sel.id
  RETURNING e.id
)
UPDATE lcc_decisions d
SET status = 'superseded',
    updated_at = now(),
    effects = COALESCE(d.effects, '{}'::jsonb)
              || jsonb_build_object('superseded_reason', 'dealstring_sentence_quarantine',
                                    'rescued_source', 'followup_junk_lane_dealstring_correct')
WHERE d.decision_type = 'junk_entity_name'
  AND d.status = 'open'
  AND d.subject_entity_id IN (SELECT id FROM rev);

-- ----------------------------------------------------------------------------
-- 2. The 46 broker-attribution / alias: clean the name, keep org, route to merge.
-- ----------------------------------------------------------------------------
WITH fre AS (
  SELECT '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y' AS rx
),
sel AS (
  SELECT e.id, e.name, e.canonical_name,
         btrim(regexp_replace(e.name, '\s+(by|via|aka|c/o)\s+.*$', '', 'i')) AS clean_name
  FROM entities e
  WHERE e.metadata->>'retype_source' = 'followup_junk_lane_rescope'
    AND e.metadata ? 'retyped_from'
    AND e.merged_into_entity_id IS NULL
    AND e.entity_type = 'organization'
    AND e.name ~* '\s(by|via|aka|c/o)\s'
    AND e.name !~* '(is\s+currently|occupied|the\s+property|square\s+feet)'  -- exclude the sentence row
    AND COALESCE(e.metadata->>'dealstring_cleaned','') <> 'true'
),
enr AS (
  SELECT s.*,
    -- SQL mirror of entity-link.js normalizeCanonicalName(clean_name)
    btrim(regexp_replace(regexp_replace(regexp_replace(
       lower(s.clean_name),
       '\y(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\y\.?', '', 'g'),
       '[^a-z0-9\s]', ' ', 'g'),
       '\s+', ' ', 'g')) AS canon,
    (s.clean_name ~* (SELECT rx FROM fre)) AS has_firm_suffix,
    ( SELECT t.id FROM entities t
       WHERE t.entity_type = 'organization' AND t.merged_into_entity_id IS NULL AND t.id <> s.id
         AND lcc_normalize_entity_name(t.name) IS NOT NULL
         AND lcc_normalize_entity_name(t.name) = lcc_normalize_entity_name(s.clean_name)
       ORDER BY t.created_at NULLS LAST LIMIT 1 ) AS view_twin_id,
    ( SELECT t.id FROM entities t
       WHERE t.entity_type = 'organization' AND t.merged_into_entity_id IS NULL AND t.id <> s.id
         AND lower(t.canonical_name) = lower(
              btrim(regexp_replace(regexp_replace(regexp_replace(
                lower(s.clean_name),
                '\y(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\y\.?', '', 'g'),
                '[^a-z0-9\s]', ' ', 'g'),
                '\s+', ' ', 'g')))
       ORDER BY t.created_at NULLS LAST LIMIT 1 ) AS canon_twin_id
  FROM sel s
)
UPDATE entities e
SET name = enr.clean_name,
    canonical_name = NULLIF(enr.canon, ''),
    metadata = COALESCE(e.metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'name_before_dealstring_clean', e.name,
                    'canonical_name_before_dealstring_clean', e.canonical_name,
                    'dealstring_cleaned', 'true',
                    'dealstring_clean_source', 'followup_junk_lane_dealstring_correct',
                    'dealstring_cleaned_at', now()::text,
                    'dealstring_routed_to_merge', 'true')
               || CASE WHEN enr.view_twin_id IS NULL AND enr.canon_twin_id IS NOT NULL
                       THEN jsonb_build_object('dealstring_merge_twin_canonical', enr.canon_twin_id::text)
                       ELSE '{}'::jsonb END
               || CASE WHEN NOT enr.has_firm_suffix AND enr.view_twin_id IS NULL AND enr.canon_twin_id IS NULL
                       THEN jsonb_build_object('dealstring_type_suspect', 'person')
                       ELSE '{}'::jsonb END,
    updated_at = now()
FROM enr
WHERE e.id = enr.id;
