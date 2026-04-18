-- ============================================================================
-- 029: Add internet_message_id as a first-class column on inbox_items
--
-- Previously internet_message_id was only stored inside the metadata JSONB.
-- Promoting it to a top-level column enables:
-- 1. A proper partial unique constraint for bulletproof dedup
-- 2. Efficient index lookups without JSONB extraction
-- 3. Clearer schema documentation of the dedup key
--
-- The external_id column remains the primary dedup key used by sync.js
-- (its value IS the internet_message_id when available). This column is
-- an additional safety net and query optimization.
-- ============================================================================

-- Add the column (nullable — only email-sourced items will have it)
alter table inbox_items
  add column if not exists internet_message_id text;

-- Backfill from metadata for existing rows
update inbox_items
  set internet_message_id = metadata->>'internet_message_id'
  where internet_message_id is null
    and metadata->>'internet_message_id' is not null;

-- Partial unique constraint: one inbox_item per internet_message_id per workspace
-- This is the authoritative dedup constraint for emails.
create unique index if not exists idx_inbox_items_internet_msg_id
  on inbox_items(workspace_id, internet_message_id)
  where internet_message_id is not null;

-- Update the inbox triage view to expose the new column
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
    i.internet_message_id,
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
