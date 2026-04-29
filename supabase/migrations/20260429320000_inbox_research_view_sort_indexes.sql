-- ============================================================================
-- 20260429320000: Drop ORDER BY from queue views, add covering composite indexes
-- Life Command Center — Performance follow-up
--
-- Three views (v_inbox_triage, v_research_queue, v_entity_timeline) baked
-- ORDER BY into the view definition. The API layer also passes an explicit
-- order param to PostgREST, so the view-level sort was redundant — and
-- worse, it forced the planner to materialize-and-sort rather than
-- streaming from a covering index.
--
-- This migration:
--   1. Adds three partial composite indexes that cover the WHERE+ORDER
--      patterns the API hits on every inbox/research/timeline read.
--   2. Recreates the three views without ORDER BY so the planner can
--      pick whatever path is cheapest given the API's order param.
--
-- Expected impact: paginated inbox/research/entity_timeline p95
-- improves; existing slow alerts (e.g. v_inbox_triage at 876ms) should
-- become rare.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Composite indexes covering WHERE + ORDER for the hot paths
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_inbox_ws_status_received
  ON inbox_items (workspace_id, status, received_at DESC)
  WHERE status IN ('new', 'triaged');

CREATE INDEX IF NOT EXISTS idx_research_ws_status_priority_created
  ON research_tasks (workspace_id, status, priority, created_at)
  WHERE status IN ('queued', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_activities_entity_occurred
  ON activity_events (entity_id, occurred_at DESC)
  WHERE entity_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Recreate views without ORDER BY
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_inbox_triage AS
  SELECT
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
    e.name AS entity_name,
    i.domain,
    i.external_url,
    i.metadata,
    u_source.display_name AS source_user_name,
    u_assign.display_name AS assignee_name,
    i.received_at,
    i.created_at
  FROM inbox_items i
  LEFT JOIN entities e ON e.id = i.entity_id
  LEFT JOIN users u_source ON u_source.id = i.source_user_id
  LEFT JOIN users u_assign ON u_assign.id = i.assigned_to
  WHERE i.status IN ('new', 'triaged');

CREATE OR REPLACE VIEW v_research_queue AS
  SELECT
    r.id,
    r.workspace_id,
    r.research_type,
    r.title,
    r.instructions,
    r.status::text,
    r.priority,
    r.domain,
    r.assigned_to,
    u_assign.display_name AS assignee_name,
    r.created_by,
    u_creator.display_name AS creator_name,
    r.entity_id,
    e.name AS entity_name,
    r.source_record_id,
    r.source_table,
    r.outcome,
    r.completed_at,
    r.created_at,
    r.updated_at
  FROM research_tasks r
  LEFT JOIN entities e ON e.id = r.entity_id
  LEFT JOIN users u_assign ON u_assign.id = r.assigned_to
  LEFT JOIN users u_creator ON u_creator.id = r.created_by
  WHERE r.status IN ('queued', 'in_progress');

CREATE OR REPLACE VIEW v_entity_timeline AS
  SELECT
    ae.id,
    ae.workspace_id,
    ae.entity_id,
    ae.category::text,
    ae.title,
    ae.body,
    ae.actor_id,
    u.display_name AS actor_name,
    ae.action_item_id,
    ae.inbox_item_id,
    ae.source_type,
    ae.external_url,
    ae.domain,
    ae.visibility::text,
    ae.metadata,
    ae.occurred_at,
    ae.created_at
  FROM activity_events ae
  JOIN users u ON u.id = ae.actor_id
  WHERE ae.entity_id IS NOT NULL;
