-- ===========================================================================
-- P123 -- seed the sf.opportunities connector bridge (prerequisite for the flow)
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- Runbook: docs/RUNBOOK_sf_opportunity_inbound_flow.md
-- ===========================================================================
-- P122 registered the inbound SF Opportunity sync as dormant. Turning it on is
-- NOT just building a Power-Automate flow: handleIngestRoute looks the bridge up
-- with getBridgeByKey() and returns
--     404 {"error":"Bridge not seeded: sf.opportunities"}
-- before it reads a single record. Live check: connector_bridges held exactly
-- ONE row (outlook.messages) -- there was no sf.* bridge at all, for any object.
--
-- This seeds the row so the endpoint accepts a POST. Inert until a flow actually
-- posts to it, so seeding on its own is safe.
--
-- ALLOWLIST = exactly the fields handleSalesforceOpportunityUpsert reads. The
-- bridge drops anything not listed AT INGEST -- that is the privacy contract,
-- the same mechanism that deliberately excludes message bodies on
-- outlook.messages. Amount is the whole point: without it,
-- bd_opportunities.amount stays NULL on all 614 rows and every deal in the BD
-- spine remains value-blind.
--
-- DEPENDENCY, verified rather than assumed: the handler resolves each
-- opportunity's parent Account via findEntityBySfId(ws,'Account',AccountId) and
-- DEFERS the job when the account is unknown. Live: 16,235 salesforce/Account
-- external_identities already exist in workspace a0000000-...-0001, so accounts
-- resolve and no sf.accounts bridge has to be built first.
--
-- ⚠ KNOWN GAP, documented in the runbook §0 and §5: this handler appends to
-- entities.metadata.salesforce.opportunities[] and does NOT write
-- bd_opportunities.amount. The flow alone therefore does not fix the
-- value-blindness -- a second fill-blanks hop (metadata -> bd_opportunities,
-- matched on sf_opp_id) is required, and is deliberately NOT shipped here
-- because it would be a no-op until the flow runs, and a no-op that looks
-- healthy is precisely the failure P122 was about.
--
-- Reversible: DELETE FROM connector_bridges WHERE bridge_key='sf.opportunities';
-- ===========================================================================

INSERT INTO connector_bridges
  (workspace_id, bridge_key, source_system, direction, ownership, owner_user_id,
   allowlist, write_policy, status, notes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'sf.opportunities',
  'salesforce',
  'inbound',
  'service_account',   -- org-wide CRM data, not a personal mailbox
  NULL,
  jsonb_build_object('Opportunity', jsonb_build_array(
    'Id', 'AccountId', 'Name', 'StageName', 'Amount', 'CloseDate',
    'Probability', 'Type', 'OwnerId', 'LastModifiedDate', 'IsClosed', 'IsWon'
  )),
  'none',              -- inbound only; never writes back to Salesforce
  'active',
  'P123: seeded so /api/bridges?_route=ingest&_source=salesforce&bridge=sf.opportunities stops 404ing. Carries SF Amount/StageName/CloseDate into LCC -- the only path that can populate bd_opportunities.amount (NULL on all 614 rows as of 2026-08-17). Inert until a Power-Automate flow posts to it; flip feature_flags_registry.SF_OPPORTUNITY_INBOUND_SYNC to on when it does. See docs/RUNBOOK_sf_opportunity_inbound_flow.md.'
)
ON CONFLICT (workspace_id, bridge_key) DO UPDATE SET
  allowlist  = EXCLUDED.allowlist,
  status     = EXCLUDED.status,
  notes      = EXCLUDED.notes,
  updated_at = now();
