# Claude Code Prompt — Fix the `salesforce_activities` Stale-Column Query Error (Dialysis_DB app)

## Symptom (measured live)
The dialysis project's Postgres + API logs show a recurring error every ~30–60s:
`ERROR: column salesforce_activities.id does not exist`, paired with PostgREST `GET 400`s like
`/rest/v1/salesforce_activities?nm_type=eq.Task&is_closed=eq.false&order=due_date.asc.nullslast&limit=20&select=id,subject,who_name,what_name,status,activity_date,due_date,priority,description`.

## Root cause
The `salesforce_activities` table's real columns are:
`activity_id (uuid, PK), subject, first_name, last_name, sf_contact_id, company_name, sf_company_id,
company_address, company_city_state, assigned_to, nm_type, activity_date, nm_notes, task_subtype, email,
phone, status, created_at, contact_id, true_owner_id, sf_task_id, prospect_domain, source_ref`.
A client (the CRM/marketing frontend or a scheduled fetch) is selecting **columns that no longer exist**:
`id, who_name, what_name, is_closed, due_date, priority, description`. Every call 400s and logs the error.
This is **app/query code, not a DB or comps problem** — the comps engine is unaffected.

## Implement (pick the lower-risk fix for the codebase)
1. **Find the offending query** — grep the LCC frontend/api for `salesforce_activities` selecting `id` /
   `is_closed` / `who_name` / `what_name` / `due_date` / `priority` / `description` (likely a CRM/marketing
   task list — `app.js`, `marketing*`, `contacts*`, or a sync/fetch module).
2. **Map to real columns:** `id`→`activity_id` (or `sf_task_id`), `is_closed`→derive from `status`
   (e.g. `status=eq.Open` for open), `who_name`→`first_name`+`last_name` or `company_name`,
   `what_name`→`company_name`, `due_date`→`activity_date`, `priority`/`description`→`nm_notes`/(drop if absent).
   Update the `select=` and any filters/orderings accordingly.
3. **OR** if many call sites depend on the old shape, add a **compatibility view** `v_salesforce_activities_compat`
   exposing the legacy column names as aliases over the real columns, and point the client at it — least churn,
   but prefer fixing the query if it's one place.

## Verify / report
- After the fix, the `salesforce_activities.id does not exist` errors stop appearing in new logs and the task
  list the query feeds renders. Report which file(s)/query changed (or the view added) and the error rate
  before/after.

## Guardrails
- Read-only intent (this is a list/fetch query). No change to `salesforce_activities` data. If adding a compat
  view, it's additive + reversible. Out of scope: the comps engine (unaffected).
