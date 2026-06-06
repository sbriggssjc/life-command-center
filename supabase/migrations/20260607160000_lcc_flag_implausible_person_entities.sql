-- ============================================================================
-- R7 Phase 2.5 — flag mistyped "person" entities (capture artifacts) (LCC Opps)
-- ============================================================================
-- The sale-event/capture pipeline classified any buyer/seller string WITHOUT a
-- firm suffix as a PERSON, minting deal-capture artifacts as person entities:
-- "Boyd Watterson by NAI Capital" (broker attribution), "... JV ...", CMBS
-- strings with $ amounts, bare firm names ("Townsend Capital", family trusts).
-- They polluted the buy-side contact picker (no real human selectable). The
-- writer is now guarded (ensureEntityLink rejects implausible person names —
-- R7 Phase 2.5 JS). This soft-flags the EXISTING rows into the junk_entity_name
-- Decision Center lane for disposition (rename / merge / retype) — never a
-- hard delete. Mirrors the JS isImplausiblePersonName patterns. Idempotent:
-- only flags rows not already flagged; preserves existing metadata.
-- ============================================================================

UPDATE public.entities
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('junk_name_flagged', true,
                                        'junk_name_source', 'r7_phase2_5_person_plausibility'),
       updated_at = now()
 WHERE entity_type = 'person'
   AND COALESCE((metadata->>'junk_name_flagged')::boolean, false) = false
   AND (
        name ~* '\mby\s'                                   -- "... by <broker>"
     OR name ~* '\mJV\M'                                   -- joint-venture
     OR name ~* '\m(CMBS|BBCMS|CDCMT)\M'                   -- CMBS deal codes
     OR name ~* 'ML-?CFC'
     OR name ~* '[0-9]{4}-[A-Z]?[0-9]'                     -- 2021-C10 / 2002-FX1
     OR name ~* '\mapprox\M'
     OR name LIKE '%$%'
     OR name ~ '\([^)]*[0-9][^)]*\)'                       -- parenthesized amount
     OR name ~* '\m(LLC|L\.L\.C|LP|LLP|Inc|Corp|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Associates|Group|Management)\M'
   );

-- Pull the freshly-flagged rows into the junk_entity_name lane immediately.
SELECT * FROM public.lcc_refresh_decisions();
