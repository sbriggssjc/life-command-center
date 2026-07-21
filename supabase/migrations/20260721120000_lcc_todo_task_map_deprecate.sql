-- ============================================================================
-- Deprecate public.todo_task_map — native "Flagged email" To Do model
-- LCC Opps (xengecqvemvfknjvbvrq)
--
-- The custom Flag → To Do task (and its LCC mapping store) is RETIRED. Outlook
-- auto-creates one task in the system "Flagged email" To Do list for every
-- flagged message, and Scott completes tasks THERE — so LCC no longer creates a
-- custom task, no longer receives its ids, and no longer joins to a mapping. The
-- writer (/api/webhooks/todo-task-created + handleTodoTaskCreated) and both
-- readers (the completion-poll worklist join + the move-relay resolveTodoCompletion)
-- were removed; the completion poll now returns the staged emails and PA matches
-- them to the native list itself (linkedResources → internetMessageId; subject +
-- staging-time fallback). See docs/architecture/flows/todo-completion-poll.md.
--
-- This migration is a METADATA-ONLY marker: it re-COMMENTs the table as
-- deprecated. The table is INTENTIONALLY KEPT (any historical rows are harmless
-- and preserved — no hard delete). It has no live writer or reader; it can be
-- dropped in a later cleanup once confirmed empty of value:
--   DROP TABLE IF EXISTS public.todo_task_map;   -- (reversible via 20260720120000)
-- Idempotent + reversible (restore the prior COMMENT from 20260720120000).
-- ============================================================================

COMMENT ON TABLE public.todo_task_map IS
  'DEPRECATED 2026-07-21 — the custom Flag → To Do task + mapping is retired in '
  'favor of the native "Flagged email" To Do list. No live writer/reader remains '
  '(/api/webhooks/todo-task-created + resolveTodoCompletion + the poll join were '
  'removed). Historical rows are kept but unused; safe to DROP in a later cleanup.';
