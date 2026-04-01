-- ============================================================================
-- 007: Unified Queue Views
-- Life Command Center — Phase 2: Canonical Data and Queue Model
--
-- These views power the core operational surfaces:
--   - My Work: actions + inbox assigned to the current user
--   - Team Queue: all open/active work across the workspace
--   - Inbox Triage: new/untriaged inbox items needing attention
--   - Sync Exceptions: failed syncs and unresolved errors
--   - Entity Timeline: activity history for a given entity
--   - Research Queue: prioritized research tasks by domain
-- ============================================================================

-- ============================================================================
-- MY WORK — everything assigned to or owned by a specific user
-- Usage: SELECT * FROM v_my_work WHERE user_id = $1 AND workspace_id = $2
-- ============================================================================

create or replace view v_my_work as
  -- Open action items I own or am assigned to
  select
    'action' as item_type,
    a.id,
    a.workspace_id,
    a.title,
    a.description as body,
    a.status::text as status,
    a.priority,
    a.action_type as sub_type,
    a.due_date,
    a.owner_id as user_id,
    a.assigned_to,
    a.entity_id,
    e.name as entity_name,
    a.domain,
    a.source_type,
    a.external_url,
    a.created_at,
    a.updated_at,
    a.due_date as sort_date
  from action_items a
  left join entities e on e.id = a.entity_id
  where a.status in ('open', 'in_progress', 'waiting')

  union all

  -- Inbox items assigned to me or sourced by me that need triage
  select
    'inbox' as item_type,
    i.id,
    i.workspace_id,
    i.title,
    i.body,
    i.status::text as status,
    i.priority,
    i.source_type as sub_type,
    null as due_date,
    i.source_user_id as user_id,
    i.assigned_to,
    i.entity_id,
    e.name as entity_name,
    i.domain,
    i.source_type,
    i.external_url,
    i.created_at,
    i.updated_at,
    i.received_at as sort_date
  from inbox_items i
  left join entities e on e.id = i.entity_id
  where i.status in ('new', 'triaged')

  union all

  -- Research tasks assigned to me
  select
    'research' as item_type,
    r.id,
    r.workspace_id,
    r.title,
    r.instructions as body,
    r.status::text as status,
    case when r.priority < 20 then 'urgent'
         when r.priority < 40 then 'high'
         when r.priority < 60 then 'normal'
         else 'low' end as priority,
    r.research_type as sub_type,
    null as due_date,
    r.assigned_to as user_id,
    r.assigned_to,
    r.entity_id,
    e.name as entity_name,
    r.domain,
    'research' as source_type,
    null as external_url,
    r.created_at,
    r.updated_at,
    r.created_at as sort_date
  from research_tasks r
  left join entities e on e.id = r.entity_id
  where r.status in ('queued', 'in_progress');

-- ============================================================================
-- TEAM QUEUE — all active work items across the workspace
-- Usage: SELECT * FROM v_team_queue WHERE workspace_id = $1
-- ============================================================================

create or replace view v_team_queue as
  select
    'action' as item_type,
    a.id,
    a.workspace_id,
    a.title,
    a.status::text,
    a.priority,
    a.action_type as sub_type,
    a.due_date,
    a.owner_id,
    a.assigned_to,
    a.visibility::text,
    a.entity_id,
    e.name as entity_name,
    a.domain,
    u_owner.display_name as owner_name,
    u_assign.display_name as assignee_name,
    a.created_at,
    a.updated_at
  from action_items a
  left join entities e on e.id = a.entity_id
  left join users u_owner on u_owner.id = a.owner_id
  left join users u_assign on u_assign.id = a.assigned_to
  where a.status in ('open', 'in_progress', 'waiting')
    and a.visibility in ('shared', 'assigned');

-- ============================================================================
-- INBOX TRIAGE — new/untriaged items needing attention
-- Usage: SELECT * FROM v_inbox_triage WHERE workspace_id = $1
-- ============================================================================

create or replace view v_inbox_triage as
  select
    i.id,
    i.workspace_id,
    i.title,
    i.body,
    i.status::text,
    i.priority,
    i.source_type,
    i.source_user_id,
    i.assigned_to,
    i.visibility::text,
    i.entity_id,
    e.name as entity_name,
    i.domain,
    i.external_url,
    i.metadata,
    u_source.display_name as source_user_name,
    u_assign.display_name as assignee_name,
    i.received_at,
    i.created_at
  from inbox_items i
  left join entities e on e.id = i.entity_id
  left join users u_source on u_source.id = i.source_user_id
  left join users u_assign on u_assign.id = i.assigned_to
  where i.status in ('new', 'triaged')
  order by
    case i.priority
      when 'urgent' then 1
      when 'high' then 2
      when 'normal' then 3
      when 'low' then 4
      else 5
    end,
    i.received_at desc;

