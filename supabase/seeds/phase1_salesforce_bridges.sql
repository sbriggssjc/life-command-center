-- ============================================================================
-- Phase 1 — Seed connector_bridges rows for the four sf.* bridges
-- ----------------------------------------------------------------------------
-- Run this manually per workspace. Pass the workspace id via psql variable:
--
--   psql "$OPS_SUPABASE_DB_URL" \
--     -v workspace_id="'00000000-0000-0000-0000-000000000000'" \
--     -f supabase/seeds/phase1_salesforce_bridges.sql
--
-- The seed is idempotent — re-running updates the allowlists in place
-- (ON CONFLICT DO UPDATE) but never resets watermarks or last_run timestamps.
--
-- Bridge ownership defaults to 'service_account'. Flip to 'personal' and set
-- owner_user_id if your org runs these flows under an individual's PA
-- connection rather than a shared service account.
-- ============================================================================

\set ws :workspace_id

-- ---- sf.accounts -----------------------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sf.accounts', 'salesforce', 'inbound', 'service_account',
  '*/5 * * * *', 'active',
  jsonb_build_object('Account', jsonb_build_array(
    'Id','Name','Type','Industry',
    'BillingStreet','BillingCity','BillingState','BillingPostalCode','BillingCountry',
    'Phone','Website','ParentId','OwnerId',
    'CreatedDate','LastModifiedDate'
  )),
  'none', '{}'::jsonb,
  'Read-only mirror of corporate Salesforce Accounts touching tracked entities. ' ||
  'Power Automate flow runs every 5 min, queries SOQL with LastModifiedDate > watermark.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- sf.contacts -----------------------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sf.contacts', 'salesforce', 'inbound', 'service_account',
  '*/5 * * * *', 'active',
  jsonb_build_object('Contact', jsonb_build_array(
    'Id','AccountId','FirstName','LastName','Name',
    'Email','Phone','MobilePhone','Title',
    'MailingStreet','MailingCity','MailingState','MailingPostalCode',
    'OwnerId','CreatedDate','LastModifiedDate'
  )),
  'none', '{}'::jsonb,
  'Read-only mirror of SF Contacts. Worker upserts entities + external_identities + ' ||
  'unified_contacts.sf_*. Personal/private contacts (contact_class=personal) are never synced.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- sf.opportunities ------------------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sf.opportunities', 'salesforce', 'inbound', 'service_account',
  '*/5 * * * *', 'active',
  jsonb_build_object('Opportunity', jsonb_build_array(
    'Id','AccountId','Name','StageName','Amount','CloseDate',
    'Probability','OwnerId','RecordTypeId','Type',
    'CreatedDate','LastModifiedDate'
  )),
  'none', '{}'::jsonb,
  'Read-only mirror of SF Opportunities. Worker appends to entities.metadata.salesforce.opportunities[] ' ||
  'on the linked Account entity. No separate deals table for now.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- sf.activities ---------------------------------------------------------
-- The competitive-intel bridge. Tasks + Events both flow here.
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sf.activities', 'salesforce', 'inbound', 'service_account',
  '*/5 * * * *', 'active',
  jsonb_build_object('Activity', jsonb_build_array(
    'Id','WhoId','WhatId','AccountId','Subject',
    'ActivityDate','TaskSubtype','EventSubtype','Type','CallType',
    'Status','Priority','OwnerId','Description','IsTask',
    'CreatedDate','LastModifiedDate'
  )),
  'none', '{}'::jsonb,
  'Tasks + Events that touch tracked Accounts/Contacts. Drives v_competitive_touches ' ||
  '("who else at Northmarq is calling this account?") and refreshes ' ||
  'unified_contacts.last_*_date counters.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- sf.touchpoint.log (outbound, paused until Phase 1.5) ------------------
-- Minimal write-back surface: log an LCC-originated touchpoint as a SF Task.
-- Paused on seed — flip status='active' once /api/salesforce-write is built
-- and the PA outbound flow is configured.
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sf.touchpoint.log', 'salesforce', 'outbound', 'service_account',
  'on_demand', 'paused',
  '{}'::jsonb,
  'minimal',
  jsonb_build_object('Task', jsonb_build_array(
    'WhoId','WhatId','Subject','Description','ActivityDate',
    'Type','Status','Priority'
  )),
  'Outbound: log an LCC touchpoint as a SF Task. Subject pattern ' ||
  '"LCC Touchpoint #<action_id>". Paused until the outbound endpoint ships in Phase 1.5.'
) on conflict (workspace_id, bridge_key) do update set
  write_allowlist = excluded.write_allowlist,
  write_policy    = excluded.write_policy,
  notes           = excluded.notes,
  updated_at      = now();
