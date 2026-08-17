-- ===========================================================================
-- P124 -- RETRACT P122/P123. There is no Salesforce Opportunity object.
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- See docs/RUNBOOK_sf_opportunity_inbound_flow.md (now a retraction notice).
-- ===========================================================================
-- Scott, 2026-08-17: "the Opportunities we track in Salesforce are open
-- Activities or Tasks with the field NM Type 'Opportunity' and remain open. We
-- don't have an object in Salesforce called Opportunities."
--
-- He is right, and the codebase already said so in three places I read past:
--   api/admin.js:16645  "create the SF Task on the primary CONTACT (WhoId). A
--                        government buyer carries NMType BLANK (never 'Opportunity')."
--   salesforce.js::createSalesforceTask -> { operation:'create_opportunity',
--                        who_id, subject, nm_type, status:'Open', activity_date, what_id }
--   api/admin.js:16664  bd_opportunities.sf_opp_id := sf.task.Id   <- a TASK id
--
-- THREE ERRORS
-- 1. WRONG OBJECT. P123's bridge handler reads p.AccountId / p.StageName /
--    p.Amount / p.CloseDate -- Opportunity fields. A Task has WhoId, WhatId,
--    Subject, Status, ActivityDate and the custom NM Type. None of those four
--    exist on it.
-- 2. WRONG TRANSPORT. This org's SF integration does not use /api/bridges at
--    all. It uses SF_LOOKUP_WEBHOOK_URL flow ops (create_opportunity,
--    opportunities_by_ids, find_account_by_name, owners_by_ids,
--    reassign_task_owner), documented in
--    docs/architecture/connectivity-and-open-threads.md sec C. connector_bridges
--    holding only outlook.messages was EVIDENCE OF A DIFFERENT ARCHITECTURE, and
--    I read it as a gap.
-- 3. THE PREMISE. P122 called the dormant sync "the ONLY path that would carry
--    SF Amount into LCC". A Task has no Amount field. bd_opportunities.amount is
--    not un-synced, it is UNFILLABLE from that source.
--
-- CONSEQUENCE FOR RANKING (checked): P121's flat $5,000 open-opportunity tier is
-- CORRECT, not a placeholder. A deal cannot be valued from its property either --
-- only 3 of 614 bd_opportunities rows carry a source_property_id (2 open). Deal
-- value reaches the ranking solely via the entity's portfolio rent, which
-- lcc_decision_entity_value already uses. The earlier "re-evaluate once amounts
-- land" note is WITHDRAWN.
--
-- Reversible by re-running P122/P123, which should not be done.
-- ===========================================================================

DELETE FROM connector_bridges
 WHERE bridge_key = 'sf.opportunities'
   AND workspace_id = 'a0000000-0000-0000-0000-000000000001';

DELETE FROM feature_flags_registry
 WHERE flag = 'SF_OPPORTUNITY_INBOUND_SYNC';
