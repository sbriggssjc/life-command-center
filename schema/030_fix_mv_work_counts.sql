-- ============================================================================
-- 030: Fix mv_work_counts and mv_user_work_counts
-- Life Command Center
--
-- The original materialized views were created with IF NOT EXISTS, which means
-- if an earlier version existed without proper status filtering, re-running
-- the migration wouldn't update the definition. This migration drops and
-- recreates both views to ensure they correctly filter by action status.
--
-- Without this fix, open_actions counts ALL action_items regardless of status,
-- inflating the "Open Activities" count on the home page.
-- ============================================================================

-- Drop dependent view first (v_mv_freshness references mv_work_counts)
DROP VIEW IF EXISTS v_mv_freshness;

-- Drop materialized views (order matters: user counts first, then workspace counts)
DROP MATERIALIZED VIEW IF EXISTS mv_user_work_counts;
DROP MATERIALIZED VIEW IF EXISTS mv_work_counts;

-- ============================================================================
-- RECREATE: mv_work_counts — workspace-level aggregations
-- Only counts action_items with active statuses (open, in_progress, waiting)
-- ============================================================================

CREATE MATERIALIZED VIEW mv_work_counts AS
  SELECT
    w.id AS workspace_id,

    -- Action counts (filtered by status)
    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress','waiting')), 0) AS open_actions,
    coalesce(count(*) FILTER (WHERE a.status = 'in_progress'), 0) AS in_progress_actions,
    coalesce(count(*) FILTER (WHERE a.status = 'completed' AND a.completed_at > now() - interval '7 days'), 0) AS completed_week,
    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress') AND a.due_date < current_date), 0) AS overdue_actions,
    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress','waiting') AND a.due_date BETWEEN current_date AND current_date + interval '7 days'), 0) AS due_this_week,

    -- Inbox counts
    (SELECT count(*) FROM inbox_items i WHERE i.workspace_id = w.id AND i.status = 'new') AS inbox_new,
    (SELECT count(*) FROM inbox_items i WHERE i.workspace_id = w.id AND i.status = 'triaged') AS inbox_triaged,

    -- Research counts
    (SELECT count(*) FROM research_tasks r WHERE r.workspace_id = w.id AND r.status IN ('queued','in_progress')) AS research_active,

    -- Sync error counts
    (SELECT count(*) FROM sync_errors se
      JOIN connector_accounts ca ON ca.id = se.connector_account_id
      WHERE ca.workspace_id = w.id AND se.resolved_at IS NULL) AS sync_errors,

    -- Entity counts
    (SELECT count(*) FROM entities e WHERE e.workspace_id = w.id) AS total_entities,

    -- Escalation counts
    (SELECT count(*) FROM escalations es WHERE es.workspace_id = w.id AND es.resolved_at IS NULL) AS open_escalations,

    now() AS refreshed_at

  FROM workspaces w
  LEFT JOIN action_items a ON a.workspace_id = w.id
  GROUP BY w.id;

CREATE UNIQUE INDEX ON mv_work_counts(workspace_id);

-- ============================================================================
-- RECREATE: mv_user_work_counts — per-user aggregations
-- Only counts action_items owned by or assigned to the user with active statuses
-- ============================================================================

CREATE MATERIALIZED VIEW mv_user_work_counts AS
  SELECT
    wm.workspace_id,
    wm.user_id,

    -- My actions (owner or assigned, active statuses only)
    coalesce(count(*) FILTER (WHERE (a.owner_id = wm.user_id OR a.assigned_to = wm.user_id)
      AND a.status IN ('open','in_progress','waiting')), 0) AS my_actions,

    coalesce(count(*) FILTER (WHERE (a.owner_id = wm.user_id OR a.assigned_to = wm.user_id)
      AND a.status IN ('open','in_progress') AND a.due_date < current_date), 0) AS my_overdue,

    coalesce(count(*) FILTER (WHERE (a.owner_id = wm.user_id OR a.assigned_to = wm.user_id)
      AND a.status = 'completed' AND a.completed_at > now() - interval '7 days'), 0) AS my_completed_week,

    -- My inbox
    (SELECT count(*) FROM inbox_items i
      WHERE i.workspace_id = wm.workspace_id
        AND (i.source_user_id = wm.user_id OR i.assigned_to = wm.user_id)
        AND i.status IN ('new','triaged')) AS my_inbox,

    -- My research
    (SELECT count(*) FROM research_tasks r
      WHERE r.workspace_id = wm.workspace_id
        AND r.assigned_to = wm.user_id
        AND r.status IN ('queued','in_progress')) AS my_research,

    now() AS refreshed_at

  FROM workspace_memberships wm
  LEFT JOIN action_items a ON a.workspace_id = wm.workspace_id
  GROUP BY wm.workspace_id, wm.user_id;

CREATE UNIQUE INDEX ON mv_user_work_counts(workspace_id, user_id);

-- ============================================================================
-- Recreate dependent view: v_mv_freshness
-- ============================================================================

CREATE OR REPLACE VIEW v_mv_freshness AS
  SELECT
    workspace_id,
    refreshed_at,
    extract(epoch FROM (now() - refreshed_at)) / 60 AS minutes_stale,
    CASE
      WHEN refreshed_at > now() - interval '5 minutes' THEN 'fresh'
      WHEN refreshed_at > now() - interval '30 minutes' THEN 'acceptable'
      WHEN refreshed_at > now() - interval '2 hours' THEN 'stale'
      ELSE 'critical'
    END AS freshness_status
  FROM mv_work_counts;

-- ============================================================================
-- Recreate the refresh function
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_work_counts()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_work_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_work_counts;
END;
$$;

-- ============================================================================
-- Populate the views immediately
-- ============================================================================

REFRESH MATERIALIZED VIEW mv_work_counts;
REFRESH MATERIALIZED VIEW mv_user_work_counts;
