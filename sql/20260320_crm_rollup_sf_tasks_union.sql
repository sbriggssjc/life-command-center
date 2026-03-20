-- ============================================================================
-- SF Tasks → Deal-Linked Contact Rollup View
-- Surfaces Opportunity-linked tasks from salesforce_tasks in the CRM hub.
--
-- PREREQUISITE: The Power Automate flow must be updated to include
-- WhatId, What.Name, What.Type in its SOQL query (via raw HTTP/SOQL,
-- not the OData connector which doesn't support relationship fields).
-- After updating, a full re-sync must be triggered so existing tasks
-- get what_id/what_name/what_type populated.
--
-- ID FORMAT NOTE: salesforce_tasks stores 18-char Salesforce IDs,
-- salesforce_activities stores 15-char IDs. The view uses
-- left(who_id, 15) to bridge the gap for contact enrichment.
-- ============================================================================

CREATE OR REPLACE VIEW v_sf_tasks_contact_rollup AS
WITH task_contacts AS (
  SELECT
    who_id,
    who_name,
    what_name AS deal_name,
    count(*) AS open_task_count,
    max(activity_date) AS last_activity_date,
    jsonb_agg(
      jsonb_build_object(
        'subject', COALESCE(subject, 'Task'),
        'date', activity_date,
        'notes', COALESCE(description, ''),
        'type', COALESCE(task_type, subject),
        'deal_name', COALESCE(what_name, '(Deal Task)')
      )
      ORDER BY activity_date DESC NULLS LAST
    ) AS open_tasks
  FROM salesforce_tasks
  WHERE status IN ('Open', 'Not Started', 'In Progress')
    AND who_id IS NOT NULL
    AND what_type = 'Opportunity'
  GROUP BY who_id, who_name, what_name
)
SELECT
  left(tc.who_id, 15) AS sf_contact_id,
  NULL AS sf_company_id,
  COALESCE(sa.first_name, split_part(tc.who_name, ' ', 1)) AS first_name,
  COALESCE(sa.last_name, NULLIF(substring(tc.who_name from position(' ' in tc.who_name) + 1), '')) AS last_name,
  COALESCE(
    TRIM(CONCAT(sa.first_name, ' ', sa.last_name)),
    tc.who_name,
    '(Unknown)'
  ) AS contact_name,
  sa.company_name,
  COALESCE(sa.email, '') AS email,
  COALESCE(sa.phone, '') AS phone,
  sa.assigned_to,
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
