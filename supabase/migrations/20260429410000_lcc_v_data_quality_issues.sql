-- ============================================================================
-- Migration: LCC ops v_data_quality_issues + v_data_quality_summary
--
-- Target: LCC ops Supabase (OPS_SUPABASE_URL)
--
-- Mirrors the dia / gov v_data_quality_issues views for the LCC ops DB.
-- Surfaces patterns that point at workflow stagnation, hung sync jobs,
-- referential drift, and unresolved escalations.
--
-- Key shape difference from dia/gov: LCC ops is multi-tenant, so the view
-- includes workspace_id as the first column. UI consumers should always
-- filter on workspace_id.
--
-- Categories:
--   1. stuck_sync_job          — sync_jobs in pending/running > 24h
--   2. unresolved_sync_error   — sync_errors unresolved > 30 days
--   3. stuck_research          — research_tasks in_progress > 30 days
--   4. stale_open_action       — action_items open/in_progress with no
--                                updated_at change in > 90 days
--   5. unassigned_action       — action_items open/in_progress, no
--                                assigned_to, created > 7 days ago
--   6. orphan_inbox_entity     — inbox_items.entity_id references a
--                                non-existent entity
--   7. orphan_action_entity    — action_items.entity_id references a
--                                non-existent entity
--   8. escalation_overdue      — escalations unresolved > 14 days
-- ============================================================================

CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH stuck_sync_job AS (
  SELECT
    'stuck_sync_job'::text         AS issue_kind,
    sj.workspace_id,
    sj.id::text                    AS record_id,
    sj.status::text                AS detail_1,
    sj.entity_type                 AS detail_2,
    sj.correlation_id              AS detail_3,
    GREATEST(1, EXTRACT(EPOCH FROM (now() - sj.created_at))::int / 3600)::int AS severity,
    'Sync job has been ' || sj.status || ' for ' ||
      ROUND(EXTRACT(EPOCH FROM (now() - sj.created_at)) / 3600)::int ||
      ' hours. Likely hung — check connector and retry/fail manually.' AS suggested_action
  FROM public.sync_jobs sj
  WHERE sj.status IN ('pending', 'running')
    AND sj.created_at < now() - interval '24 hours'
),
unresolved_sync_error AS (
  SELECT
    'unresolved_sync_error'::text  AS issue_kind,
    ca.workspace_id                AS workspace_id,
    se.id::text                    AS record_id,
    se.error_code                  AS detail_1,
    se.error_message               AS detail_2,
    ca.connector_type::text        AS detail_3,
    EXTRACT(DAY FROM (now() - se.created_at))::int AS severity,
    'Sync error open for ' ||
      EXTRACT(DAY FROM (now() - se.created_at))::int ||
      ' days. Either resolve or mark non-retryable.' AS suggested_action
  FROM public.sync_errors se
  JOIN public.connector_accounts ca ON ca.id = se.connector_account_id
  WHERE se.resolved_at IS NULL
    AND se.created_at < now() - interval '30 days'
),
stuck_research AS (
  SELECT
    'stuck_research'::text         AS issue_kind,
    r.workspace_id,
    r.id::text                     AS record_id,
    r.research_type                AS detail_1,
    r.title                        AS detail_2,
    r.assigned_to::text            AS detail_3,
    EXTRACT(DAY FROM (now() - r.updated_at))::int AS severity,
    'Research task in_progress with no update in ' ||
      EXTRACT(DAY FROM (now() - r.updated_at))::int ||
      ' days. Check with assignee or reassign.' AS suggested_action
  FROM public.research_tasks r
  WHERE r.status = 'in_progress'
    AND r.updated_at < now() - interval '30 days'
),
stale_open_action AS (
  SELECT
    'stale_open_action'::text      AS issue_kind,
    a.workspace_id,
    a.id::text                     AS record_id,
    a.status::text                 AS detail_1,
    a.title                        AS detail_2,
    a.assigned_to::text            AS detail_3,
    EXTRACT(DAY FROM (now() - a.updated_at))::int AS severity,
    'Action ' || a.status || ' with no update in ' ||
      EXTRACT(DAY FROM (now() - a.updated_at))::int ||
      ' days. Likely forgotten — close or reassign.' AS suggested_action
  FROM public.action_items a
  WHERE a.status IN ('open', 'in_progress')
    AND a.updated_at < now() - interval '90 days'
),
unassigned_action AS (
  SELECT
    'unassigned_action'::text      AS issue_kind,
    a.workspace_id,
    a.id::text                     AS record_id,
    a.status::text                 AS detail_1,
    a.title                        AS detail_2,
    a.priority                     AS detail_3,
    EXTRACT(DAY FROM (now() - a.created_at))::int AS severity,
    'Action open/in_progress with no assignee for ' ||
      EXTRACT(DAY FROM (now() - a.created_at))::int ||
      ' days. Assign someone or downgrade visibility.' AS suggested_action
  FROM public.action_items a
  WHERE a.status IN ('open', 'in_progress')
    AND a.assigned_to IS NULL
    AND a.created_at < now() - interval '7 days'
),
orphan_inbox_entity AS (
  SELECT
    'orphan_inbox_entity'::text    AS issue_kind,
    i.workspace_id,
    i.id::text                     AS record_id,
    i.entity_id::text              AS detail_1,
    i.title                        AS detail_2,
    i.source_type                  AS detail_3,
    1::int                         AS severity,
    'Inbox item references entity_id ' || i.entity_id ||
      ' which does not exist — orphan FK. Set entity_id NULL or relink.' AS suggested_action
  FROM public.inbox_items i
  WHERE i.entity_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id = i.entity_id)
),
orphan_action_entity AS (
  SELECT
    'orphan_action_entity'::text   AS issue_kind,
    a.workspace_id,
    a.id::text                     AS record_id,
    a.entity_id::text              AS detail_1,
    a.title                        AS detail_2,
    a.action_type                  AS detail_3,
    1::int                         AS severity,
    'Action references entity_id ' || a.entity_id ||
      ' which does not exist — orphan FK. Set entity_id NULL or relink.' AS suggested_action
  FROM public.action_items a
  WHERE a.entity_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id = a.entity_id)
),
escalation_overdue AS (
  SELECT
    'escalation_overdue'::text     AS issue_kind,
    es.workspace_id,
    es.id::text                    AS record_id,
    es.action_item_id::text        AS detail_1,
    es.reason                      AS detail_2,
    es.escalated_to::text          AS detail_3,
    EXTRACT(DAY FROM (now() - es.created_at))::int AS severity,
    'Escalation open for ' ||
      EXTRACT(DAY FROM (now() - es.created_at))::int ||
      ' days. Escalator should follow up or close.' AS suggested_action
  FROM public.escalations es
  WHERE es.resolved_at IS NULL
    AND es.created_at < now() - interval '14 days'
)
SELECT * FROM stuck_sync_job
UNION ALL SELECT * FROM unresolved_sync_error
UNION ALL SELECT * FROM stuck_research
UNION ALL SELECT * FROM stale_open_action
UNION ALL SELECT * FROM unassigned_action
UNION ALL SELECT * FROM orphan_inbox_entity
UNION ALL SELECT * FROM orphan_action_entity
UNION ALL SELECT * FROM escalation_overdue;

COMMENT ON VIEW public.v_data_quality_issues IS
  'Triage view of LCC ops data quality patterns. Each row is one issue;
   severity gives relative magnitude (typically days-old). Always filter
   on workspace_id when reading from a multi-tenant context. Use
   issue_kind to filter:
     SELECT * FROM v_data_quality_issues
       WHERE workspace_id = $1 AND issue_kind = ''stuck_sync_job''
       ORDER BY severity DESC';

CREATE OR REPLACE VIEW public.v_data_quality_summary AS
SELECT
  workspace_id,
  issue_kind,
  count(*)         AS issue_count,
  sum(severity)    AS total_severity,
  max(severity)    AS worst_severity
FROM public.v_data_quality_issues
GROUP BY workspace_id, issue_kind
ORDER BY workspace_id, total_severity DESC;
