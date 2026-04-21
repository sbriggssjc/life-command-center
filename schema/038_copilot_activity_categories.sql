-- ============================================================================
-- 038: Copilot activity_event categories + retrieval index
-- Life Command Center — Entity-scoped memory layer
--
-- Extends the existing activity_category enum with two Copilot-specific
-- values so logCopilotInteraction() can write durable timeline rows
-- without polluting the 'note' category.
--
-- These enum ADDs are non-transactional in Postgres <13; wrap in DO blocks
-- so re-runs are idempotent.
-- ============================================================================

-- ---- Add enum values ------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'activity_category'
       and e.enumlabel = 'copilot_action'
  ) then
    alter type activity_category add value 'copilot_action';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'activity_category'
       and e.enumlabel = 'copilot_turn'
  ) then
    alter type activity_category add value 'copilot_turn';
  end if;
end $$;

-- ---- Retrieval index ------------------------------------------------------
-- Optimizes the common memory-retrieval query: "show the last N copilot-
-- related events for this entity, newest first."
create index if not exists idx_activities_copilot_entity
  on activity_events(workspace_id, entity_id, occurred_at desc)
  where category in ('copilot_action', 'copilot_turn');

-- ---- Composite index for entity-timeline retrieval ------------------------
-- Used by context-broker + retrieve-entity-context to pull the full mixed
-- timeline (emails, calls, notes, copilot actions) for a contact or property.
create index if not exists idx_activities_entity_time
  on activity_events(workspace_id, entity_id, occurred_at desc)
  where entity_id is not null;
