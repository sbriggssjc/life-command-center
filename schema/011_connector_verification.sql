-- ============================================================================
-- 011: Connector Verification and Isolation Support
-- Life Command Center — RG2: Per-user connector validation
-- ============================================================================

-- Add source_user_context to sync_jobs for audit and isolation verification
alter table sync_jobs
  add column if not exists source_user_context jsonb;

comment on column sync_jobs.source_user_context is
  'Captures external_user_id, connector_type, execution_method, flow_id, and tenant_id at sync time for audit and isolation checks';

-- Add verification columns to connector_accounts
alter table connector_accounts
  add column if not exists verified_at timestamptz,
  add column if not exists verification_result jsonb;

comment on column connector_accounts.verified_at is
  'Last time this connector was probed for per-user data access';
comment on column connector_accounts.verification_result is
  'Result of the last connector verification probe (reachable, user_scoped, status)';

-- Index for isolation checks: find items by source_connector_id and source_user_id
create index if not exists idx_inbox_items_connector_user
  on inbox_items(source_connector_id, source_user_id)
  where source_connector_id is not null;

create index if not exists idx_activity_events_connector_user
  on activity_events(source_connector_id, actor_id)
  where source_connector_id is not null;

-- View: connector onboarding checklist per user
create or replace view v_connector_checklist as
select
  ca.workspace_id,
  ca.user_id,
  u.display_name,
  u.email,
  -- Outlook checks
  max(case when ca.connector_type = 'outlook' then ca.id end) as outlook_connector_id,
  max(case when ca.connector_type = 'outlook' then ca.status::text end) as outlook_status,
  max(case when ca.connector_type = 'outlook' then ca.external_user_id end) as outlook_external_id,
  max(case when ca.connector_type = 'outlook' then ca.last_sync_at end) as outlook_last_sync,
  max(case when ca.connector_type = 'outlook' then ca.verified_at end) as outlook_verified_at,
  -- Salesforce checks
  max(case when ca.connector_type = 'salesforce' then ca.id end) as sf_connector_id,
  max(case when ca.connector_type = 'salesforce' then ca.status::text end) as sf_status,
  max(case when ca.connector_type = 'salesforce' then ca.external_user_id end) as sf_external_id,
  max(case when ca.connector_type = 'salesforce' then ca.last_sync_at end) as sf_last_sync,
  max(case when ca.connector_type = 'salesforce' then ca.verified_at end) as sf_verified_at,
  -- Overall readiness
  bool_and(ca.status in ('healthy', 'degraded')) as all_connectors_active,
  bool_and(ca.external_user_id is not null) as all_identities_set
from connector_accounts ca
join users u on u.id = ca.user_id
group by ca.workspace_id, ca.user_id, u.display_name, u.email;
