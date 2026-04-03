-- ============================================================================
-- 006: Row-Level Security Policies
-- Life Command Center — Phase 1: Access Enforcement
--
-- These policies enforce object-level access based on workspace membership,
-- user ownership, and visibility scopes.
--
-- Assumes Supabase Auth — auth.uid() returns the Supabase auth user ID.
-- The users table links Supabase auth IDs to LCC user IDs via email lookup.
-- For service_role calls (from API proxy), RLS is bypassed.
-- ============================================================================

-- Helper function: get LCC user ID from auth context
create or replace function get_lcc_user_id()
returns uuid as $$
  select id from users where email = (
    select email from auth.users where id = auth.uid()
  ) limit 1;
$$ language sql security definer stable;

-- Helper function: get workspace IDs user belongs to
create or replace function get_user_workspace_ids()
returns uuid[] as $$
  select array_agg(workspace_id)
  from workspace_memberships
  where user_id = get_lcc_user_id();
$$ language sql security definer stable;

-- Helper function: check if user has role >= threshold in workspace
create or replace function has_workspace_role(ws_id uuid, min_role text)
returns boolean as $$
  select exists(
    select 1 from workspace_memberships
    where user_id = get_lcc_user_id()
      and workspace_id = ws_id
      and case min_role
        when 'viewer'   then role in ('viewer', 'operator', 'manager', 'owner')
        when 'operator' then role in ('operator', 'manager', 'owner')
        when 'manager'  then role in ('manager', 'owner')
        when 'owner'    then role = 'owner'
        else false
      end
  );
$$ language sql security definer stable;

-- ============================================================================
-- WORKSPACES — members can see their workspaces
-- ============================================================================

create policy "Users can view their workspaces"
  on workspaces for select
  using (id = any(get_user_workspace_ids()));

create policy "Owners can update workspaces"
  on workspaces for update
  using (has_workspace_role(id, 'owner'));

-- ============================================================================
-- USERS — workspace members can see co-members
-- ============================================================================

create policy "Users can view co-members"
  on users for select
  using (
    id = get_lcc_user_id()
    or id in (
      select wm.user_id from workspace_memberships wm
      where wm.workspace_id = any(get_user_workspace_ids())
    )
  );

create policy "Users can update own profile"
  on users for update
  using (id = get_lcc_user_id());

-- ============================================================================
-- WORKSPACE MEMBERSHIPS — members can see memberships in their workspaces
-- ============================================================================

create policy "Members can view workspace memberships"
  on workspace_memberships for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Owners can manage memberships"
  on workspace_memberships for insert
  with check (has_workspace_role(workspace_id, 'owner'));

create policy "Owners can update memberships"
  on workspace_memberships for update
  using (has_workspace_role(workspace_id, 'owner'));

create policy "Owners can delete memberships"
  on workspace_memberships for delete
  using (has_workspace_role(workspace_id, 'owner'));

-- ============================================================================
-- USER PREFERENCES — own preferences only
-- ============================================================================

create policy "Users can view own preferences"
  on user_preferences for select
  using (user_id = get_lcc_user_id());

create policy "Users can manage own preferences"
  on user_preferences for all
  using (user_id = get_lcc_user_id());

-- ============================================================================
-- CONNECTOR ACCOUNTS — own connectors + managers see all in workspace
-- ============================================================================

