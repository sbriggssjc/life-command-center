-- ============================================================================
-- HP1-P2a: route data-hygiene rows off the homepage/Inbox surface
-- Life Command Center — LCC Opps
--
-- Measured live 2026-09-12, inbox_items WHERE status='new':
--
--   new_contact_qualify        879   -- not broker judgment; captured CoStar
--                                     -- contacts awaiting activation. Has a
--                                     -- real destination: v_lcc_contact_qualify_
--                                     -- worklist (868 live rows) + the existing
--                                     -- "Qualify contacts →" surface
--                                     -- (renderContactQualifyWorklist()).
--   contact_misparse_review    117   -- not broker judgment; parser output
--                                     -- awaiting correction. NO resolution
--                                     -- surface exists anywhere in the repo
--                                     -- (zero readers of source_type=
--                                     -- 'contact_misparse_review' in api/ or
--                                     -- the front end) — routing it off the
--                                     -- Inbox would delete the only place it
--                                     -- is visible. LEFT ON THE SURFACE;
--                                     -- filed as a gap, not fixed here
--                                     -- (docs/os/PLANNED-BACKLOG.md HP1-P2a).
--   email_alert (personal)      20   -- out of scope — HP1-P2b.
--   email_om/sidebar_om/
--     folder_feed_om            33   -- broker judgment (OM triage).
--   flagged_email                12  -- broker judgment (flagged mail).
--
-- Only new_contact_qualify is excluded here. The Inbox correctly still shows
-- 182 items after this change (1061 - 879), not a smaller number — the other
-- four source_types are either genuine broker work or a lane with nowhere
-- else to go yet.
--
-- Exclusion lives at the VIEW (v_inbox_triage), not per-handler, because
-- every consumer of the view is an "Inbox" surface and none of them wants
-- to show captured-contact hygiene rows:
--   - api/queue.js `case 'inbox':` (v1, dead in practice — ops.js's V2_MAP
--     rewrites every '/api/queue?view=inbox' call to '/api/queue-v2?view=inbox'
--     before it reaches the wire; kept correct anyway since it's the same view)
--   - api/queue.js handleInbox() via /api/inbox — the full Inbox page
--     (ops.js renderInboxTriage())
--   - api/queue.js v2GetInbox() via /api/queue-v2?view=inbox — the Today-page
--     "Inbox" widget (app.js loadCanonicalData/renderRecentEmails) AND the
--     Outlook-flagged-email cross-reference join in loadMessages() (keyed on
--     external_id, which new_contact_qualify rows never carry — safe to drop)
--
-- mv_work_counts.inbox_new is redefined the same way (excluding
-- new_contact_qualify) so the Inbox page HEADER count
-- ("Showing X of Y", QA-18) stays honest against the now-filtered list —
-- otherwise this would reproduce the exact QA-18 defect (list count and
-- header count disagreeing by ~900).
--
-- `CREATE OR REPLACE VIEW` is append-only for columns (repo invariant) —
-- this migration changes only the WHERE clause of v_inbox_triage, no
-- columns added or reordered, so no consumer's `select=` shape changes.
-- ============================================================================

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
  WHERE i.status IN ('new', 'triaged')
    AND i.source_type IS DISTINCT FROM 'new_contact_qualify';

-- ----------------------------------------------------------------------------
-- mv_work_counts.inbox_new — same exclusion, so the Inbox header total and
-- the filtered list total agree. Postgres has no CREATE OR REPLACE MATERIALIZED
-- VIEW, so drop + recreate (mirrors the R27 migration's mechanics: preserve
-- the unique index REFRESH ... CONCURRENTLY needs, and the dependent
-- v_mv_freshness view).
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_mv_freshness;
DROP MATERIALIZED VIEW IF EXISTS mv_work_counts;

CREATE MATERIALIZED VIEW mv_work_counts AS
  SELECT
    w.id AS workspace_id,

    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress','waiting')), 0) AS open_actions,
    coalesce(count(*) FILTER (WHERE a.status = 'in_progress'), 0) AS in_progress_actions,
    coalesce(count(*) FILTER (WHERE a.status = 'completed' AND a.completed_at > now() - interval '7 days'), 0) AS completed_week,
    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress') AND a.due_date < current_date), 0) AS overdue_actions,
    coalesce(count(*) FILTER (WHERE a.status IN ('open','in_progress','waiting') AND a.due_date BETWEEN current_date AND current_date + interval '7 days'), 0) AS due_this_week,

    -- HP1-P2a: excludes new_contact_qualify — a captured-contact hygiene row
    -- is not "new inbox work requiring attention"; it has its own worklist.
    (SELECT count(*) FROM inbox_items i
      WHERE i.workspace_id = w.id AND i.status = 'new'
        AND i.source_type IS DISTINCT FROM 'new_contact_qualify') AS inbox_new,
    (SELECT count(*) FROM inbox_items i
      WHERE i.workspace_id = w.id AND i.status = 'triaged'
        AND i.source_type IS DISTINCT FROM 'new_contact_qualify') AS inbox_triaged,

    (SELECT count(*) FROM research_tasks r WHERE r.workspace_id = w.id AND r.status IN ('queued','in_progress')) AS research_active,

    (SELECT count(*) FROM connector_accounts ca
      WHERE ca.workspace_id = w.id AND ca.status = 'error') AS sync_errors,

    (SELECT count(*) FROM entities e WHERE e.workspace_id = w.id) AS total_entities,

    (SELECT count(*) FROM escalations es WHERE es.workspace_id = w.id AND es.resolved_at IS NULL) AS open_escalations,

    now() AS refreshed_at

  FROM workspaces w
  LEFT JOIN action_items a ON a.workspace_id = w.id
  GROUP BY w.id;

CREATE UNIQUE INDEX mv_work_counts_workspace_id_idx ON mv_work_counts(workspace_id);

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

REFRESH MATERIALIZED VIEW mv_work_counts;
ANALYZE mv_work_counts;
