-- ============================================================================
-- SF Tasks Contact Rollup View
-- Surfaces ALL open tasks from salesforce_tasks (which has ~2,600 contacts
-- with virtually zero overlap with salesforce_activities).
-- Uses who_name from salesforce_tasks directly; LEFT JOINs to
-- salesforce_activities only for optional enrichment (email, phone, company).
-- Deduplication with v_crm_client_rollup happens in app.js (line ~1222).
-- ============================================================================

CREATE OR REPLACE VIEW v_sf_tasks_contact_rollup AS
WITH task_contacts AS (
  SELECT
    who_id,
    max(who_name) AS who_name,
    max(owner_id) AS owner_id,
    count(*) AS open_task_count,
    max(activity_date) AS last_activity_date,
    jsonb_agg(
      jsonb_build_object(
        'subject', COALESCE(subject, 'Task'),
        'date', activity_date,
        'notes', COALESCE(description, ''),
        'type', COALESCE(task_type, 'Task'),
        'deal_name', COALESCE(what_name, '')
      )
      ORDER BY activity_date DESC NULLS LAST
    ) AS open_tasks
  FROM salesforce_tasks
  WHERE status IN ('Open', 'Not Started', 'In Progress')
    AND who_id IS NOT NULL
  GROUP BY who_id
)
SELECT
  left(tc.who_id, 15) AS sf_contact_id,
  sa.sf_company_id,
  COALESCE(sa.first_name, split_part(tc.who_name, ' ', 1)) AS first_name,
  COALESCE(sa.last_name, NULLIF(substring(tc.who_name from position(' ' in tc.who_name) + 1), '')) AS last_name,
  COALESCE(
    NULLIF(TRIM(BOTH FROM concat(sa.first_name, ' ', sa.last_name)), ''),
    tc.who_name,
    '(Unknown)'
  ) AS contact_name,
  sa.company_name,
  COALESCE(sa.email, '') AS email,
  COALESCE(sa.phone, '') AS phone,
  COALESCE(
    sa.assigned_to,
    CASE tc.owner_id
      WHEN '0051I000001vHJbQAM' THEN 'Scott Briggs'
      ELSE NULL
    END
  ) AS assigned_to,
  tc.open_task_count,
  tc.last_activity_date,
  0 AS completed_activity_count,
  '' AS last_call_notes,
  tc.open_tasks
FROM task_contacts tc
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (sf_contact_id)
    first_name, last_name, company_name, email, phone, assigned_to, sf_company_id
  FROM salesforce_activities
  WHERE sf_contact_id = left(tc.who_id, 15)
  ORDER BY sf_contact_id, activity_date DESC NULLS LAST
  LIMIT 1
) sa ON true;

-- Grant read access
GRANT SELECT ON v_sf_tasks_contact_rollup TO anon, authenticated;
