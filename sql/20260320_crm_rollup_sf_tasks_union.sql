-- ============================================================================
-- CRM Client Rollup — Union salesforce_tasks into v_crm_client_rollup
-- Surfaces deal-linked tasks from salesforce_tasks in the CRM hub.
-- ============================================================================
--
-- ROOT CAUSE (discovered 2026-03-20):
-- salesforce_tasks stores 18-char Salesforce IDs (who_id), while
-- salesforce_activities stores 15-char IDs (sf_contact_id). These are the
-- same IDs but in different formats — SF 15-char (case-sensitive) vs
-- 18-char (case-insensitive + 3-char checksum). The PA flow's OData
-- connector returns 18-char IDs; the activities sync uses 15-char.
--
-- FIX: Join on left(st.who_id, 15) = sa.sf_contact_id to bridge the gap.
-- who_name is NULL for most tasks, so we enrich from salesforce_activities.
--
-- DATA REALITY:
-- - 0 tasks have WhatId pointing to an Opportunity (006 prefix)
-- - 118 open tasks belong to contacts who have Opportunity activities
-- - 30 unique deal-linked contacts discoverable via this join
-- - The "494 deal-related tasks" estimate was based on a WhatId assumption
--   that doesn't hold; the actual linkage is contact-based, not WhatId-based.
--
-- IMPORTANT: v_crm_client_rollup is a MATERIALIZED VIEW defined in Supabase.
-- This migration must be run directly against the Dialysis Supabase instance.
-- After applying, call: REFRESH MATERIALIZED VIEW CONCURRENTLY v_crm_client_rollup;
-- ============================================================================

-- Step 1: Create a helper view that finds open tasks on deal-linked contacts.
-- Enriches contact name, company, and deal name from salesforce_activities.

CREATE OR REPLACE VIEW v_sf_tasks_contact_rollup AS
WITH deal_contacts AS (
  -- Distinct contacts who appear on at least one Opportunity activity
  SELECT DISTINCT
    sa.sf_contact_id,
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
  -- Most recent deal name per contact (from Opportunity activities)
  SELECT DISTINCT ON (sf_contact_id)
    sf_contact_id,
    subject AS deal_name
  FROM salesforce_activities
  WHERE nm_type = 'Opportunity' AND sf_contact_id IS NOT NULL
  ORDER BY sf_contact_id, activity_date DESC NULLS LAST
)
SELECT
  dc.sf_contact_id                         AS sf_contact_id,
  dc.sf_company_id                         AS sf_company_id,
  dc.first_name                            AS first_name,
  dc.last_name                             AS last_name,
  concat_ws(' ', dc.first_name, dc.last_name) AS contact_name,
  dc.company_name                          AS company_name,
  dc.email                                 AS email,
  dc.phone                                 AS phone,
  dc.assigned_to                           AS assigned_to,
  -- Open task count
  count(*)                                 AS open_task_count,
  max(st.activity_date)                    AS last_activity_date,
  0                                        AS completed_activity_count,
  ''                                       AS last_call_notes,
  -- Open tasks JSON array (for inline task enrichment in CRM hub)
  jsonb_agg(
    jsonb_build_object(
      'subject',   coalesce(st.subject, 'Task'),
      'date',      st.activity_date,
      'notes',     '',
      'type',      'Opportunity',
      'deal_name', coalesce(dn.deal_name, st.what_name, '(Deal Task)')
    )
    ORDER BY st.activity_date DESC NULLS LAST
  )                                        AS open_tasks
FROM salesforce_tasks st
JOIN deal_contacts dc ON left(st.who_id, 15) = dc.sf_contact_id
LEFT JOIN deal_names dn ON dc.sf_contact_id = dn.sf_contact_id
WHERE st.status IN ('Open','Not Started','In Progress')
  AND st.who_id IS NOT NULL
GROUP BY
  dc.sf_contact_id, dc.sf_company_id,
  dc.first_name, dc.last_name, dc.company_name,
  dc.email, dc.phone, dc.assigned_to, dn.deal_name;

-- Step 2: Verification queries
-- After creating the view, run:
--   SELECT count(*) FROM v_sf_tasks_contact_rollup;
--   -- Expected: ~30 contacts with ~118 open tasks
--
--   SELECT sf_contact_id, contact_name, company_name, open_task_count,
--          open_tasks->0->>'deal_name' as deal_name
--   FROM v_sf_tasks_contact_rollup
--   ORDER BY open_task_count DESC
--   LIMIT 10;

-- Step 3: After the materialized view is rebuilt to UNION this helper view,
-- refresh it:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY v_crm_client_rollup;

-- ============================================================================
-- NOTE TO SCOTT:
-- The full v_crm_client_rollup materialized view definition lives in Supabase
-- (not in this repo). To complete the union, the MV definition needs to be
-- updated to LEFT JOIN or UNION ALL with v_sf_tasks_contact_rollup,
-- deduplicating by sf_contact_id (preferring salesforce_activities data where
-- both exist). The app.js loadMarketing() change handles this client-side in
-- the interim — it fetches salesforce_tasks directly and merges contacts not
-- already present in the rollup.
--
-- ID FORMAT NOTE: The app.js merge logic must also truncate who_id to 15
-- chars when deduplicating against v_crm_client_rollup contacts:
--   left(who_id, 15) = sf_contact_id
-- ============================================================================
