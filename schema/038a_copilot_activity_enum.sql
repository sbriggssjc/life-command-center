-- ============================================================================
-- 038a: Add Copilot enum values to activity_category
-- Life Command Center — Entity-scoped memory layer (part 1 of 2)
--
-- MUST BE RUN BEFORE 038b. Postgres does not permit using newly-added enum
-- values in the same transaction in which they were added (error 55P04
-- "unsafe use of new value"). The values become usable only after this
-- migration commits.
--
-- After this migration commits, run:
--   schema/038b_copilot_activity_indexes.sql
-- to create the indexes that reference the new values.
-- ============================================================================

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
