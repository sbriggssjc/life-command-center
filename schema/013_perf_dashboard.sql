-- ============================================================================
-- 013: Performance Dashboard Views
-- Life Command Center — RG6: Workload Validation
--
-- Operational views for identifying slow endpoints, stale materialized views,
-- and high-cardinality query patterns. Queries against perf_metrics table.
-- ============================================================================

-- ============================================================================
-- VIEW: Endpoint latency summary (last 24h, grouped by endpoint)
-- ============================================================================

create or replace view v_perf_endpoint_summary as
  select
    endpoint,
    metric_type,
    count(*) as request_count,
    round(avg(duration_ms)) as avg_ms,
    percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
    percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
    percentile_cont(0.99) within group (order by duration_ms) as p99_ms,
    max(duration_ms) as max_ms,
    min(duration_ms) as min_ms,
    round(stddev(duration_ms)) as stddev_ms,
    count(*) filter (where duration_ms > 500) as slow_count,
    round(100.0 * count(*) filter (where duration_ms > 500) / greatest(count(*), 1), 1) as slow_pct
  from perf_metrics
  where recorded_at > now() - interval '24 hours'
  group by endpoint, metric_type
  order by avg_ms desc;

-- ============================================================================
-- VIEW: Slow requests log (requests exceeding target thresholds)
-- Target thresholds:
--   api_latency: 500ms
--   page_load: 1000ms
--   sync_duration: 30000ms
-- ============================================================================

create or replace view v_perf_slow_requests as
  select
    id,
    workspace_id,
    user_id,
    metric_type,
    endpoint,
    duration_ms,
    metadata,
    recorded_at,
    case
      when metric_type = 'api_latency' then 500
      when metric_type = 'page_load' then 1000
      when metric_type = 'sync_duration' then 30000
      when metric_type = 'query_time' then 200
      else 1000
    end as threshold_ms
  from perf_metrics
  where recorded_at > now() - interval '24 hours'
    and (
      (metric_type = 'api_latency' and duration_ms > 500)
      or (metric_type = 'page_load' and duration_ms > 1000)
      or (metric_type = 'sync_duration' and duration_ms > 30000)
      or (metric_type = 'query_time' and duration_ms > 200)
    )
  order by recorded_at desc
  limit 200;

-- ============================================================================
-- VIEW: Materialized view freshness check
-- Reports staleness of work count materialized views
-- ============================================================================

create or replace view v_mv_freshness as
  select
    workspace_id,
    refreshed_at,
    extract(epoch from (now() - refreshed_at)) / 60 as minutes_stale,
    case
      when refreshed_at > now() - interval '5 minutes' then 'fresh'
      when refreshed_at > now() - interval '30 minutes' then 'acceptable'
      when refreshed_at > now() - interval '2 hours' then 'stale'
      else 'critical'
    end as freshness_status
  from mv_work_counts;

-- ============================================================================
-- VIEW: Hourly throughput — requests per hour over last 24h
-- ============================================================================

create or replace view v_perf_hourly_throughput as
  select
    date_trunc('hour', recorded_at) as hour,
    metric_type,
    count(*) as request_count,
    round(avg(duration_ms)) as avg_ms,
    max(duration_ms) as max_ms,
    count(*) filter (where duration_ms > 500) as slow_count
  from perf_metrics
  where recorded_at > now() - interval '24 hours'
  group by date_trunc('hour', recorded_at), metric_type
  order by hour desc;

-- ============================================================================
-- VIEW: Per-workspace performance summary
-- Identifies workspaces with performance issues
-- ============================================================================

create or replace view v_perf_workspace_summary as
  select
    workspace_id,
    count(*) as total_requests,
    round(avg(duration_ms)) as avg_ms,
    percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
    count(*) filter (where duration_ms > 500) as slow_requests,
    count(distinct user_id) as active_users,
    max(recorded_at) as last_activity
  from perf_metrics
  where recorded_at > now() - interval '24 hours'
    and workspace_id is not null
  group by workspace_id
  order by avg_ms desc;

-- ============================================================================
-- TABLE: Performance targets (reference thresholds for dashboards)
-- ============================================================================

create table if not exists perf_targets (
  endpoint_pattern text primary key,
  target_p50_ms integer not null,
  target_p95_ms integer not null,
  target_p99_ms integer not null,
  description text
);

-- Seed default performance targets
insert into perf_targets (endpoint_pattern, target_p50_ms, target_p95_ms, target_p99_ms, description) values
  ('/api/queue-v2?view=my_work',       150, 400, 800, 'My Work queue load'),
  ('/api/queue-v2?view=team_queue',    200, 500, 1000, 'Team Queue load'),
  ('/api/queue-v2?view=inbox',         150, 400, 800, 'Inbox triage load'),
  ('/api/queue-v2?view=work_counts',   50, 150, 300, 'Work counts (materialized)'),
  ('/api/queue-v2?view=entity_timeline', 200, 500, 1000, 'Entity timeline load'),
  ('/api/queue-v2?view=research',      150, 400, 800, 'Research queue load'),
  ('/api/sync?action=health',          100, 300, 600, 'Sync health summary'),
  ('/api/entities?action=list',        200, 500, 1000, 'Entity list'),
  ('render:my_work',                   300, 800, 1500, 'Client-side My Work render'),
  ('render:team_queue',                300, 800, 1500, 'Client-side Team Queue render'),
  ('render:inbox_triage',              300, 800, 1500, 'Client-side Inbox render'),
  ('render:entities',                  300, 800, 1500, 'Client-side Entities render'),
  ('render:metrics',                   400, 1000, 2000, 'Client-side Metrics render'),
  ('render:sync_health',               300, 800, 1500, 'Client-side Sync Health render')
on conflict (endpoint_pattern) do nothing;

-- ============================================================================
-- VIEW: Target compliance — compares actual p50/p95 against targets
-- ============================================================================

create or replace view v_perf_target_compliance as
  select
    t.endpoint_pattern,
    t.description,
    t.target_p50_ms,
    t.target_p95_ms,
    t.target_p99_ms,
    coalesce(p.request_count, 0) as request_count,
    p.p50_ms as actual_p50_ms,
    p.p95_ms as actual_p95_ms,
    p.p99_ms as actual_p99_ms,
    case
      when p.p95_ms is null then 'no_data'
      when p.p95_ms <= t.target_p95_ms then 'passing'
      when p.p95_ms <= t.target_p99_ms then 'warning'
      else 'failing'
    end as compliance_status
  from perf_targets t
  left join v_perf_endpoint_summary p on p.endpoint = t.endpoint_pattern
  order by
    case
      when p.p95_ms is null then 3
      when p.p95_ms > t.target_p99_ms then 0
      when p.p95_ms > t.target_p95_ms then 1
      else 2
    end,
    p.p95_ms desc nulls last;
