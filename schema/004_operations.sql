-- ============================================================================
-- 004: Operational Model — Inbox, Actions, Activities
-- Life Command Center — Canonical Schema
-- ============================================================================

-- ============================================================================
-- INBOX ITEMS
-- Normalized container for anything that arrives and needs triage:
-- flagged emails, Salesforce tasks, sync exceptions, research results, etc.
-- ============================================================================

create type inbox_status as enum (
  'new',
  'triaged',
  'promoted',         -- Converted to an action_item
  'dismissed',
  'archived'
);

create type visibility_scope as enum (
  'private',          -- Only source user sees it
  'assigned',         -- Owner + assignee(s) see it
  'shared'            -- All workspace members see it
);

create table if not exists inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Ownership
  source_user_id uuid not null references users(id),
  assigned_to uuid references users(id),
  visibility visibility_scope not null default 'private',

  -- Content
  title text not null,
  body text,
  source_type text not null,                  -- 'flagged_email', 'sf_task', 'sync_error', 'research', 'manual'
  source_connector_id uuid references connector_accounts(id),
  external_id text,                           -- ID in the source system
  external_url text,                          -- Deep link to source

  -- Classification
  status inbox_status not null default 'new',
  priority text check (priority in ('urgent', 'high', 'normal', 'low')),
  entity_id uuid references entities(id),     -- Linked canonical entity
  domain text,                                -- 'government', 'dialysis', null
  tags text[] default '{}',

  -- Metadata
  metadata jsonb default '{}',
  received_at timestamptz not null default now(),
  triaged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- ACTION ITEMS
-- The canonical unit of work — anything someone needs to do.
-- Created from inbox promotion, direct creation, or sync ingestion.
-- ============================================================================

create type action_status as enum (
  'open',
  'in_progress',
  'waiting',          -- Blocked on external response
  'completed',
  'cancelled'
);

create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Ownership
  created_by uuid not null references users(id),
  owner_id uuid not null references users(id),
  assigned_to uuid references users(id),
  visibility visibility_scope not null default 'shared',

  -- Content
  title text not null,
  description text,
  action_type text not null,                  -- 'call', 'email', 'research', 'follow_up', 'site_visit', 'data_entry', 'review'

  -- State
  status action_status not null default 'open',
  priority text check (priority in ('urgent', 'high', 'normal', 'low')) default 'normal',
  due_date date,
  completed_at timestamptz,

  -- Linking
  entity_id uuid references entities(id),     -- Linked canonical entity
  inbox_item_id uuid references inbox_items(id), -- Source inbox item (if promoted)
  domain text,
  tags text[] default '{}',

  -- Source tracking
  source_type text,                           -- 'inbox_promotion', 'sf_sync', 'manual', 'research'
  source_connector_id uuid references connector_accounts(id),
  external_id text,
  external_url text,

  -- Metadata
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- ACTIVITY EVENTS
-- Immutable log of everything that happened — calls, emails, syncs,
-- status changes, assignments, notes. The canonical timeline.
-- ============================================================================

create type activity_category as enum (
  'call',
  'email',
  'meeting',
  'note',
  'status_change',
  'assignment',
  'sync',
  'research',
  'system'
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Who
  actor_id uuid not null references users(id),
  visibility visibility_scope not null default 'shared',

  -- What
  category activity_category not null,
  title text not null,
  body text,
  metadata jsonb default '{}',

  -- Linking
  entity_id uuid references entities(id),
  action_item_id uuid references action_items(id),
  inbox_item_id uuid references inbox_items(id),

  -- Source
  source_type text,                           -- 'salesforce', 'outlook', 'manual', 'system'
  source_connector_id uuid references connector_accounts(id),
  external_id text,
  external_url text,

  -- Domain
  domain text,

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RESEARCH TASKS
-- Domain-specific research queue items
-- ============================================================================

create type research_status as enum (
  'queued',
  'in_progress',
  'completed',
  'skipped'
);

create table if not exists research_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Ownership
  assigned_to uuid references users(id),
  created_by uuid references users(id),

  -- Content
  research_type text not null,                -- 'ownership', 'lease_backfill', 'clinic_lead', 'entity_enrichment'
  title text not null,
  instructions text,
  entity_id uuid references entities(id),
  domain text not null,

  -- State
  status research_status not null default 'queued',
  priority int not null default 50,           -- 0 = highest
  outcome jsonb,                              -- Results of the research
  completed_at timestamptz,

  -- Source
  source_record_id text,                      -- ID in domain database
  source_table text,                          -- Source table in domain database

  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Inbox
create index idx_inbox_workspace_status on inbox_items(workspace_id, status);
create index idx_inbox_assigned on inbox_items(assigned_to) where status in ('new', 'triaged');
create index idx_inbox_source_user on inbox_items(source_user_id);
create index idx_inbox_entity on inbox_items(entity_id) where entity_id is not null;
create index idx_inbox_received on inbox_items(received_at desc);

-- Actions
create index idx_actions_workspace_status on action_items(workspace_id, status);
create index idx_actions_owner on action_items(owner_id) where status in ('open', 'in_progress', 'waiting');
create index idx_actions_assigned on action_items(assigned_to) where status in ('open', 'in_progress', 'waiting');
create index idx_actions_due on action_items(due_date) where status in ('open', 'in_progress', 'waiting');
create index idx_actions_entity on action_items(entity_id) where entity_id is not null;

-- Activities
create index idx_activities_workspace on activity_events(workspace_id);
create index idx_activities_entity on activity_events(entity_id) where entity_id is not null;
create index idx_activities_action on activity_events(action_item_id) where action_item_id is not null;
create index idx_activities_actor on activity_events(actor_id);
create index idx_activities_occurred on activity_events(occurred_at desc);
create index idx_activities_category on activity_events(workspace_id, category);

-- Research
create index idx_research_workspace_status on research_tasks(workspace_id, status);
create index idx_research_assigned on research_tasks(assigned_to) where status in ('queued', 'in_progress');
create index idx_research_domain on research_tasks(domain);
create index idx_research_priority on research_tasks(priority) where status = 'queued';

-- RLS
alter table inbox_items enable row level security;
alter table action_items enable row level security;
alter table activity_events enable row level security;
alter table research_tasks enable row level security;
