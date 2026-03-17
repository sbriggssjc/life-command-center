-- ============================================================================
-- 014: Bootstrap — Initial workspace, user, and membership
-- Life Command Center — Run once after migrations 001-013
--
-- Idempotent: Uses ON CONFLICT to skip if already seeded.
--
-- IMPORTANT: Update the email and display_name below to match your
-- Supabase Auth account (the email you log in with).
-- ============================================================================

-- 1. Create the primary workspace
insert into workspaces (id, name, slug)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Briggsland Capital',
  'briggsland'
)
on conflict (slug) do nothing;

-- 2. Create the owner user
--    ⚠️  Change the email/display_name to match YOUR Supabase Auth login
insert into users (id, email, display_name)
values (
  'b0000000-0000-0000-0000-000000000001',
  'sbriggssjc@gmail.com',
  'Scott Briggs'
)
on conflict (email) do update set
  display_name = excluded.display_name,
  updated_at = now();

-- 3. Bind user → workspace as owner
insert into workspace_memberships (workspace_id, user_id, role)
values (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'owner'
)
on conflict (workspace_id, user_id) do update set
  role = excluded.role;

-- 4. Set default preferences
insert into user_preferences (user_id, workspace_id, preferences)
values (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  '{
    "default_domain": "government",
    "inbox_sort": "received_at.desc",
    "queue_view": "my_work",
    "notifications": true
  }'::jsonb
)
on conflict (user_id, workspace_id) do nothing;

-- 5. Verify
select 'Bootstrap complete' as status,
  w.name as workspace,
  u.email as user_email,
  wm.role as role
from workspace_memberships wm
join workspaces w on w.id = wm.workspace_id
join users u on u.id = wm.user_id
where w.slug = 'briggsland';
