-- ============================================================================
-- SF Tasks → Deal-Linked Contact Rollup View
-- Bridges salesforce_tasks to salesforce_activities via 15-char ID truncation
-- (salesforce_tasks stores 18-char IDs, salesforce_activities stores 15-char)
-- ============================================================================

CREATE OR REPLACE VIEW v_sf_tasks_contact_rollup AS
WITH deal_contacts AS (
  SELECT DISTINCT sa.sf_contact_id,
    sa.first_name,
    sa.last_name,
    sa.company_name,
    sa.email,
    sa.phone,
    sa.sf_company_id,
    sa.assigned_to
  FROM salesforce_activities sa
  WHERE sa.nm_type = 'Opportunity'
    AND sa.sf_contact_id IS NOT NULL
),
deal_names AS (
  SELECT DISTINCT ON (sf_contact_id)
    sf_contact_id,
    subject AS deal_name
  FROM salesforce_activities
  WHERE nm_type = 'Opportunity'
    AND sf_contact_id IS NOT NULL
  ORDER BY sf_contact_id, activity_date DESC NULLS LAST
)
SELECT
  dc.sf_contact_id,
  dc.sf_company_id,
  dc.first_name,
  dc.last_name,
  concat_ws(' ', dc.first_name, dc.last_name) AS contact_name,
  dc.company_name,
  dc.email,
  dc.phone,
  dc.assigned_to,
  count(*) AS open_task_count,
  max(st.activity_date) AS last_activity_date,
  0 AS completed_activity_count,
  '' AS last_call_notes,
  jsonb_agg(
    jsonb_build_object(
      'subject', COALESCE(st.subject, 'Task'),
      'date', st.activity_date,
      'notes', '',
      'type', 'Opportunity',
      'deal_name', COALESCE(dn.deal_name, st.what_name, '(Deal Task)')
    )
    ORDER BY st.activity_date DESC NULLS LAST
  ) AS open_tasks
FROM salesforce_tasks st
JOIN deal_contacts dc ON left(st.who_id, 15) = dc.sf_contact_id
LEFT JOIN deal_names dn ON dc.sf_contact_id = dn.sf_contact_id
WHERE st.status IN ('Open', 'Not Started', 'In Progress')
  AND st.who_id IS NOT NULL
GROUP BY dc.sf_contact_id, dc.sf_company_id, dc.first_name, dc.last_name,
         dc.company_name, dc.email, dc.phone, dc.assigned_to, dn.deal_name;

-- Grant read access
GRANT SELECT ON v_sf_tasks_contact_rollup TO anon, authenticated;
