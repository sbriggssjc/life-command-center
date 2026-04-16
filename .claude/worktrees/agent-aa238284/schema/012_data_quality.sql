-- ============================================================================
-- 012: Data Quality Views and Reconciliation Support
-- Life Command Center — RG3: Entity reconciliation
-- ============================================================================

-- View: duplicate entity candidates by canonical name
create or replace view v_duplicate_candidates as
select
  e.workspace_id,
  e.canonical_name,
  count(*) as duplicate_count,
  array_agg(e.id) as entity_ids,
  array_agg(e.name) as entity_names,
  array_agg(e.entity_type) as entity_types,
  array_agg(e.domain) as domains
from entities e
group by e.workspace_id, e.canonical_name
having count(*) > 1
order by count(*) desc;

-- View: entities without external identity links
create or replace view v_unlinked_entities as
select
  e.id,
  e.workspace_id,
  e.entity_type,
  e.name,
  e.domain,
  e.city,
  e.state,
  e.created_at
from entities e
left join external_identities ei on ei.entity_id = e.id
where ei.id is null
order by e.created_at desc;

-- View: stale external identities (not synced in 7+ days)
create or replace view v_stale_identities as
select
  ei.id,
  ei.workspace_id,
  ei.entity_id,
  e.name as entity_name,
  ei.source_system,
  ei.source_type,
  ei.external_id,
  ei.last_synced_at,
  now() - ei.last_synced_at as staleness
from external_identities ei
join entities e on e.id = ei.entity_id
where ei.last_synced_at < now() - interval '7 days'
   or ei.last_synced_at is null
order by ei.last_synced_at nulls first;

-- View: entity completeness scores
create or replace view v_entity_completeness as
select
  e.id,
  e.workspace_id,
  e.entity_type,
  e.name,
  e.domain,
  -- Completeness score (0-100) based on type-appropriate fields
  case e.entity_type
    when 'person' then
      (case when e.email is not null then 25 else 0 end +
       case when e.phone is not null then 25 else 0 end +
       case when e.first_name is not null then 15 else 0 end +
       case when e.last_name is not null then 15 else 0 end +
       case when e.title is not null then 10 else 0 end +
       case when e.domain is not null then 10 else 0 end)
    when 'organization' then
      (case when e.org_type is not null then 30 else 0 end +
       case when e.domain is not null then 20 else 0 end +
       case when e.description is not null then 20 else 0 end +
       case when e.city is not null then 15 else 0 end +
       case when e.state is not null then 15 else 0 end)
    when 'asset' then
      (case when e.address is not null then 25 else 0 end +
       case when e.city is not null then 15 else 0 end +
       case when e.state is not null then 15 else 0 end +
       case when e.zip is not null then 10 else 0 end +
       case when e.asset_type is not null then 15 else 0 end +
       case when e.domain is not null then 10 else 0 end +
       case when e.latitude is not null then 10 else 0 end)
    else 0
  end as completeness_score,
  -- Has external links
  exists(select 1 from external_identities ei where ei.entity_id = e.id) as has_external_link,
  -- Has aliases
  exists(select 1 from entity_aliases ea where ea.entity_id = e.id) as has_aliases,
  -- Active items count
  (select count(*) from action_items ai where ai.entity_id = e.id and ai.status not in ('completed', 'cancelled')) as active_actions
from entities e;

-- View: orphaned action items (no entity link where one is expected)
create or replace view v_orphaned_actions as
select
  ai.id,
  ai.workspace_id,
  ai.title,
  ai.status,
  ai.domain,
  ai.created_at
from action_items ai
where ai.entity_id is null
  and ai.status not in ('completed', 'cancelled')
  and ai.domain is not null  -- domain-tagged but no entity link
order by ai.created_at desc;

-- Source precedence configuration for field conflict resolution
-- When merging or syncing, fields from higher-precedence sources take priority
create table if not exists source_precedence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  field_name text not null,           -- 'name', 'email', 'address', 'phone', '*' for default
  source_system text not null,        -- 'salesforce', 'gov_supabase', 'dia_supabase', 'manual'
  precedence int not null default 50, -- higher = more authoritative (0-100)
  created_at timestamptz not null default now(),
  unique (workspace_id, field_name, source_system)
);

-- Default precedence: manual > salesforce > domain databases
-- (workspace can override via INSERT)
comment on table source_precedence is
  'Defines which source system is authoritative for each field when conflicts arise during sync or merge';

-- RLS
alter table source_precedence enable row level security;

-- Index for merge entity alias lookup
create index if not exists idx_aliases_canonical_search
  on entity_aliases(workspace_id, alias_canonical text_pattern_ops);
