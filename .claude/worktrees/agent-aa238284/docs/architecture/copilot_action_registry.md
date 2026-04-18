# Copilot Action Registry (Wave 1)

## Purpose
Define the Wave 1, implementation-ready Copilot action inventory for LCC and connected domain systems.

Scope is intentionally limited to high-ROI Wave 1 workflows:
- Outlook ingestion
- staged intake visibility
- review queue surfacing
- daily briefing
- prospecting support
- seller email drafting
- alerts / run / status queries

## Action Metadata Standard
Each action entry includes:
1. `action_name`
2. `user_goal`
3. `category`
4. `owning_repo`
5. `endpoint_or_function`
6. `microsoft_surface`
7. `inputs`
8. `outputs`
9. `risk_tier` (0-4)
10. `confirmation_required` (`none`, `lightweight`, `explicit`)
11. `idempotency_notes`
12. `listing_driven_production_support`

---

## Intake & Triage

### 1) ingest_outlook_flagged_emails
- `action_name`: `ingest_outlook_flagged_emails`
- `user_goal`: Pull newly flagged Outlook emails into canonical intake.
- `category`: `ingest/submit`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/sync?action=ingest_emails`
- `microsoft_surface`: `Outlook`, `Power Automate`, `Teams`, `LCC`
- `inputs`: optional workspace context header (`x-lcc-workspace`)
- `outputs`: `{ sync_job_id, correlation_id, status, processed, failed, errors[] }`
- `risk_tier`: `1`
- `confirmation_required`: `lightweight`
- `idempotency_notes`: Upsert uses external identifiers; repeat runs are expected and safe for incremental ingest.
- `listing_driven_production_support`: Captures inbound owner/client/prospect signals quickly so opportunities are not missed.

### 2) list_staged_intake_inbox
- `action_name`: `list_staged_intake_inbox`
- `user_goal`: View current staged intake items awaiting triage or promotion.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/inbox?status=<new|triaged|...>&source_type=<...>&limit=<n>&offset=<n>`
- `microsoft_surface`: `Teams`, `LCC`, `Copilot Chat`
- `inputs`: filters (`status`, `source_type`, `assigned_to`, `priority`, `domain`, pagination)
- `outputs`: `{ items: [...], count }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query.
- `listing_driven_production_support`: Keeps intake transparent so high-value leads are triaged early.

### 3) triage_inbox_item
- `action_name`: `triage_inbox_item`
- `user_goal`: Move staged intake item into triaged state with optional assignment/priority.
- `category`: `review/resolve`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `PATCH /api/inbox?id=<inbox_id>`
- `microsoft_surface`: `Teams`, `LCC`
- `inputs`: `id` (query), body fields such as `status`, `priority`, `assigned_to`, `entity_id`, `metadata`
- `outputs`: `{ item }`
- `risk_tier`: `2`
- `confirmation_required`: `lightweight`
- `idempotency_notes`: Reapplying same status/fields is effectively idempotent; lifecycle transition rules enforced server-side.
- `listing_driven_production_support`: Converts raw inbound noise into actionable listing workflow signals.

### 4) promote_intake_to_action
- `action_name`: `promote_intake_to_action`
- `user_goal`: Convert vetted intake item into shared team action.
- `category`: `orchestrate`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/workflows?action=promote_to_shared`
- `microsoft_surface`: `Teams`, `Planner/To Do`, `LCC`
- `inputs`: `inbox_item_id`, optional `assigned_to`, `priority`, `due_date`, `entity_id`, `title`, `description`
- `outputs`: `{ action, inbox_status, workflow }`
- `risk_tier`: `2`
- `confirmation_required`: `explicit`
- `idempotency_notes`: Not idempotent for repeated successful promotions; API blocks already-promoted inbox items.
- `listing_driven_production_support`: Ensures opportunities and follow-ups enter execution queues quickly.

### 5) list_government_review_observations
- `action_name`: `list_government_review_observations`
- `user_goal`: Surface government evidence/research observations awaiting review.
- `category`: `read/query`
- `owning_repo`: `GovernmentProject`
- `endpoint_or_function`: `GET /api/gov-evidence?endpoint=research-observations`
- `microsoft_surface`: `Teams`, `LCC`
- `inputs`: optional query params (`status`, identifiers as supported)
- `outputs`: Observation queue payload from government evidence service
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query through LCC router.
- `listing_driven_production_support`: Speeds governance review so government leads/records move faster.

