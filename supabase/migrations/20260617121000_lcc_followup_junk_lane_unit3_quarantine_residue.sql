-- ============================================================================
-- Follow-up — junk_entity_name lane rescope, Unit 3: quarantine the true junk
-- ----------------------------------------------------------------------------
-- After Unit 1 recovered 541 mistyped orgs the lane was ~208. This quarantines
-- the unambiguous STRUCTURAL junk residue (verified live 2026-06-17): street
-- fragments ("Battery St W", "Halleck St N", "401 Focus St"), deal/attribution
-- strings ("Boyd Watterson by Newmark Knight Frank", "Capstone Equities by
-- Charles Dunn", "GSA (US Gov't) JV US Fed Props Trust Inc"), and "Buyer/Seller
-- Contacts" panel-header bleed. These are genuine junk — they leave the active
-- lane but are NOT deleted.
--
-- Reuses the R13 Unit-3 "stop asking" hook (`metadata.junk_name_reviewed=true`),
-- which the seed already excludes. The entity STAYS junk_name_flagged (its name
-- IS junk); junk_name_reviewed records the orthogonal "confirmed junk, don't
-- re-ask" judgment. Reversible: clear junk_name_reviewed to re-surface.
-- Conservative: only names matching a strong structural-junk signal AND NOT a
-- pipe-composite (those route to the split path). Idempotent.
--
-- DEFERRED (documented, not done here): the ~46 pipe-composites
-- ("<person> | <firm>") want a split action (mint the firm + attach the person
-- via splitCompositeOwnerName) — a small Decision Center sub-lane, lower
-- priority. The remaining ambiguous residue stays in the lane for human eyes.
-- ============================================================================

WITH lane AS (
  SELECT id, name FROM entities
  WHERE (metadata->>'junk_name_flagged') = 'true'
    AND COALESCE(metadata->>'junk_name_reviewed','') <> 'true'
    AND merged_into_entity_id IS NULL
),
strong AS (
  SELECT id FROM lane
  WHERE name !~ '\|'
    AND ( name ~* '^(buyer|seller)\s*contacts'
       OR name ~* '(\mby\s+\w|\yJV\y|\y(CMBS|BBCMS|CDCMT|REIT)\y|\yapprox\y|\$|\([^)]*\d[^)]*\))'
       OR ( name ~* '\y(st|ave|avenue|blvd|dr|rd|ln|pkwy|hwy|ct|cir|ter|pl)\y(\s+[nsew]{1,2})?\s*$'
            AND (name ~ '\d' OR name ~* '\y[nsew]{1,2}\s*$') ) )
),
upd AS (
  UPDATE entities e
  SET metadata = COALESCE(e.metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'junk_name_reviewed', 'true',
                      'junk_confirmed', 'true',
                      'junk_confirmed_source', 'followup_junk_lane_rescope',
                      'junk_confirmed_at', now()::text)
  FROM strong s
  WHERE e.id = s.id
  RETURNING e.id
)
UPDATE lcc_decisions d
SET status = 'superseded',
    updated_at = now(),
    effects = COALESCE(d.effects, '{}'::jsonb)
              || jsonb_build_object('superseded_reason', 'junk_confirmed_quarantine',
                                    'rescued_source', 'followup_junk_lane_rescope')
WHERE d.decision_type = 'junk_entity_name'
  AND d.status = 'open'
  AND d.subject_entity_id IN (SELECT id FROM upd);
