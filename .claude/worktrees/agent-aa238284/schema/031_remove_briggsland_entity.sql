-- ============================================================================
-- 031: Remove "Briggsland Capital" Test Entity
-- Life Command Center — Data Cleanup
--
-- Context: "Briggsland Capital" is test/placeholder data in the entities table.
-- This migration safely removes it and unlinks any referencing records.
--
-- FK cascade handles: external_identities, entity_aliases,
--   entity_relationships, watchers (all ON DELETE CASCADE).
-- Must NULL out: inbox_items, action_items, activity_events,
--   research_tasks (nullable FK, no cascade).
-- ============================================================================

begin;

-- Step 1: Unlink non-cascading references (set entity_id to NULL)
update inbox_items
  set entity_id = null, updated_at = now()
  where entity_id in (select id from entities where name ilike '%briggsland%');

update action_items
  set entity_id = null, updated_at = now()
  where entity_id in (select id from entities where name ilike '%briggsland%');

update activity_events
  set entity_id = null
  where entity_id in (select id from entities where name ilike '%briggsland%');

update research_tasks
  set entity_id = null, updated_at = now()
  where entity_id in (select id from entities where name ilike '%briggsland%');

-- Step 2: Delete the entity (cascades to external_identities, entity_aliases,
--   entity_relationships, watchers)
delete from entities where name ilike '%briggsland%';

commit;
