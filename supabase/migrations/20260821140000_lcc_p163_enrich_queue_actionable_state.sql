-- ============================================================================
-- P163 — the enrichment queue's ACTIONABLE-ONLY rule, applied to STATE
--        (2026-08-21). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--        View only here; the paired handler change ships on a Railway redeploy.
--
-- P159 made v_owner_contact_enrich_queue actionable by excluding unworkable
-- ACTIONS ('manual_research', 'find_person_at_manager', an open owner_contact_manual
-- task). It never excluded unworkable STATE. owner-contact-enrich.js returns
-- `already_linked` and does nothing for ANY row carrying an
-- active_contact_entity_id, and 1,246 of 1,406 rows (88.6%) were in that state.
--
-- ⚠️ BE PRECISE ABOUT THE HARM. Those rows were NOT burning ticks: the handler
-- carried its own `&active_contact_entity_id=is.null` filter, so the worker never
-- fetched them. This was a REPORTING defect — "the queue" read 1,406 when the
-- worker's real working set was 160 — not a throughput one. (An earlier draft of
-- this migration claimed they re-qualified every tick and inflated the tally.
-- That was wrong, and would have been the same sin as the tally it criticised.)
--
-- WHAT ACTUALLY UNLOCKS VALUE is the second half: 168 of those "linked" owners
-- are linked to a PHANTOM — the company's own name minted as a person, no email,
-- no phone (P162). They hold $242.7M of annual rent and include LCC's single
-- largest owner by rent, Boyd Watterson Asset Management (198 assets, $179.8M),
-- whose recorded decision-maker was a person entity named "Boyd Watterson".
-- Both the view AND the handler filter treated them as done, from opposite
-- sides, so nothing ever worked them.
--
-- Queue 1,403 -> 324: 156 with no contact yet + 168 phantom-blocked, and ZERO
-- rows the worker can do nothing with.
--
-- ONE OWNER OF THE RULE. The handler's `&active_contact_entity_id=is.null`
-- filter is REMOVED in the paired JS change; this predicate replaces it. Keeping
-- both would re-exclude the phantoms and make the whole fix inert while still
-- measuring as shipped — the failure mode this repo keeps re-learning.
--
-- VERIFICATION GATE:
--   select count(*) filter (where active_contact_entity_id is not null
--                             and not active_contact_is_phantom)
--     from v_owner_contact_enrich_queue;              -- expect 0
--   select count(*) from v_owner_contact_enrich_queue; -- expect ~324
--
-- REVERSAL: restore the pre-P163 body from git history AND restore the
--           handler's is.null filter — the two must move together.
-- ============================================================================
create or replace view v_owner_contact_enrich_queue as
 SELECT p.entity_id, p.owner_name, p.workspace_id, p.active_contact_name,
    p.active_contact_entity_id, p.active_authority_level, p.active_contact_role,
    p.enrichment_action, p.status, p.updated_at,
    COALESCE(NULLIF(pa.current_annual_rent_total, 0::numeric), cv.connected_property_value) AS rank_value,
    (p.entity_id IN (SELECT w.owner_entity_id FROM v_lcc_phantom_owner_contact_worklist w
                      WHERE w.confidence = 'phantom_no_contact_detail')) AS active_contact_is_phantom
   FROM owner_contact_pivot p
     LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = p.entity_id
     LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = p.entity_id
  WHERE p.enrichment_action IS DISTINCT FROM 'manual_research'::text
    AND p.enrichment_action IS DISTINCT FROM 'find_person_at_manager'::text
    AND NOT (EXISTS ( SELECT 1 FROM research_tasks t
          WHERE t.entity_id = p.entity_id AND t.research_type = 'owner_contact_manual'::text
            AND (t.status = ANY (ARRAY['queued'::research_status, 'in_progress'::research_status]))))
    AND (p.active_contact_entity_id IS NULL
         OR p.entity_id IN (SELECT w.owner_entity_id FROM v_lcc_phantom_owner_contact_worklist w
                             WHERE w.confidence = 'phantom_no_contact_detail'));
