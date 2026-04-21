-- ============================================================================
-- 038b: Copilot activity retrieval indexes
-- Life Command Center — Entity-scoped memory layer (part 2 of 2)
--
-- Must be run AFTER 038a_copilot_activity_enum.sql has been committed.
-- Postgres error 55P04 fires if the enum ADD VALUE and any statement that
-- references the new value are in the same transaction.
-- ============================================================================

-- Copilot-scoped retrieval index: "show the last N copilot-related events
-- for this entity." The partial predicate uses the enum values added in 038a.
create index if not exists idx_activities_copilot_entity
  on activity_events(workspace_id, entity_id, occurred_at desc)
  where category in ('copilot_action', 'copilot_turn');

-- Entity-timeline retrieval index: used by context-broker + retrieve-entity
-- for full mixed-category timeline lookups.
create index if not exists idx_activities_entity_time
  on activity_events(workspace_id, entity_id, occurred_at desc)
  where entity_id is not null;
