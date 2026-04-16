-- ============================================================================
-- 008: Watchers, Escalation, and Manager Oversight
-- Life Command Center — Phase 4: Shared Team Workflow Rollout
-- ============================================================================

-- ============================================================================
-- WATCHERS — subscribe to updates on action items or entities
-- Watchers receive visibility even on "assigned" items.
-- ============================================================================

create table if not exists watchers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  -- What they're watching (exactly one must be non-null)
  action_item_id uuid references action_items(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade,
  inbox_item_id uuid references inbox_items(id) on delete cascade,

  reason text,                          -- 'creator', 'escalation', 'manual', 'mentioned'
  created_at timestamptz not null default now(),

  -- Prevent duplicate watches
  unique (workspace_id, user_id, action_item_id),
  unique (workspace_id, user_id, entity_id),
  unique (workspace_id, user_id, inbox_item_id),

  -- At least one target must be set
  constraint watchers_target_check check (
    (action_item_id is not null)::int +
    (entity_id is not null)::int +
    (inbox_item_id is not null)::int = 1
  )
);

-- ============================================================================
-- ESCALATIONS — track when work was escalated and to whom
-- ============================================================================

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action_item_id uuid not null references action_items(id) on delete cascade,
  escalated_by uuid not null references users(id),
  escalated_to uuid not null references users(id),
  previous_assignee uuid references users(id),
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- MANAGER OVERSIGHT VIEW — team performance and queue health
-- ============================================================================

create or replace view v_manager_overview as
  select
    wm.workspace_id,
    u.id as user_id,
    u.display_name,
    u.email,
    wm.role,

    -- Action counts
    (select count(*) from action_items a
     where a.workspace_id = wm.workspace_id
       and (a.owner_id = u.id or a.assigned_to = u.id)
       and a.status in ('open', 'in_progress', 'waiting')) as active_actions,

    (select count(*) from action_items a
     where a.workspace_id = wm.workspace_id
       and (a.owner_id = u.id or a.assigned_to = u.id)
       and a.status in ('open', 'in_progress')
       and a.due_date < current_date) as overdue_actions,

    (select count(*) from action_items a
     where a.workspace_id = wm.workspace_id
       and (a.owner_id = u.id or a.assigned_to = u.id)
       and a.status = 'completed'
       and a.completed_at > now() - interval '7 days') as completed_this_week,

    -- Inbox counts
    (select count(*) from inbox_items i
     where i.workspace_id = wm.workspace_id
       and (i.source_user_id = u.id or i.assigned_to = u.id)
       and i.status = 'new') as untriaged_inbox,

    -- Research counts
    (select count(*) from research_tasks r
     where r.workspace_id = wm.workspace_id
       and r.assigned_to = u.id
       and r.status in ('queued', 'in_progress')) as active_research,

    -- Escalation counts
    (select count(*) from escalations e
     where e.workspace_id = wm.workspace_id
       and e.escalated_to = u.id
       and e.resolved_at is null) as open_escalations,

    -- Connector health
    (select count(*) from connector_accounts ca
     where ca.workspace_id = wm.workspace_id
       and ca.user_id = u.id
       and ca.status in ('error', 'degraded')) as unhealthy_connectors,

    -- Last activity
    (select max(ae.occurred_at) from activity_events ae
     where ae.workspace_id = wm.workspace_id
       and ae.actor_id = u.id) as last_activity_at

  from workspace_memberships wm
  join users u on u.id = wm.user_id
  where u.is_active = true;

-- ============================================================================
-- UNASSIGNED WORK VIEW — items with no assignee
-- ============================================================================

create or replace view v_unassigned_work as
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
    u.display_name as owner_name,
    a.domain,
    a.created_at
  from action_items a
  left join users u on u.id = a.owner_id
  where a.assigned_to is null
    and a.status in ('open', 'in_progress', 'waiting')

  union all

  select
    'inbox' as item_type,
    i.id,
    i.workspace_id,
    i.title,
    i.status::text,
    i.priority,
    i.source_type as sub_type,
    null as due_date,
    i.source_user_id as owner_id,
    u.display_name as owner_name,
    i.domain,
    i.created_at
  from inbox_items i
  left join users u on u.id = i.source_user_id
  where i.assigned_to is null
    and i.status in ('new', 'triaged')

  union all

  select
    'research' as item_type,
    r.id,
    r.workspace_id,
    r.title,
    r.status::text,
    case when r.priority < 20 then 'urgent'
         when r.priority < 40 then 'high'
         when r.priority < 60 then 'normal'
         else 'low' end as priority,
    r.research_type as sub_type,
    null as due_date,
    r.created_by as owner_id,
    u.display_name as owner_name,
    r.domain,
    r.created_at
  from research_tasks r
  left join users u on u.id = r.created_by
  where r.assigned_to is null
    and r.status in ('queued', 'in_progress');

-- ============================================================================
-- INDEXES
-- ============================================================================

create index idx_watchers_action on watchers(action_item_id) where action_item_id is not null;
create index idx_watchers_entity on watchers(entity_id) where entity_id is not null;
create index idx_watchers_inbox on watchers(inbox_item_id) where inbox_item_id is not null;
create index idx_watchers_user on watchers(user_id);

create index idx_escalations_action on escalations(action_item_id);
create index idx_escalations_to on escalations(escalated_to) where resolved_at is null;
create index idx_escalations_workspace on escalations(workspace_id);

-- ============================================================================
-- RLS
-- ============================================================================

alter table watchers enable row level security;
alter table escalations enable row level security;

-- Watchers: workspace members can view; self or managers can manage
create policy "Members can view watchers"
  on watchers for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Users can manage own watches"
  on watchers for all
  using (user_id = get_lcc_user_id() or has_workspace_role(workspace_id, 'manager'));

-- Escalations: workspace members can view; operators+ can create
create policy "Members can view escalations"
  on escalations for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can create escalations"
  on escalations for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Managers can update escalations"
  on escalations for update
  using (has_workspace_role(workspace_id, 'manager'));