### 6) list_dialysis_review_queue
- `action_name`: `list_dialysis_review_queue`
- `user_goal`: Surface dialysis property link review items.
- `category`: `read/query`
- `owning_repo`: `DialysisProject`
- `endpoint_or_function`: `GET /api/dia-query?table=v_clinic_property_link_review_queue&select=*`
- `microsoft_surface`: `Teams`, `LCC`
- `inputs`: standard data-proxy query params (`filter`, `order`, `limit`, `offset`)
- `outputs`: `{ data: [...], count }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query through LCC proxy.
- `listing_driven_production_support`: Improves clinic-property matching throughput for dialysis pursuit quality.

---

## Prospecting

### 7) get_hot_business_contacts
- `action_name`: `get_hot_business_contacts`
- `user_goal`: Identify highest-engagement contacts for outbound today.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/contacts?action=hot_leads&limit=<n>`
- `microsoft_surface`: `Teams`, `Outlook`, `Copilot Chat`, `LCC`
- `inputs`: `limit`
- `outputs`: `{ contacts: [...] }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query.
- `listing_driven_production_support`: Focuses outbound activity on warm relationships likely to convert into listing conversations.

### 8) generate_prospecting_brief
- `action_name`: `generate_prospecting_brief`
- `user_goal`: Get a concise call-sheet style briefing for outreach.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/chat`
- `microsoft_surface`: `Teams`, `Outlook`, `LCC`
- `inputs`: `message`, optional `context`, `history`, `attachments`
- `outputs`: `{ response, usage, provider }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Deterministic idempotency not guaranteed (LLM output variance), but no system write side effects.
- `listing_driven_production_support`: Reduces prep time and improves prospecting consistency per broker.

### 9) draft_outreach_email
- `action_name`: `draft_outreach_email`
- `user_goal`: Produce personalized outreach drafts using available context.
- `category`: `notify/communicate`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/chat`
- `microsoft_surface`: `Outlook`, `Teams`, `LCC`
- `inputs`: prompt including recipient context, intent, tone, objective
- `outputs`: draft body text (optionally with subject suggestions)
- `risk_tier`: `1`
- `confirmation_required`: `explicit`
- `idempotency_notes`: Draft generation has no backend mutation; sending remains user-controlled in Outlook.
- `listing_driven_production_support`: Improves touchpoint cadence and quality, driving new listing opportunities.

---

## Listing Pursuit

### 10) search_entity_targets
- `action_name`: `search_entity_targets`
- `user_goal`: Find canonical entities for listing pursuit prep and linkage.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/entities?action=search&q=<query>&entity_type=<optional>&domain=<optional>`
- `microsoft_surface`: `Teams`, `LCC`, `Copilot Chat`
- `inputs`: `q`, optional `entity_type`, `domain`
- `outputs`: `{ entities, count }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query.
- `listing_driven_production_support`: Helps quickly assemble account/property context for pursuit strategy.

### 11) create_listing_pursuit_followup_task
- `action_name`: `create_listing_pursuit_followup_task`
- `user_goal`: Create actionable next steps from pursuit analysis.
- `category`: `schedule/task`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/actions`
- `microsoft_surface`: `Planner/To Do`, `Teams`, `LCC`
- `inputs`: `title`, `action_type`, optional `description`, `priority`, `assigned_to`, `due_date`, `entity_id`, `domain`
- `outputs`: `{ action }`
- `risk_tier`: `2`
- `confirmation_required`: `explicit`
- `idempotency_notes`: Not strictly idempotent; repeated requests can create duplicate tasks.
- `listing_driven_production_support`: Translates pursuit insight into concrete broker actions that move assignments forward.

---

## Marketing

### 12) draft_seller_update_email
- `action_name`: `draft_seller_update_email`
- `user_goal`: Generate weekly seller update drafts from queue/activity context.
- `category`: `notify/communicate`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/chat`
- `microsoft_surface`: `Outlook`, `Teams`, `LCC`
- `inputs`: prompt + listing context (activity highlights, open items, milestones)
- `outputs`: seller-ready draft summary email text
- `risk_tier`: `1`
- `confirmation_required`: `explicit`
- `idempotency_notes`: No backend mutation; user approval required before sending externally.
- `listing_driven_production_support`: Improves seller communication quality and responsiveness, supporting client retention and referrals.

### 13) fetch_listing_activity_context
- `action_name`: `fetch_listing_activity_context`
- `user_goal`: Pull timeline/activity context used to draft seller communications.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/queue-v2?view=entity_timeline&entity_id=<id>&per_page=<n>`
- `microsoft_surface`: `LCC`, `Teams`, `Copilot Chat`
- `inputs`: `entity_id`, pagination parameters
- `outputs`: `{ view, events, has_more, next_cursor }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query.
- `listing_driven_production_support`: Supplies concrete activity evidence for stronger seller updates and market communication.

---

## Execution

