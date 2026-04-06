-- ============================================================================
-- 015: Add config JSONB column to workspaces
-- Life Command Center — Required by Feature Flags API (/api/flags)
--
-- Stores per-workspace configuration including feature_flags overrides.
-- ============================================================================

alter table workspaces
  add column if not exists config jsonb not null default '{}';

-- Seed Stage 1 feature flags for Northmarq - Briggs
update workspaces
set config = jsonb_build_object(
  'feature_flags', jsonb_build_object(
    'ops_pages_enabled', true,
    'more_drawer_enabled', true,
    'queue_v2_enabled', true
  )
),
updated_at = now()
where slug = 'northmarq-briggs';

-- Verify
select slug, config from workspaces where slug = 'northmarq-briggs';
