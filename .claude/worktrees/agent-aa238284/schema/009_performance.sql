-- ============================================================================
-- 009: Performance Optimization
-- Life Command Center — Phase 6
--
-- Materialized views for pre-computed aggregations
-- Performance indexes on key query patterns
-- ============================================================================

-- Enable pg_trgm extension (needed for entity name trigram search index below)
create extension if not exists pg_trgm;

-- ============================================================================
-- MATERIALIZED VIEW: Work counts per workspace (replaces expensive v_work_counts)
-- Refreshed by cron or after sync operations
-- ============================================================================

create materialized view if not exists mv_work_counts as
  select
    w.id as workspace_id,

    -- Action counts
    coalesce(sum(case when a.status in ('open','in_progress','waiting') then 1 else 0 end), 0) as open_actions,
    coalesce(sum(case when a.status = 'in_progress' then 1 else 0 end), 0) as in_progress_actions,
    coalesce(sum(case when a.status = 'completed' and a.completed_at > now() - interval '7 days' then 1 else 0 end), 0) as completed_week,
    coalesce(sum(case when a.status in ('open','in_progress') and a.due_date < current_date then 1 else 0 end), 0) as overdue_actions,
    coalesce(sum(case when a.status in ('open','in_progress','waiting') and a.due_date between current_date and current_date + interval '7 days' then 1 else 0 end), 0) as due_this_week,

    -- Inbox counts
    (select count(*) from inbox_items i where i.workspace_id = w.id and i.status = 'new') as inbox_new,
    (select count(*) from inbox_items i where i.workspace_id = w.id and i.status = 'triaged') as inbox_triaged,

    -- Research counts
    (select count(*) from research_tasks r where r.workspace_id = w.id and r.status in ('queued','in_progress')) as research_active,

    -- Sync error counts
    (select count(*) from sync_errors se
      join connector_accounts ca on ca.id = se.connector_account_id
      where ca.workspace_id = w.id and se.resolved_at is null) as sync_errors,

    -- Entity counts
    (select count(*) from entities e where e.workspace_id = w.id) as total_entities,

    -- Escalation counts
    (select count(*) from escalations es where es.workspace_id = w.id and es.resolved_at is null) as open_escalations,

    now() as refreshed_at

  from workspaces w
  left join action_items a on a.workspace_id = w.id
  group by w.id;

create unique index on mv_work_counts(workspace_id);

-- ============================================================================
-- MATERIALIZED VIEW: Per-user work counts
-- ============================================================================

create materialized view if not exists mv_user_work_counts as
  select
    wm.workspace_id,
    wm.user_id,

    -- My actions (owner or assigned)
    coalesce(sum(case when (a.owner_id = wm.user_id or a.assigned_to = wm.user_id)
      and a.status in ('open','in_progress','waiting') then 1 else 0 end), 0) as my_actions,

    coalesce(sum(case when (a.owner_id = wm.user_id or a.assigned_to = wm.user_id)
      and a.status in ('open','in_progress') and a.due_date < current_date then 1 else 0 end), 0) as my_overdue,

    coalesce(sum(case when (a.owner_id = wm.user_id or a.assigned_to = wm.user_id)
      and a.status = 'completed' and a.completed_at > now() - interval '7 days' then 1 else 0 end), 0) as my_completed_week,

    -- My inbox
    (select count(*) from inbox_items i
      where i.workspace_id = wm.workspace_id
        and (i.source_user_id = wm.user_id or i.assigned_to = wm.user_id)
        and i.status in ('new','triaged')) as my_inbox,

    -- My research
    (select count(*) from research_tasks r
      where r.workspace_id = wm.workspace_id
        and r.assigned_to = wm.user_id
        and r.status in ('queued','in_progress')) as my_research,

    now() as refreshed_at

  from workspace_memberships wm
  left join action_items a on a.workspace_id = wm.workspace_id
  group by wm.workspace_id, wm.user_id;

create unique index on mv_user_work_counts(workspace_id, user_id);

-- ============================================================================
-- FUNCTION: Refresh materialized views
-- Called by pg_cron or from sync completion handler
-- ============================================================================