### 14) get_my_execution_queue
- `action_name`: `get_my_execution_queue`
- `user_goal`: See assigned work due soon/overdue for execution discipline.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/queue-v2?view=my_work&status=<optional>&sort=due_date`
- `microsoft_surface`: `Teams`, `Planner/To Do`, `LCC`
- `inputs`: optional status/domain/priority/page parameters
- `outputs`: `{ view, items, pagination }`
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only query.
- `listing_driven_production_support`: Prevents dropped execution tasks that delay transactions and client communication.

### 15) update_execution_task_status
- `action_name`: `update_execution_task_status`
- `user_goal`: Progress or complete execution tasks from Copilot surface.
- `category`: `review/resolve`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `PATCH /api/actions?id=<action_id>`
- `microsoft_surface`: `Teams`, `Planner/To Do`, `LCC`
- `inputs`: `id` (query), body fields (`status`, optional assignment/priority/metadata updates)
- `outputs`: `{ action }`
- `risk_tier`: `2`
- `confirmation_required`: `explicit`
- `idempotency_notes`: Reapplying same state is effectively idempotent; lifecycle rules enforce legal transitions.
- `listing_driven_production_support`: Keeps transaction and follow-up workflows moving to close with fewer misses.

---

## Ops / Visibility

### 16) get_daily_briefing_snapshot
- `action_name`: `get_daily_briefing_snapshot`
- `user_goal`: Provide a single daily "what matters now" snapshot.
- `category`: `orchestrate`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `to_be_implemented` (compose existing calls: `GET /api/queue-v2?view=work_counts`, `GET /api/queue-v2?view=my_work`, `GET /api/queue-v2?view=inbox`, `GET /api/sync?action=health`, `GET /api/workflows?action=unassigned`)
- `microsoft_surface`: `Teams`, `Outlook`, `LCC`
- `inputs`: workspace context, optional user and domain filters
- `outputs`: consolidated briefing object (priorities, due/overdue, intake load, sync risk, unassigned work)
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only aggregator; no write side effects.
- `listing_driven_production_support`: Concentrates team attention on highest-leverage actions each day.

### 17) get_sync_run_health
- `action_name`: `get_sync_run_health`
- `user_goal`: Check connector health, run outcomes, and failure posture.
- `category`: `read/query`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `GET /api/sync?action=health`, `GET /api/sync?action=jobs`, `GET /api/connectors?action=health`
- `microsoft_surface`: `Teams`, `LCC`, `Copilot Chat`
- `inputs`: optional paging/filter parameters for jobs
- `outputs`: health summary, drift/error metrics, recent jobs, connector status breakdown
- `risk_tier`: `0`
- `confirmation_required`: `none`
- `idempotency_notes`: Read-only queries.
- `listing_driven_production_support`: Detects ingestion/reporting blind spots before they impact pursuit and execution.

### 18) retry_sync_error_record
- `action_name`: `retry_sync_error_record`
- `user_goal`: Re-run retryable sync failures without leaving collaboration surface.
- `category`: `review/resolve`
- `owning_repo`: `LCC`
- `endpoint_or_function`: `POST /api/sync?action=retry&error_id=<sync_error_id>`
- `microsoft_surface`: `Teams`, `LCC`
- `inputs`: `error_id`
- `outputs`: retry result payload including updated status and counts
- `risk_tier`: `2`
- `confirmation_required`: `explicit`
- `idempotency_notes`: Safe to retry when item remains retryable; repeated retries may be no-op after resolution.
- `listing_driven_production_support`: Restores missing activity/task data quickly so downstream listing workflows remain complete.

---

## Wave 1 Action Coverage vs Business Objectives

| Business objective | Wave 1 coverage | Primary actions |
|---|---|---|
| Capture opportunities early | Covered | `ingest_outlook_flagged_emails`, `list_staged_intake_inbox`, `triage_inbox_item`, `promote_intake_to_action` |
| Keep prospecting cadence high | Covered | `get_hot_business_contacts`, `generate_prospecting_brief`, `draft_outreach_email` |
| Improve pursuit readiness | Covered | `search_entity_targets`, `create_listing_pursuit_followup_task` |
| Improve seller communication speed/quality | Covered | `fetch_listing_activity_context`, `draft_seller_update_email` |
| Improve execution reliability | Covered | `get_my_execution_queue`, `update_execution_task_status` |
| Increase operational visibility and resilience | Covered | `get_daily_briefing_snapshot` (aggregator), `get_sync_run_health`, `retry_sync_error_record`, review queue surfacing actions |

## Notes
- This registry intentionally excludes Wave 2+ workflows and high-autonomy domain-write actions.
- Any new Wave 1 action should be added only if it maps to the Wave 1 focus scope and uses existing endpoints or explicitly marked `to_be_implemented` orchestration wrappers.
