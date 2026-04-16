-- ============================================================================
-- 003: Canonical Entity Model
-- Life Command Center — Canonical Schema
-- ============================================================================

-- Entity types
create type entity_type as enum (
  'person',
  'organization',
  'asset'           -- property, clinic, facility
);

-- Canonical entities — the unified business entity model
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type entity_type not null,

  -- Common fields
  name text not null,
  canonical_name text not null,               -- Normalized for dedup (lowercase, stripped suffixes)
  description text,

  -- Person-specific
  first_name text,
  last_name text,
  title text,
  phone text,
  email text,

  -- Organization-specific
  org_type text,                              -- e.g., 'operator', 'owner', 'lender', 'agency'

  -- Asset-specific
  address text,
  city text,
  state text,
  zip text,
  county text,
  latitude numeric,
  longitude numeric,
  asset_type text,                            -- e.g., 'government_leased', 'dialysis_clinic'

  -- Metadata
  domain text,                                -- 'government', 'dialysis', null for cross-domain
  tags text[] default '{}',
  metadata jsonb default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- External identity mapping — links entities to external system records
create table if not exists external_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  source_system text not null,                -- 'salesforce', 'gov_supabase', 'dia_supabase', 'outlook'
  source_type text not null,                  -- 'contact', 'account', 'property', 'clinic', 'lead'
  external_id text not null,                  -- ID in the source system
  external_url text,                          -- Deep link to the source record
  metadata jsonb default '{}',                -- Extra source-specific fields
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, source_system, source_type, external_id)
);

-- Entity aliases — for deduplication and name normalization
create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  alias_name text not null,
  alias_canonical text not null,              -- Normalized form
  source text,                                -- Where this alias was found
  created_at timestamptz not null default now(),
  unique (workspace_id, alias_canonical)
);

-- Entity relationships
create table if not exists entity_relationships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_entity_id uuid not null references entities(id) on delete cascade,
  to_entity_id uuid not null references entities(id) on delete cascade,
  relationship_type text not null,            -- 'owns', 'operates', 'leases', 'employs', 'contacts'
  metadata jsonb default '{}',
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_entities_workspace on entities(workspace_id);
create index idx_entities_type on entities(entity_type);
create index idx_entities_domain on entities(domain);
create index idx_entities_canonical on entities(workspace_id, canonical_name);
create index idx_entities_state on entities(state) where entity_type = 'asset';
create index idx_entities_city on entities(city) where entity_type = 'asset';

create index idx_ext_ids_entity on external_identities(entity_id);
create index idx_ext_ids_source on external_identities(workspace_id, source_system, external_id);

create index idx_aliases_entity on entity_aliases(entity_id);
create index idx_aliases_canonical on entity_aliases(workspace_id, alias_canonical);

create index idx_relationships_from on entity_relationships(from_entity_id);
create index idx_relationships_to on entity_relationships(to_entity_id);

-- RLS
alter table entities enable row level security;
alter table external_identities enable row level security;
alter table entity_aliases enable row level security;
alter table entity_relationships enable row level security;
