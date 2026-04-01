-- ============================================================================
-- 010: Domain Seeds — Bootstrap Government and Dialysis domains
-- Life Command Center — Phase 7: Domain Expansion Framework
--
-- Idempotent: Uses ON CONFLICT to skip if already exists.
-- Run after all previous migrations.
-- ============================================================================

-- ============================================================================
-- GOVERNMENT DOMAIN
-- ============================================================================

insert into domains (workspace_id, slug, display_name, description, color, icon, config)
select
  w.id,
  'government',
  'Government Properties',
  'Federal, state, and local government real estate — GSA, VA, DOD, and municipal assets',
  '#10b981',
  'building-government',
  '{
    "sectors": ["federal", "state", "municipal", "military"],
    "property_types": ["office", "warehouse", "land", "mixed_use", "courthouse", "lab"],
    "lease_types": ["gsa_lease", "oba", "direct", "sbp"]
  }'::jsonb
from workspaces w
where not exists (select 1 from domains d where d.workspace_id = w.id and d.slug = 'government')
limit 1;

-- Government data source
insert into domain_data_sources (domain_id, workspace_id, source_type, display_name, connection_config, api_proxy_path)
select
  d.id,
  d.workspace_id,
  'supabase',
  'Government Supabase',
  '{"project": "gov", "env_url": "GOV_SUPABASE_URL", "env_key": "GOV_SUPABASE_KEY"}'::jsonb,
  '/api/gov-query'
from domains d
where d.slug = 'government'
  and not exists (
    select 1 from domain_data_sources ds
    where ds.domain_id = d.id and ds.api_proxy_path = '/api/gov-query'
  );

-- Government entity mappings: properties
insert into domain_entity_mappings (domain_id, workspace_id, source_table, target_entity_type, field_mapping)
select
  d.id,
  d.workspace_id,
  'properties',
  'asset',
  '{
    "name": "{address} - {city}, {state}",
    "address": "address",
    "city": "city",
    "state": "state",
    "status": "pipeline_status",
    "_external_id": "id",
    "_metadata": {"source_fields": ["zip", "square_footage", "agency", "lease_number", "expiration_date"]}
  }'::jsonb
from domains d
where d.slug = 'government'
  and not exists (
    select 1 from domain_entity_mappings dem
    where dem.domain_id = d.id and dem.source_table = 'properties'
  );

-- Government entity mappings: players → companies
insert into domain_entity_mappings (domain_id, workspace_id, source_table, target_entity_type, field_mapping)
select
  d.id,
  d.workspace_id,
  'players',
  'organization',
  '{
    "name": "company_name",
    "city": "city",
    "state": "state",
    "status": "status",
    "_external_id": "id",
    "_metadata": {"source_fields": ["contact_name", "phone", "email", "player_type"]}
  }'::jsonb
from domains d
where d.slug = 'government'
  and not exists (
    select 1 from domain_entity_mappings dem
    where dem.domain_id = d.id and dem.source_table = 'players'
  );

-- Government queue configs: pipeline
insert into domain_queue_configs (domain_id, workspace_id, queue_type, source_table, title_template, priority_expression, filter_expression)
select
  d.id,
  d.workspace_id,
  'pipeline',
  'properties',
  '{address} - {city}, {state}',
  $$CASE WHEN expiration_date < NOW() + INTERVAL '6 months' THEN 10 ELSE 50 END$$,
  $$pipeline_status IN ('hot','warm','active')$$
from domains d
where d.slug = 'government'
  and not exists (
    select 1 from domain_queue_configs dqc
    where dqc.domain_id = d.id and dqc.queue_type = 'pipeline' and dqc.source_table = 'properties'
  );

-- Government queue configs: research
insert into domain_queue_configs (domain_id, workspace_id, queue_type, source_table, title_template, filter_expression)
select
  d.id,
  d.workspace_id,
  'research',
  'ownership_records',
  'Verify ownership: {property_address}',
  $$verified = false$$
from domains d
where d.slug = 'government'
  and not exists (
    select 1 from domain_queue_configs dqc
    where dqc.domain_id = d.id and dqc.queue_type = 'research'
  );

-- ============================================================================
-- DIALYSIS DOMAIN
-- ============================================================================

insert into domains (workspace_id, slug, display_name, description, color, icon, config)
select
  w.id,
  'dialysis',
  'Dialysis Clinics',
  'Dialysis clinic real estate — DaVita, Fresenius, independent providers, CMS data',
  '#f0abfc',
  'heart-pulse',
  '{
    "providers": ["davita", "fresenius", "us_renal", "dialysis_clinic_inc", "independent"],
    "data_feeds": ["cms", "npi"]
  }'::jsonb
from workspaces w
where not exists (select 1 from domains d where d.workspace_id = w.id and d.slug = 'dialysis')
limit 1;

-- Dialysis data source
insert into domain_data_sources (domain_id, workspace_id, source_type, display_name, connection_config, api_proxy_path)
select
  d.id,
  d.workspace_id,
  'supabase',
  'Dialysis Supabase',
  '{"project": "dia", "env_url": "DIA_SUPABASE_URL", "env_key": "DIA_SUPABASE_KEY"}'::jsonb,
  '/api/dia-query'
from domains d
where d.slug = 'dialysis'
  and not exists (
    select 1 from domain_data_sources ds
    where ds.domain_id = d.id and ds.api_proxy_path = '/api/dia-query'
  );

-- Dialysis entity mappings: clinics
insert into domain_entity_mappings (domain_id, workspace_id, source_table, target_entity_type, field_mapping)
select
  d.id,
  d.workspace_id,
  'clinics',
  'asset',
  '{
    "name": "{provider_name} - {city}, {state}",
    "address": "address",
    "city": "city",
    "state": "state",
    "status": "status",
    "_external_id": "cms_id",
    "_metadata": {"source_fields": ["provider_name", "cms_id", "npi", "stations", "profit_status"]}
  }'::jsonb
from domains d
where d.slug = 'dialysis'
  and not exists (
    select 1 from domain_entity_mappings dem
    where dem.domain_id = d.id and dem.source_table = 'clinics'
  );

-- Dialysis entity mappings: providers → companies
insert into domain_entity_mappings (domain_id, workspace_id, source_table, target_entity_type, field_mapping)
select
  d.id,
  d.workspace_id,
  'providers',
  'organization',
  '{
    "name": "provider_name",
    "status": "status",
    "_external_id": "id"
  }'::jsonb
from domains d
where d.slug = 'dialysis'
  and not exists (
    select 1 from domain_entity_mappings dem
    where dem.domain_id = d.id and dem.source_table = 'providers'
  );

-- Dialysis queue configs: pipeline
insert into domain_queue_configs (domain_id, workspace_id, queue_type, source_table, title_template, priority_expression, filter_expression)
select
  d.id,
  d.workspace_id,
  'pipeline',
  'clinics',
  '{provider_name} - {city}, {state}',
  $$CASE WHEN stations > 20 THEN 10 ELSE 40 END$$,
  $$status IN ('lead','prospect')$$
from domains d
where d.slug = 'dialysis'
  and not exists (
    select 1 from domain_queue_configs dqc
    where dqc.domain_id = d.id and dqc.queue_type = 'pipeline'
  );