-- ============================================================================
-- SYNC EXCEPTIONS — failed sync jobs and unresolved errors
-- Usage: SELECT * FROM v_sync_exceptions WHERE workspace_id = $1
-- ============================================================================

create or replace view v_sync_exceptions as
  select
    'sync_error' as exception_type,
    se.id,
    se.workspace_id,
    se.connector_account_id,
    ca.connector_type::text,
    ca.display_name as connector_name,
    ca.user_id as connector_user_id,
    u.display_name as connector_user_name,
    se.error_code,
    se.error_message,
    se.external_id,
    se.is_retryable,
    se.retry_count,
    sj.direction,
    sj.entity_type as sync_entity_type,
    sj.correlation_id,
    se.created_at
  from sync_errors se
  join sync_jobs sj on sj.id = se.sync_job_id
  join connector_accounts ca on ca.id = se.connector_account_id
  join users u on u.id = ca.user_id
  where se.resolved_at is null

  union all

  select
    'sync_job_failure' as exception_type,
    sj.id,
    sj.workspace_id,
    sj.connector_account_id,
    ca.connector_type::text,
    ca.display_name as connector_name,
    ca.user_id as connector_user_id,
    u.display_name as connector_user_name,
    null as error_code,
    sj.error_summary as error_message,
    null as external_id,
    true as is_retryable,
    0 as retry_count,
    sj.direction,
    sj.entity_type as sync_entity_type,
    sj.correlation_id,
    sj.created_at
  from sync_jobs sj
  join connector_accounts ca on ca.id = sj.connector_account_id
  join users u on u.id = ca.user_id
  where sj.status = 'failed'
    and sj.created_at > now() - interval '7 days';

-- ============================================================================
-- ENTITY TIMELINE — complete activity history for an entity
-- Usage: SELECT * FROM v_entity_timeline WHERE entity_id = $1
-- ============================================================================

create or replace view v_entity_timeline as
  select
    ae.id,
    ae.workspace_id,
    ae.entity_id,
    ae.category::text,
    ae.title,
    ae.body,
    ae.actor_id,
    u.display_name as actor_name,
    ae.action_item_id,
    ae.inbox_item_id,
    ae.source_type,
    ae.external_url,
    ae.domain,
    ae.visibility::text,
    ae.metadata,
    ae.occurred_at,
    ae.created_at
  from activity_events ae
  join users u on u.id = ae.actor_id
  where ae.entity_id is not null
  order by ae.occurred_at desc;

-- ============================================================================
-- RESEARCH QUEUE — prioritized research tasks by domain
-- Usage: SELECT * FROM v_research_queue WHERE workspace_id = $1
-- ============================================================================

create or replace view v_research_queue as
  select
    r.id,
    r.workspace_id,
    r.research_type,
    r.title,
    r.instructions,
    r.status::text,
    r.priority,
    r.domain,
    r.assigned_to,
    u_assign.display_name as assignee_name,
    r.created_by,
    u_creator.display_name as creator_name,
    r.entity_id,
    e.name as entity_name,
    r.source_record_id,
    r.source_table,
    r.outcome,
    r.completed_at,
    r.created_at,
    r.updated_at
  from research_tasks r
  left join entities e on e.id = r.entity_id
  left join users u_assign on u_assign.id = r.assigned_to
  left join users u_creator on u_creator.id = r.created_by
  where r.status in ('queued', 'in_progress')
  order by r.priority asc, r.created_at asc;

-- ============================================================================
-- WORK COUNTS — summary counts for dashboard badges
-- Usage: SELECT * FROM v_work_counts WHERE workspace_id = $1
-- ============================================================================

create or replace view v_work_counts as
  select
    w.id as workspace_id,
    (select count(*) from action_items
     where action_items.workspace_id = w.id
       and status in ('open', 'in_progress', 'waiting')) as open_actions,
    (select count(*) from inbox_items
     where inbox_items.workspace_id = w.id
       and status = 'new') as new_inbox,
    (select count(*) from inbox_items
     where inbox_items.workspace_id = w.id
       and status = 'triaged') as triaged_inbox,
    (select count(*) from research_tasks
     where research_tasks.workspace_id = w.id
       and status in ('queued', 'in_progress')) as active_research,
    (select count(*) from sync_errors
     where sync_errors.workspace_id = w.id
       and resolved_at is null) as unresolved_sync_errors,
    (select count(*) from action_items
     where action_items.workspace_id = w.id
       and status in ('open', 'in_progress')
       and due_date <= current_date) as overdue_actions
  from workspaces w;