create or replace function refresh_work_counts()
returns void language plpgsql as $$
begin
  refresh materialized view concurrently mv_work_counts;
  refresh materialized view concurrently mv_user_work_counts;
end;
$$;

-- ============================================================================
-- PERFORMANCE INDEXES — based on known query patterns
-- ============================================================================

-- Action items: primary query patterns
create index if not exists idx_actions_workspace_status
  on action_items(workspace_id, status)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists idx_actions_assigned
  on action_items(assigned_to, status)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists idx_actions_owner
  on action_items(owner_id, status)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists idx_actions_due_date
  on action_items(workspace_id, due_date)
  where status in ('open', 'in_progress') and due_date is not null;

create index if not exists idx_actions_entity
  on action_items(entity_id)
  where entity_id is not null;

create index if not exists idx_actions_domain
  on action_items(workspace_id, domain)
  where status in ('open', 'in_progress', 'waiting');

create index if not exists idx_actions_completed_at
  on action_items(workspace_id, completed_at desc)
  where status = 'completed';

-- Inbox items: triage queue patterns
create index if not exists idx_inbox_workspace_status
  on inbox_items(workspace_id, status)
  where status in ('new', 'triaged');

create index if not exists idx_inbox_assigned
  on inbox_items(assigned_to, status)
  where status in ('new', 'triaged');

create index if not exists idx_inbox_source_type
  on inbox_items(workspace_id, source_type, status);

create index if not exists idx_inbox_received_at
  on inbox_items(workspace_id, received_at desc)
  where status in ('new', 'triaged');

-- Entities: search and lookup
create index if not exists idx_entities_workspace_type
  on entities(workspace_id, entity_type);

create index if not exists idx_entities_name_trgm
  on entities using gin (name gin_trgm_ops);

create index if not exists idx_entities_domain
  on entities(workspace_id, domain);

-- Research tasks
create index if not exists idx_research_workspace_status
  on research_tasks(workspace_id, status)
  where status in ('queued', 'in_progress');

create index if not exists idx_research_assigned
  on research_tasks(assigned_to, status)
  where status in ('queued', 'in_progress');

-- Activity events: timeline patterns
create index if not exists idx_activity_entity_time
  on activity_events(entity_id, occurred_at desc)
  where entity_id is not null;

create index if not exists idx_activity_workspace_time
  on activity_events(workspace_id, occurred_at desc);

create index if not exists idx_activity_actor_time
  on activity_events(actor_id, occurred_at desc);

-- External identities: lookup by source
create index if not exists idx_extid_lookup
  on external_identities(source_system, external_id);

-- Sync jobs: health monitoring
create index if not exists idx_sync_jobs_connector_time
  on sync_jobs(connector_account_id, started_at desc);

create index if not exists idx_sync_jobs_status
  on sync_jobs(status)
  where status in ('running', 'failed');

-- Sync errors: unresolved
create index if not exists idx_sync_errors_unresolved
  on sync_errors(connector_account_id)
  where resolved_at is null;

-- Connector accounts: workspace lookup
create index if not exists idx_connectors_workspace_type
  on connector_accounts(workspace_id, connector_type);

-- Workspace memberships: user lookup
create index if not exists idx_wm_user
  on workspace_memberships(user_id);

-- ============================================================================
-- PERF LOGGING TABLE — client/server timing metrics
-- ============================================================================

create table if not exists perf_metrics (
  id bigint generated always as identity primary key,
  workspace_id uuid references workspaces(id),
  user_id uuid references users(id),
  metric_type text not null,        -- 'api_latency', 'page_load', 'query_time', 'sync_duration'
  endpoint text,                    -- API path or page name
  duration_ms integer not null,     -- elapsed milliseconds
  metadata jsonb,                   -- { status_code, item_count, view, user_agent, ... }
  recorded_at timestamptz not null default now()
);

-- Partition-friendly index (query by time range)
create index idx_perf_time on perf_metrics(recorded_at desc);
create index idx_perf_type on perf_metrics(metric_type, recorded_at desc);

-- Auto-expire old perf data (keep 30 days)
-- This would be set up via pg_cron: DELETE FROM perf_metrics WHERE recorded_at < now() - interval '30 days'
