-- ============================================================================
-- R9 follow-up — soft-flag bare street-fragment entities (LCC Opps)
-- ============================================================================
-- The chain-connect drain minted "West Mall Dr" (from dia property 26623's
-- sales_transactions.seller_name — a corrupted capture) as an ORGANIZATION.
-- Earlier writers minted similar bare street fragments as persons ("Clay St N",
-- "Pine St N", "401 Focus St", …). The writer is now guarded (ensureEntityLink
-- rejects street-fragment org/person mints — R9 isStreetFragmentName, applied
-- type-gated so asset/property addresses still mint). This soft-flags the
-- EXISTING rows into the junk_entity_name Decision Center lane for disposition
-- (rename / merge / retype) — never a hard delete.
--
-- Mirrors the JS isStreetFragmentName logic: entity is NON-asset (asset names ARE
-- street addresses and must never be flagged), the name ENDS in an abbreviated
-- road word (+ optional directional), carries NO firm suffix, and shows a STRONG
-- street signal (a street number, a leading directional word, or a trailing
-- directional abbreviation). Conservative — "Parkway Properties", "Broadway",
-- and plausible surnames like "John Way" carry no street signal / no trailing
-- road word and are left alone.
--
-- Idempotent: only flags rows not already flagged; preserves existing metadata.
-- DB-safety: additive metadata write, entity-scale, no auth-schema contact.
-- ============================================================================

UPDATE public.entities
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('junk_name_flagged', true,
                                        'junk_name_source', 'r9_street_fragment'),
       updated_at = now()
 WHERE entity_type <> 'asset'
   AND COALESCE((metadata->>'junk_name_flagged')::boolean, false) = false
   AND name ~* '\y(st|ave|avenue|blvd|dr|rd|ln|pkwy|hwy|way|ct|cir|ter|pl)\.?(\s+(n|s|e|w|ne|nw|se|sw))?$'
   AND name !~* '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y'
   AND (
        name ~ '[0-9]'                                                          -- street number
     OR name ~* '^(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\y'  -- leading directional
     OR name ~* '\s(n|s|e|w|ne|nw|se|sw)$'                                       -- trailing directional
   );

-- Pull the freshly-flagged rows into the junk_entity_name lane immediately.
SELECT * FROM public.lcc_refresh_decisions();
