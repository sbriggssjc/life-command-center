-- ============================================================================
-- 005: Domain Registry and Data Source Mapping
-- Life Command Center — Canonical Schema
-- ============================================================================

-- Domain registry — each vertical plugs into the shared operational shell
create table if not exists domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug text not null,                         -- 'government', 'dialysis', 'daycare', 'urgent_care'
  display_name text not null,
  description text,
  color text,                                 -- UI accent color
  icon text,                                  -- Icon identifier
  is_active boolean not null default true,
  config jsonb not null default '{}',         -- Domain-specific configuration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

-- Domain data sources — maps external databases to domain
create table if not exists domain_data_sources (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_type text not null,                  -- 'supabase', 'api', 'csv', 'manual'
  display_name text not null,
  connection_config jsonb not null default '{}', -- Non-secret connection params (project ID, URL)
  api_proxy_path text,                        -- e.g., '/api/gov-query', '/api/dia-query'
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Domain entity mappings — how domain source records map to canonical entities
create table if not exists domain_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_table text not null,                 -- Table/view in domain database
  target_entity_type entity_type not null,    -- Which canonical entity type
  field_mapping jsonb not null,               -- Maps source columns to entity fields
  filter_expression text,                     -- Optional filter for which rows to map
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Domain queue configs — how domain records feed into the unified queue
create table if not exists domain_queue_configs (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  queue_type text not null,                   -- 'research', 'review', 'pipeline', 'triage'
  source_table text not null,
  title_template text not null,               -- e.g., '{address} - {city}, {state}'
  priority_expression text,                   -- SQL expression for priority calculation
  filter_expression text,                     -- Which rows to include
  config jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_domains_workspace on domains(workspace_id);
create index idx_domains_slug on domains(workspace_id, slug);
create index idx_data_sources_domain on domain_data_sources(domain_id);
create index idx_entity_mappings_domain on domain_entity_mappings(domain_id);
create index idx_queue_configs_domain on domain_queue_configs(domain_id);

-- RLS
alter table domains enable row level security;
alter table domain_data_sources enable row level security;
alter table domain_entity_mappings enable row level security;
alter table domain_queue_configs enable row level security;
