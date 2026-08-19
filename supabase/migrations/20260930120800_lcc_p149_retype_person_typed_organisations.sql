-- ============================================================================
-- P149 — the mistyping backlog, swept. 784 entities typed person are companies.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- This class was fixed three times today one lane at a time -- P134 (UIRC,
-- Altera Dev), P146 (seven REITs incl. Office Properties Income), P148b (31
-- municipalities). Asking the question of the WHOLE TABLE instead of a review
-- lane: 808 entities carry entity_type='person' while their NAME carries an
-- organisation marker.
--
-- The "97" quoted earlier was only the slice that had already resolved as an
-- OWNER. The real backlog is 8x that -- a good illustration of the difference
-- between the rows a consumer processes and the population.
--
-- Both halves read as companies on inspection:
--   digit marker only   1325 J STREET L P · 1801 NOVA RD L L C · 3500 FINANCIAL
--                       3299 LINCOLN STREET GENERAL PARTNERSHIP · 401 Focus St
--   word marker         AEI Capital · Adelson Fijan Properties
--                       Akridge JV Seaton Benkowski Partners
-- Address-named SPEs and firms. None is a person.
--
-- ⚠️ AGENTS ARE EXCLUDED (24 rows), and the reason is a REAL GAP rather than
-- caution. An agent IS an organisation, so correcting its type is factually
-- right -- but nothing stops an organisation-typed agent from RESOLVING as an
-- owner: lcc_owner_name_is_brokerage lists brokerages, not servicers. Retyping
-- them would trade a TYPE error for an OWNERSHIP error, which is worse. They
-- stay person-typed until a servicer guard exists, and building that guard is
-- the outstanding piece of work this migration deliberately does NOT do.
--
-- Brokerages ARE retyped (17): they are organisations, and the existing
-- brokerage guard already keeps them out of lcc_property_owner, so there is no
-- such trade-off.
--
-- Nothing about OWNERSHIP changes here -- this only corrects what KIND of thing
-- an entity is. Three assets happened to resolve afterwards through the normal
-- guards (City of St. Louis, City Of Philadelphia P, St. Louis City Of), all via
-- gov_ownership_transition.
--
-- LIVE: 784 retyped · 24 agents left · persons 13,724 -> 12,940 ·
--       organizations 44,511 -> 45,295 · purchase_tier_no_org_marker 11 -> 8
--
-- REVERSAL:
--   update entities set entity_type = (metadata->>'p149_prior_entity_type')::entity_type
--    where metadata ? 'p149_prior_entity_type';
-- ============================================================================

UPDATE public.entities e
   SET entity_type = 'organization',
       metadata = coalesce(e.metadata,'{}'::jsonb)
                || jsonb_build_object('p149_prior_entity_type', e.entity_type::text,
                                      'p149_reason','name carries an organisation marker')
 WHERE e.entity_type = 'person'
   AND public.lcc_owner_name_has_org_marker(e.name)
   -- agents stay person-typed until a servicer guard exists (see header)
   AND e.name !~* '\mOBO\M|\mas trustee\M|\mbk\s*&\s*tr\M|\mbank\M.*\mtr(ust)?\M';
