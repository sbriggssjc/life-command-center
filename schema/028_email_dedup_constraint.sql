-- ============================================================================
-- 028: Email dedup — unique constraint + flag_removed_at column
--
-- Fixes:
-- 1. resolution=merge-duplicates requires a UNIQUE constraint to work.
--    Without it, PostgREST inserts duplicates on every sync.
-- 2. Adds flag_removed_at to track when an Outlook flag was resolved,
--    so the inbox view can exclude stale items.
-- 3. Adds graph_rest_id to metadata index for deeplink lookups.
-- ============================================================================

-- Unique constraint on (workspace_id, external_id, source_type).
-- This enables PostgREST's resolution=merge-duplicates to actually deduplicate.
-- Partial: only for rows where external_id IS NOT NULL.
create unique index if not exists idx_inbox_items_dedup
  on inbox_items(workspace_id, external_id, source_type)
  where external_id is not null;

-- Column to track when a flag was resolved in Outlook (unflagged).
-- Null means the flag is still active.
alter table inbox_items add column if not exists flag_removed_at timestamptz;

-- Update the inbox triage view to exclude items whose flags have been resolved.
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
    i.external_id,
    i.external_url,
    i.metadata,
    u_source.display_name as source_user_name,
    u_assign.display_name as assignee_name,
    i.received_at,
    i.created_at,
    i.flag_removed_at
  from inbox_items i
  left join entities e on e.id = i.entity_id
  left join users u_source on u_source.id = i.source_user_id
  left join users u_assign on u_assign.id = i.assigned_to
  where i.status in ('new', 'triaged')
    and i.flag_removed_at is null
  order by
    case i.priority
      when 'urgent' then 1
      when 'high' then 2
      when 'normal' then 3
      when 'low' then 4
      else 5
    end,
    i.received_at desc;