create policy "Users can view own connectors"
  on connector_accounts for select
  using (
    user_id = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

create policy "Users can create own connectors"
  on connector_accounts for insert
  with check (
    user_id = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

create policy "Users can update own connectors"
  on connector_accounts for update
  using (
    user_id = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

create policy "Owners can delete connectors"
  on connector_accounts for delete
  using (
    user_id = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'owner')
  );

-- ============================================================================
-- SYNC JOBS — same as connector accounts visibility
-- ============================================================================

create policy "Users can view related sync jobs"
  on sync_jobs for select
  using (
    connector_account_id in (
      select id from connector_accounts
      where user_id = get_lcc_user_id()
    )
    or has_workspace_role(workspace_id, 'manager')
  );

create policy "System can create sync jobs"
  on sync_jobs for insert
  with check (workspace_id = any(get_user_workspace_ids()));

-- ============================================================================
-- SYNC ERRORS — same as sync jobs
-- ============================================================================

create policy "Users can view related sync errors"
  on sync_errors for select
  using (
    connector_account_id in (
      select id from connector_accounts
      where user_id = get_lcc_user_id()
    )
    or has_workspace_role(workspace_id, 'manager')
  );

-- ============================================================================
-- ENTITIES — all workspace members can view; operators+ can write
-- ============================================================================

create policy "Members can view workspace entities"
  on entities for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can create entities"
  on entities for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Operators can update entities"
  on entities for update
  using (has_workspace_role(workspace_id, 'operator'));

-- ============================================================================
-- EXTERNAL IDENTITIES — same as entities
-- ============================================================================

create policy "Members can view external identities"
  on external_identities for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can manage external identities"
  on external_identities for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Operators can update external identities"
  on external_identities for update
  using (has_workspace_role(workspace_id, 'operator'));

-- ============================================================================
-- ENTITY ALIASES — same as entities
-- ============================================================================

create policy "Members can view entity aliases"
  on entity_aliases for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can manage entity aliases"
  on entity_aliases for all
  using (has_workspace_role(workspace_id, 'operator'));

-- ============================================================================
-- ENTITY RELATIONSHIPS — same as entities
-- ============================================================================

create policy "Members can view entity relationships"
  on entity_relationships for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can manage entity relationships"
  on entity_relationships for all
  using (has_workspace_role(workspace_id, 'operator'));

-- ============================================================================
-- INBOX ITEMS — visibility-scoped access
-- ============================================================================

create policy "Users can view inbox items by visibility"
  on inbox_items for select
  using (
    workspace_id = any(get_user_workspace_ids())
    and (
      visibility = 'shared'
      or source_user_id = get_lcc_user_id()
      or assigned_to = get_lcc_user_id()
      or has_workspace_role(workspace_id, 'manager')
    )
  );

create policy "Users can create inbox items"
  on inbox_items for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Users can update own or assigned inbox items"
  on inbox_items for update
  using (
    source_user_id = get_lcc_user_id()
    or assigned_to = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

-- ============================================================================
-- ACTION ITEMS — visibility-scoped access
-- ============================================================================

create policy "Users can view action items by visibility"
  on action_items for select
  using (
    workspace_id = any(get_user_workspace_ids())
    and (
      visibility = 'shared'
      or owner_id = get_lcc_user_id()
      or assigned_to = get_lcc_user_id()
      or created_by = get_lcc_user_id()
      or has_workspace_role(workspace_id, 'manager')
    )
  );

create policy "Operators can create action items"
  on action_items for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Owners and assignees can update action items"
  on action_items for update
  using (
    owner_id = get_lcc_user_id()
    or assigned_to = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

-- ============================================================================
-- ACTIVITY EVENTS — visibility-scoped, append-only for non-managers
-- ============================================================================

create policy "Users can view activity events by visibility"
  on activity_events for select
  using (
    workspace_id = any(get_user_workspace_ids())
    and (
      visibility = 'shared'
      or actor_id = get_lcc_user_id()
      or has_workspace_role(workspace_id, 'manager')
    )
  );

create policy "Operators can create activity events"
  on activity_events for insert
  with check (has_workspace_role(workspace_id, 'operator'));

-- ============================================================================
-- RESEARCH TASKS — workspace-visible, assignee can update
-- ============================================================================

create policy "Members can view research tasks"
  on research_tasks for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Operators can create research tasks"
  on research_tasks for insert
  with check (has_workspace_role(workspace_id, 'operator'));

create policy "Assignees and managers can update research tasks"
  on research_tasks for update
  using (
    assigned_to = get_lcc_user_id()
    or created_by = get_lcc_user_id()
    or has_workspace_role(workspace_id, 'manager')
  );

-- ============================================================================
-- DOMAINS — workspace members can view; managers+ can manage
-- ============================================================================

create policy "Members can view domains"
  on domains for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Managers can manage domains"
  on domains for all
  using (has_workspace_role(workspace_id, 'manager'));

-- ============================================================================
-- DOMAIN DATA SOURCES — same as domains
-- ============================================================================

create policy "Members can view domain data sources"
  on domain_data_sources for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Managers can manage domain data sources"
  on domain_data_sources for all
  using (has_workspace_role(workspace_id, 'manager'));

-- ============================================================================
-- DOMAIN ENTITY MAPPINGS — same as domains
-- ============================================================================

create policy "Members can view domain entity mappings"
  on domain_entity_mappings for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Managers can manage domain entity mappings"
  on domain_entity_mappings for all
  using (has_workspace_role(workspace_id, 'manager'));

-- ============================================================================
-- DOMAIN QUEUE CONFIGS — same as domains
-- ============================================================================

create policy "Members can view domain queue configs"
  on domain_queue_configs for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "Managers can manage domain queue configs"
  on domain_queue_configs for all
  using (has_workspace_role(workspace_id, 'manager'));
