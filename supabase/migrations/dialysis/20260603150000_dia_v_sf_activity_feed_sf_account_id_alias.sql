-- E2E#6 (2026-06-03): dia property-detail loads log a recurring console 400:
--   diaQuery v_sf_activity_feed: HTTP 400 —
--   column v_sf_activity_feed.sf_account_id does not exist
--
-- The shared detail.js / app.js renderer filters the activity feed by
-- `sf_account_id` (the Salesforce Account FK) at several call sites
-- (owner panel, activity-log tab, owner drawer, tenant drawer). The dia
-- view exposes the same value under the name `sf_company_id`, so every
-- primary lookup 400s and only the secondary `sf_company_id` fallback (one
-- call site has it) recovers.
--
-- Fix: expose `sf_account_id` on the dia view as an alias of the SF Account
-- FK so all consumer call sites resolve, matching the name the renderer
-- expects. Additive, view-only change. CREATE OR REPLACE VIEW is
-- column-append-only, so the new column is added at the END of every UNION
-- branch.

CREATE OR REPLACE VIEW public.v_sf_activity_feed AS
 SELECT sa.activity_id::text AS feed_id,
    'sf_activity'::text AS feed_type,
    sa.activity_date,
    sa.nm_type AS activity_type,
    sa.subject,
    sa.nm_notes AS notes,
    sa.assigned_to,
    sa.status,
    (sa.first_name || ' '::text) || sa.last_name AS contact_name,
    sa.company_name,
    sa.sf_contact_id,
    sa.sf_company_id,
    sa.contact_id,
    sa.true_owner_id,
    sa.created_at,
    sa.sf_company_id AS sf_account_id
   FROM salesforce_activities sa
UNION ALL
 SELECT st.id AS feed_id,
    'sf_task'::text AS feed_type,
    st.activity_date,
    st.task_type AS activity_type,
    st.subject,
    st.description AS notes,
    NULL::text AS assigned_to,
    st.status,
    st.who_name AS contact_name,
    st.what_name AS company_name,
    st.who_id AS sf_contact_id,
    st.what_id AS sf_company_id,
    NULL::uuid AS contact_id,
    NULL::uuid AS true_owner_id,
    st.created_date AS created_at,
    st.what_id AS sf_account_id
   FROM salesforce_tasks st
UNION ALL
 SELECT co.call_outcome_id::text AS feed_id,
    'call_log'::text AS feed_type,
    co.call_date AS activity_date,
    'Call'::text AS activity_type,
    co.outcome AS subject,
    co.notes,
    co.team_member AS assigned_to,
    'Completed'::text AS status,
    NULL::text AS contact_name,
    NULL::text AS company_name,
    NULL::text AS sf_contact_id,
    NULL::text AS sf_company_id,
    co.contact_id,
    co.true_owner_id,
    co.created_at,
    NULL::text AS sf_account_id
   FROM call_outcomes co
  ORDER BY 3 DESC NULLS LAST;
