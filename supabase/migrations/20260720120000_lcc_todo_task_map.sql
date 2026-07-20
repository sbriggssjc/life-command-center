-- ============================================================================
-- Closing the Loop (Flow 1, Option A) — To Do task ↔ email mapping store
-- LCC Opps (xengecqvemvfknjvbvrq)
--
-- The Flag → To Do PA flow creates a Microsoft To Do task when Scott flags an
-- email. The "Processing Complete → Move Message" flow files that same email.
-- To auto-complete the task on file, LCC needs to know which task belongs to
-- which message. Outlook categories / extended properties are noisy + weakly
-- supported, and LCC already round-trips every processed email through the
-- webhook keyed on internet_message_id — so LCC is the correlation hub.
--
-- The Flag → To Do flow POSTs {internet_message_id, todo_task_id, todo_list_id}
-- to /api/webhooks/todo-task-created after creating the task; this table stores
-- that mapping. The move-relay looks it up by internet_message_id and forwards
-- the task ids (with a category-gated complete_todo flag) to the Move flow.
--
-- Additive + isolated (drop the table → zero trace). Inert until the PA flows
-- + prompt 2 wire the caller — with no writer, the table simply stays empty.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.todo_task_map (
  id                   bigserial PRIMARY KEY,
  internet_message_id  text        NOT NULL,
  todo_task_id         text        NOT NULL,
  todo_list_id         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);

-- One To Do task per message (the Flag → To Do flow creates exactly one task
-- per flagged email). The receiver upserts ON CONFLICT on this key, so a
-- re-flag / re-POST relinks the mapping instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_todo_task_map_message
  ON public.todo_task_map (internet_message_id);

COMMENT ON TABLE public.todo_task_map IS
  'Closing-the-Loop Flow 1: internet_message_id → {todo_task_id, todo_list_id}. '
  'Written by /api/webhooks/todo-task-created, read by the processing-complete '
  'move-relay to auto-complete the To Do task on file (category-gated).';
