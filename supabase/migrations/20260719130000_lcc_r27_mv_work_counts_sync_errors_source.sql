-- ============================================================================
-- R27: fix mv_work_counts.sync_errors at the source (durable de-stale)
-- Life Command Center — LCC Opps
--
-- Problem
-- -------
-- `mv_work_counts.sync_errors` was defined as an ALL-TIME total of unresolved
-- rows in the `sync_errors` audit-trail table:
--
--   (SELECT count(*) FROM sync_errors se
--      JOIN connector_accounts ca ON ca.id = se.connector_account_id
--     WHERE ca.workspace_id = w.id AND se.resolved_at IS NULL)
--
-- That is what produced the stale "2,638" the Today widgets showed before R25
-- repointed them at the live `/api/sync?action=health` `summary.error` (0 today).
-- The displays are correct now, but the FIELD still carries an all-time total
-- mislabeled "current". Any future consumer that reads
-- `canonicalCounts.sync_errors` / `mv_work_counts.sync_errors` (ops-chat context
-- packet, a new widget, an alert) would silently re-inherit the stale number.
--
-- Fix
-- ---
-- Redefine `sync_errors` to mean exactly what `summary.error` means: the count
-- of `connector_accounts` currently in `status='error'` for the workspace.
-- That is the bounded, actionable connector-status signal the rest of the app
-- reads (`handleHealth` in api/sync.js:
--   summary.error = connectorList.filter(c => c.status === 'error').length).
-- This is the long-deferred follow-up explicitly noted in the QA-10 reconcile
-- patch ("redefine work_counts.sync_errors SQL to use connector status").
--
-- The column NAME stays `sync_errors` (existing readers keep working) — only
-- the expression changes from all-time audit rows -> live connector-error count.
-- The `sync_errors` audit-trail table is untouched; it's still the diagnostic
-- ledger surfaced as `unresolved_errors[]` by the health endpoint.
--
-- Mechanics
-- ---------
-- Postgres has no CREATE OR REPLACE MATERIALIZED VIEW, so the MV is dropped and
-- recreated. We preserve:
--   * the UNIQUE index on (workspace_id) that REFRESH ... CONCURRENTLY requires
--     (the gov mv_gov_overview_stats lesson — concurrent refresh needs a unique
--     index, else refresh_work_counts() errors every run);
--   * the dependent view `v_mv_freshness` (dropped first, recreated identically).
-- `refresh_work_counts()` references the MV by name at runtime, so it is NOT
-- touched and keeps working against the recreated MV.
--
-- Blast radius: read-side MV expression only. No writes to the auth schema /
-- GoTrue / public.users / workspace_memberships; no long locks beyond the
-- normal MV (re)build; tiny bounded MV. Idempotent (DROP IF EXISTS + recreate).
-- ============================================================================

-- Drop dependent view first, then the MV (order matters).
DROP VIEW IF EXISTS v_mv_freshness;
DROP MATERIALIZED VIEW IF EXISTS mv_work_counts;

-- ----------------------------------------------------------------------------
-- RECREATE: mv_work_counts — workspace-level aggregations
-- Identical to schema/030_fix_mv_work_counts.sql EXCEPT the sync_errors column,
-- which now counts connectors currently in status='error' (matches summary.error).
-- ----------------------------------------------------------------------------
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

    -- Sync error counts — R27: live connector-status errors (matches
    -- /api/sync?action=health summary.error), NOT an all-time count of
    -- unresolved sync_errors audit-trail rows.
    (SELECT count(*) FROM connector_accounts ca
      WHERE ca.workspace_id = w.id AND ca.status = 'error') AS sync_errors,

    -- Entity counts
    (SELECT count(*) FROM entities e WHERE e.workspace_id = w.id) AS total_entities,

    -- Escalation counts
    (SELECT count(*) FROM escalations es WHERE es.workspace_id = w.id AND es.resolved_at IS NULL) AS open_escalations,

    now() AS refreshed_at

  FROM workspaces w
  LEFT JOIN action_items a ON a.workspace_id = w.id
  GROUP BY w.id;

-- Unique index — required by REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX mv_work_counts_workspace_id_idx ON mv_work_counts(workspace_id);

-- ----------------------------------------------------------------------------
-- Recreate dependent view: v_mv_freshness (unchanged definition)
-- ----------------------------------------------------------------------------
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

-- Populate immediately (non-concurrent; the table was just (re)created) and
-- ANALYZE so the planner has stats (the PR #1062 / refresh lesson).
REFRESH MATERIALIZED VIEW mv_work_counts;
ANALYZE mv_work_counts;
