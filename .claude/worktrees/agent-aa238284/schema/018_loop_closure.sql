-- ============================================================================
-- 018: Loop Closure, Manual Review, and Audit Tables
-- Life Command Center
-- ============================================================================

create table if not exists pending_updates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  target_source text not null check (target_source in ('gov', 'dia', 'ops', 'salesforce', 'outlook', 'power_automate')),
  target_table text not null,
  record_identifier text not null,
  id_column text not null,
  source_surface text,
  actor text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'needs_review', 'failed')),
  changed_fields jsonb not null default '{}',
  notes text,
  error_details jsonb default '{}',
  reconciliation jsonb default '{}',
  propagation jsonb default '{}',
  propagation_scope text,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists data_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  pending_update_id uuid references pending_updates(id) on delete set null,
  actor text not null,
  source_surface text,
  target_source text not null,
  target_table text not null,
  record_identifier text not null,
  id_column text not null,
  changed_fields jsonb not null default '{}',
  notes text,
  applied_mode text not null default 'mutation_service',
  propagation_scope text,
  reconciliation_result jsonb default '{}',
  propagation_result jsonb default '{}',
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_pending_updates_workspace_status
  on pending_updates(workspace_id, status, created_at desc);

create index if not exists idx_pending_updates_target
  on pending_updates(target_source, target_table, record_identifier);

create index if not exists idx_data_corrections_workspace_time
  on data_corrections(workspace_id, applied_at desc);

create index if not exists idx_data_corrections_pending
  on data_corrections(pending_update_id)
  where pending_update_id is not null;

alter table pending_updates enable row level security;
alter table data_corrections enable row level security;
