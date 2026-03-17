-- ============================================================================
-- 002: Connector Accounts and Sync Tracking
-- Life Command Center — Canonical Schema
-- ============================================================================

-- Connector types
create type connector_type as enum (
  'salesforce',
  'outlook',
  'power_automate',
  'supabase_domain',
  'webhook'
);

-- Execution method — how the connector actually runs
create type execution_method as enum (
  'direct_api',       -- LCC calls the external API directly
  'power_automate',   -- Mediated through Power Automate flows
  'webhook',          -- External system pushes to LCC
  'manual'            -- Human-triggered sync
);

-- Connector health status
create type connector_status as enum (
  'healthy',
  'degraded',
  'error',
  'disconnected',
  'pending_setup'
);

-- Per-user connector accounts
create table if not exists connector_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  connector_type connector_type not null,
  execution_method execution_method not null default 'power_automate',
  display_name text not null,
  status connector_status not null default 'pending_setup',
  config jsonb not null default '{}',         -- Non-secret configuration
  external_user_id text,                       -- User identity in external system
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sync jobs — tracks each sync run
create type sync_job_status as enum (
  'pending',
  'running',
  'completed',
  'failed',
  'partial'
);

create table if not exists sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connector_account_id uuid not null references connector_accounts(id) on delete cascade,
  correlation_id text,                         -- For tracing across Power Automate
  status sync_job_status not null default 'pending',
  direction text not null check (direction in ('inbound', 'outbound')),
  entity_type text,                            -- What was synced (e.g., 'flagged_email', 'sf_activity')
  records_processed int not null default 0,
  records_failed int not null default 0,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Sync errors — individual record-level failures
create table if not exists sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references sync_jobs(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connector_account_id uuid not null references connector_accounts(id) on delete cascade,
  external_id text,                            -- ID in the source system
  error_code text,
  error_message text not null,
  record_snapshot jsonb,                       -- The record that failed
  is_retryable boolean not null default true,
  retry_count int not null default 0,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_connector_accounts_workspace on connector_accounts(workspace_id);
create index idx_connector_accounts_user on connector_accounts(user_id);
create index idx_connector_accounts_type on connector_accounts(connector_type);
create index idx_sync_jobs_connector on sync_jobs(connector_account_id);
create index idx_sync_jobs_status on sync_jobs(status);
create index idx_sync_jobs_created on sync_jobs(created_at desc);
create index idx_sync_errors_job on sync_errors(sync_job_id);
create index idx_sync_errors_unresolved on sync_errors(workspace_id) where resolved_at is null;

-- RLS
alter table connector_accounts enable row level security;
alter table sync_jobs enable row level security;
alter table sync_errors enable row level security;
