-- ============================================================================
-- P146 — organisations wearing entity_type='person'.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19. 7 retyped, 7 resolved.
-- ----------------------------------------------------------------------------
-- Third instance of this in one day. P134 found `UIRC` and `Altera Dev` typed
-- person and `Pete Dienna` typed organization. Opening person_shaped_winner
-- (55 rows) found nine more, of which SEVEN are unambiguous organisations:
--
--     AGREE LIMITED PARTNERSHIP          Office Properties Income  (= OPI, a REIT)
--     BREIT via Blackstone REIT I        Goddard Investments
--     GIPAZ 199 NORTH PANTANO ROAD L     Michigan State University Foundation
--     Preylock RE Holdings JV Benchmark Holdings
--
-- The type is simply WRONG on these. Correcting it is right independent of what
-- supersession then does with them, and it is why entity TYPE keeps surfacing as
-- undermodelled -- Scott's own §11 note on the note-records work said exactly
-- that.
--
-- ⚠️ TWO ARE AGENTS, NOT PRINCIPALS, and are deliberately LEFT UNTOUCHED:
--     Arch Street Capital Advisors OBO Global Securitization Services
--     LASALLE BANK NA; AMERICAN NATIONAL BK & TR CO OF CHICAGO
--   "OBO" is on-behalf-of; a trustee bank holds title for someone else.
--   Correcting their type would let them resolve as OWNERS, and nothing catches
--   them -- lcc_owner_name_is_brokerage lists brokerages, not servicers. Same
--   family as the P116 brokerage-as-owner trap, one step over. They stay in
--   review, which is the honest outcome for an agent.
--
-- The other 46 person_shaped_winner rows are GENUINE individuals and are NOT
-- touched. Scott: "Lee Elman is a private individual that owns government
-- properties." Whether an individual may occupy lcc_property_owner at all is a
-- doctrine question -- lcc_supersede_property_owner requires
-- owner_entity_type='organization' -- and it is NOT settled here.
--
-- LIVE: person_shaped_winner 59 -> 52; supersede resolved exactly those 7.
--
-- REVERSAL: the previous type is recorded on each row.
--   update entities set entity_type = (metadata->>'p146_prior_entity_type')::entity_type
--    where metadata ? 'p146_prior_entity_type';
--   delete from lcc_property_owner where source='supersession'
--    and entity_id in (select entity_id from lcc_owner_supersession_log
--                       where batch_tag='p146_retype_20260819');
-- ============================================================================

UPDATE public.entities e
   SET entity_type = 'organization',
       metadata = coalesce(e.metadata,'{}'::jsonb)
                || jsonb_build_object('p146_prior_entity_type', e.entity_type::text,
                                      'p146_reason','name carries an org marker; '
                                        || 'entity_type was person')
 WHERE e.entity_type = 'person'
   AND e.id IN (SELECT r.owner_entity_id FROM public.v_lcc_owner_supersession_review r
                 WHERE r.review_reason = 'person_shaped_winner')
   AND public.lcc_owner_name_has_org_marker(e.name)
   -- agents are NOT principals: leave OBO / trustee-bank rows in review
   AND e.name !~* '\mOBO\M'
   AND e.name !~* '\mbk\s*&\s*tr\M|\mbank\M.*\mtr(ust)?\M|\mas trustee\M';
