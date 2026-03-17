-- ============================================================================
-- 016: Connector Onboarding — Register Outlook + Salesforce connectors
-- Life Command Center — Run after 014 (bootstrap) and 015 (config)
--
-- Registers per-user connector accounts for the owner.
-- Both connectors use Power Automate mediation (not direct API).
-- ============================================================================

-- 1. Outlook connector (email + calendar sync via Power Automate)
insert into connector_accounts (
  workspace_id, user_id, connector_type, execution_method,
  display_name, status, external_user_id, config
)
values (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'outlook',
  'power_automate',
  'Outlook — sbriggssjc@gmail.com',
  'pending_setup',
  'sbriggssjc@gmail.com',
  '{"sync_flagged_emails": true, "sync_calendar": true}'::jsonb
)
on conflict do nothing;

-- 2. Salesforce connector (activity sync via Edge Function)
insert into connector_accounts (
  workspace_id, user_id, connector_type, execution_method,
  display_name, status, config
)
values (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'salesforce',
  'direct_api',
  'Salesforce — Briggsland Capital',
  'pending_setup',
  '{"sync_tasks": true, "sync_activities": true}'::jsonb
)
on conflict do nothing;

-- 3. Verify
select
  connector_type,
  execution_method,
  display_name,
  status,
  external_user_id
from connector_accounts
where workspace_id = 'a0000000-0000-0000-0000-000000000001'
order by connector_type;
