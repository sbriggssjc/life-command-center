-- ============================================================================
-- 001: Workspace, Users, Roles, Membership
-- Life Command Center — Canonical Schema
-- ============================================================================

-- Workspaces
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Roles
create type user_role as enum ('owner', 'manager', 'operator', 'viewer');

-- Workspace membership
create table if not exists workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role user_role not null default 'operator',
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- User preferences (per-workspace)
create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  preferences jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);

-- Indexes
create index idx_memberships_workspace on workspace_memberships(workspace_id);
create index idx_memberships_user on workspace_memberships(user_id);
create index idx_preferences_user on user_preferences(user_id);

-- Row-level security policies
alter table workspaces enable row level security;
alter table users enable row level security;
alter table workspace_memberships enable row level security;
alter table user_preferences enable row level security;
