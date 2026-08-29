# Copilot Capability Map - life-command-center (LCC)

## 1. Executive Summary
LCC already functions as a cross-domain orchestration app, not just a UI shell. It has:
- A canonical ops data model and workflow engine (`/api/queue`, `/api/workflows`, `/api/actions`, `/api/entities`, `/api/admin`, `/api/sync`).
- Domain bridge/proxy paths into Government and Dialysis data/services (`/api/gov-query`, `/api/dia-query`, `/api/gov-write`, `/api/gov-evidence`, `/api/apply-change`).
- Existing Copilot entry UI and API (`index.html` Copilot panel + `/api/chat` via `api/bridge.js` + provider routing in `api/_shared/ai.js`).

Assessment result: **LCC should be the primary Copilot-facing orchestration and human interaction layer** for this architecture, with strict boundaries:
- LCC hosts conversation, action routing, queue/review surfaces, approvals, and audit-visible orchestration.
- GovernmentProject and DialysisProject remain authoritative for domain rules, write services, and domain-specific transformations.

## 2. Current Role of the life-command-center app in the Multi-Repo System
From the current codebase, LCC is already serving four roles:

1. Canonical operations hub
- Owns shared workspace/team model, queues, inbox triage, actions, research, watchers/escalations, and performance telemetry.
- Backed by OPS Supabase schema (`schema/001` through `schema/018`).

2. Cross-domain integration shell
- Reads from Gov/Dia domain stores through allowlisted proxy (`api/data-proxy.js`).
- Routes Government writes to write-service endpoints (`/api/gov-write`) and evidence endpoints (`/api/gov-evidence`).
- Supports Dialysis ingestion and CRM-style flows in `api/sync.js`.

3. Human review + lifecycle controller
- Workflow transitions, triage/promotion, reassignment, escalation, research closure, and entity merge/link operations.
- Loop-closure/audit model exists (`pending_updates`, `data_corrections`, `WRITE_SURFACE_POLICY.md`).

4. Copilot interaction surface
- In-app chat panel in `index.html` and `app.js` calling `/api/chat`.
- `/api/chat` implemented in `api/bridge.js` and provider policy/routing in `api/_shared/ai.js`.

## 3. Existing Relevant App Surfaces, Modules, APIs, Jobs, Services, and Orchestration Paths

### UI surfaces already relevant to Copilot
- Home + Copilot panel + suggestions: `index.html`, `app.js` (`toggleCopilot`, `sendCopilotMessage`, `buildCopilotContext`).
- Operational pages: My Work, Team Queue, Inbox, Research, Metrics, Sync Health (`ops.js`).
- Domain surfaces:
  - Government: `gov.js` (query proxy, gov write service, evidence/research artifacts paths).
  - Dialysis: `dialysis.js` (domain query/UI workflows).
- Unified detail workflows: `detail.js`.
- Contacts/communication UI: `contacts-ui.js` + contact sections in `app.js`.

### API surfaces and orchestration modules
- Copilot/chat:
  - `POST /api/chat` -> `api/bridge.js` (`handleChatRoute`) -> `invokeChatProvider` (`api/_shared/ai.js`).
- Canonical ops APIs:
  - `api/queue.js`: queue views (v1/v2), inbox CRUD + promote.
  - `api/workflows.js`: promote, sf_task_to_action, research_followup, reassign, escalate, watchers, bulk ops, oversight.
  - `api/actions.js`: action CRUD and activity logging (`/api/activities`).
  - `api/entities.js`: entity CRUD, link, search, duplicates/quality, merge, aliases, precedence.
  - `api/admin.js`: workspaces, members, feature flags.
  - `api/sync.js`: connector management, ingest jobs, outbound, retries, health, verification, isolation checks, RCM/LoopNet/live-ingest normalize.
- Domain bridge/proxy:
  - `api/data-proxy.js`: gov/dia read proxy; controlled write proxy; gov-write/gov-evidence routing.
  - `api/apply-change.js`: closed-loop mutation service for gov/dia writes (audited path).
  - `api/bridge.js`: canonical activity/research/entity sync bridge.
- Diagnostics:
  - `api/diagnostics.js`: config/diag/treasury endpoints.

### Data and job model in repo
- Canonical operations schema and queue/materialized views in `schema/*.sql`.
- Sync jobs + sync errors + connector account model in `schema/002_connectors.sql` and `api/sync.js`.
- Loop-closure audit tables in `schema/018_loop_closure.sql`.

### Existing orchestration paths (implemented)
- Outlook/SF ingest -> canonical inbox/activity -> workflow promotion -> action lifecycle.
- Research completion -> follow-up creation + activity logging (`closeResearchLoop`).
- Domain write intent -> `/api/apply-change` audited mutation and/or gov write service routing.
- Live ingest proposal -> selected operations -> guarded apply with acknowledgements (`app.js` live-ingest workflow).

## 4. Should This Repo Be the Primary Copilot Orchestration Layer?

### Reasons yes
- Existing Copilot endpoint and UI already live in LCC (`/api/chat`, Copilot FAB/panel).
- LCC already owns human workflow and approvals (queue triage, escalation, reassignment, follow-up).
- LCC already routes to domain systems and can enforce boundary policy (`api/data-proxy.js`, `api/apply-change.js`, `WRITE_SURFACE_POLICY.md`).
- Canonical team context (workspace, roles, queue state, sync health) exists only here.

### Reasons no
- Some governance gaps remain for production-authoritative Copilot:
  - Transitional auth fallback exists when `LCC_API_KEY` is unset (`api/_shared/auth.js`).
  - UI includes fallback direct write paths when mutation bridge unavailable (`app.js` apply fallback logic).
  - Contacts send-message handlers exist but are not wired in route switch (`api/contacts.js` has `sendTeamsMessage/sendWebexMessage/sendSmsMessage` functions not exposed by actions).
  - Monolithic frontend (`app.js`, `gov.js`, `dialysis.js`) increases regression risk for central Copilot actioning.

### Recommended boundary if yes
LCC should be:
- Copilot entry point
- Cross-repo router
- Human review/approval surface
- Daily operations hub

LCC should not become:
- The domain business-rule authority for GovernmentProject or DialysisProject
- The place where domain-specific write semantics are duplicated

Domain repos should keep:
- Domain transformation logic
- Domain-specific write services and validation
- Domain canonical schema ownership

## 5. Candidate Copilot Actions From This Repo

| action_name | user_goal | category | source module/file/function/endpoint | current implementation status | recommended Microsoft surface | required inputs | expected outputs | safe for autonomous execution? | recommended confirmation level |
|---|---|---|---|---|---|---|---|---|---|
| copilot_chat_response | Ask portfolio/workflow questions | read/query | `api/bridge.js` `handleChatRoute`; `api/_shared/ai.js` `invokeChatProvider`; `POST /api/chat` | Implemented | Copilot Chat | message, optional context/history/attachments | answer text + usage/provider | yes (read-only) | none |
| queue_work_counts | Get current workload metrics | read/query | `api/queue.js` `v2GetWorkCounts`; `GET /api/queue-v2?view=work_counts` | Implemented | Copilot Chat, Teams summary card | workspace/user context | counts (my/team/inbox/research/sync) | yes | none |
| list_my_work | Show my open tasks | read/query | `api/queue.js` `v2GetMyWork`; `GET /api/queue-v2?view=my_work` | Implemented | Copilot Chat, Planner/To Do sync candidate | filters/status/domain/page | action list + pagination | yes | none |
| list_team_queue | Show team queue and unassigned items | read/query | `api/queue.js` + `api/workflows.js?action=unassigned` | Implemented | Teams, Copilot Chat | domain/status/assignee filters | prioritized team queue | yes | none |
| triage_inbox_item | Move inbox item to triaged/dismissed | review/resolve | `api/queue.js` `PATCH /api/inbox?id=` | Implemented | Copilot Chat, Teams approval card | inbox id, target status | updated inbox item | conditional | lightweight confirm |
| promote_inbox_to_action | Convert triaged item to actionable work | orchestrate | `api/workflows.js?action=promote_to_shared` (preferred), also `api/queue.js` promote path | Implemented | Copilot Chat, Teams | inbox_item_id (+ optional assignee/priority) | new action + inbox promoted | conditional | explicit confirm |
| complete_action | Mark action complete/reopen | review/resolve | `api/actions.js` `PATCH /api/actions?id=` | Implemented | Copilot Chat, Planner/To Do | action id, status transition | updated action + activity log | conditional | explicit confirm |
| reassign_work_item | Reassign action/inbox/research | schedule/task | `api/workflows.js?action=reassign` | Implemented | Teams, Copilot Chat | item_type, item_id, assigned_to, reason | reassigned item + assignment activity | conditional | explicit confirm |
| escalate_action | Escalate to manager | review/resolve | `api/workflows.js?action=escalate` | Implemented | Teams approval/escalation workflow | action_item_id, escalate_to, reason | escalation record + reassignment | no (should require human intent) | high confirm |
| create_followup_from_research | Close research and spawn follow-up task | orchestrate | `api/workflows.js?action=research_followup`; `closeResearchLoop` | Implemented | Copilot Chat, Planner/To Do | research_task_id + outcome + follow-up params | completed research + optional follow-up action | conditional | explicit confirm |
| run_sync_ingest | Trigger email/calendar/SF ingest | orchestrate | `api/sync.js` `POST /api/sync?action=ingest_*` | Implemented | Power Automate trigger, Copilot Chat | ingest action type | sync job id/status/processed/failed | conditional | explicit confirm |
| retry_sync_error | Retry failed sync record | admin/ops | `api/sync.js` `POST /api/sync?action=retry&error_id=` | Implemented | Copilot Chat, Teams ops channel | error_id | retry result/job update | conditional | explicit confirm |
| sync_health_snapshot | View connector and failure posture | admin/ops | `api/sync.js` `GET /api/sync?action=health` | Implemented | Teams ops digest, Copilot Chat | workspace | health summary, queue drift, error posture | yes | none |
| connector_verify | Verify connector setup | admin/ops | `api/sync.js` `POST /api/sync?action=verify_connector` | Implemented | Copilot Chat, Teams ops | connector_id | verification status/details | conditional | lightweight confirm |
| connector_admin | List/create/update/delete connector accounts | admin/ops | `api/sync.js` `_route=connectors` | Implemented | Copilot Chat, Power Automate admin | connector fields/user/workspace | connector records | conditional | explicit confirm for create/update; high for delete |
| entity_search_and_quality | Find entities and data quality issues | read/query | `api/entities.js` actions `search`, `quality`, `quality_details`, `duplicates` | Implemented | Copilot Chat, Excel export candidate | query/entity filters | entities + quality diagnostics | yes | none |
| entity_merge | Merge duplicate entities | review/resolve | `api/entities.js?action=merge` | Implemented | Copilot Chat with approval step | target_id, source_id | merged entity graph + source deletion | no | high confirm |
| link_external_identity | Link source-system record to canonical entity | orchestrate | `api/entities.js?action=link`; `api/bridge.js?action=update_entity` | Implemented | Copilot Chat | entity_id + source identity fields | linked identity/update result | conditional | explicit confirm |
| apply_domain_change_audited | Apply gov/dia write with audit trail | ingest/submit | `api/apply-change.js` `POST /api/apply-change` | Implemented | Copilot Chat + Approval, Power Automate | target_source/table/id/mutation/fields/notes | rows affected + audit/pending review linkage | no for high-impact fields; conditional for low-risk | high confirm |
| gov_write_service_action | Execute Government write-service operation | orchestrate | `api/data-proxy.js` `_route=gov-write` (`ownership`, `lead-research`, `financial`, `resolve-pending`) | Implemented | Copilot Chat + Approval, Teams | endpoint + payload | gov service result | no (write side effects) | high confirm |
| gov_evidence_review_action | Create/apply/promote evidence artifacts/observations | review/resolve | `api/data-proxy.js` `_route=gov-evidence`; UI in `gov.js` | Implemented | Teams approval + Copilot Chat | endpoint ids/payload/actor | artifact/observation state updates | no | high confirm |
| live_ingest_normalize | Normalize uploaded docs/emails/pdfs for extraction | read/query | `api/sync.js` `_route=live-ingest` `action=normalize` | Implemented | Copilot Chat, Power Automate preprocessing | documents array | normalized documents | yes | none |
| live_ingest_apply_selected_ops | Apply selected OCR/AI-proposed operations | review/resolve | `app.js` `applyLiveIngestProposal` + `applyChangeWithFallback`/`canonicalBridge` | Implemented (UI orchestration) | Copilot Chat + Human review UI | approved operations list + acknowledgements | applied updates + provenance logging | conditional, with strong gating | high confirm |
| update_feature_flag | Toggle feature rollout controls | admin/ops | `api/admin.js` `/api/flags` POST | Implemented | Copilot Chat (admins), Teams ops | flag, boolean value | updated flag state | conditional | explicit confirm |
| workspace_membership_admin | Add/remove/change members/roles | admin/ops | `api/admin.js` `/api/members` | Implemented | Teams admin workflow, Copilot Chat | workspace/user/role operation | membership update | no for role/removal | high confirm |
| contact_hub_maintenance | Ingest/merge/classify contacts and run dedupe | ingest/submit | `api/contacts.js` actions `ingest`, `ingest_calendar_contacts`, `detect_duplicates`, `merge`, `classify`, `dismiss_merge` | Implemented | Copilot Chat, Outlook/Teams follow-up | contact ids/fields/action params | contact updates + merge queue state | conditional | explicit confirm for merge/classify |

## 6. Recommended Cross-Repo Routing Responsibilities

| capability | should live in LCC? | should call GovernmentProject? | should call DialysisProject? | notes |
|---|---|---|---|---|
| Copilot conversational entry + context assembly | yes | no | no | Already in `app.js` + `/api/chat`. |
| Canonical queue/task/inbox/research orchestration | yes | no | no | Core ops model is in LCC schema/API. |
| Entity linkage across domains | yes | indirect | indirect | Keep canonical identity map in LCC; resolve via source ids. |
| Government domain reads | no (as source of truth) | yes | no | LCC proxies via `/api/gov-query`; gov repo remains authoritative schema/business logic. |
| Dialysis domain reads | no (as source of truth) | no | yes | LCC proxies via `/api/dia-query`; dia repo remains authoritative schema/business logic. |
| Government closed-loop writes | no (rule engine) | yes | no | Use `/api/gov-write` and `/api/gov-evidence` bridge endpoints. |
| Dialysis domain write logic | no (rule engine) | no | yes | LCC can trigger, but domain semantics should stay in DialysisProject services/pipelines. |
| Connector orchestration and sync job tracking | yes | optional | optional | LCC owns connector/job/error model; domain repos can expose ingest sources. |
| Human review and approvals for risky changes | yes | no | no | LCC should host review UX and approval policy before invoking domain writes. |
| Cross-repo audit and provenance rollup | yes | yes (emit source metadata) | yes (emit source metadata) | LCC `pending_updates`/`data_corrections` should aggregate outcomes. |

## 7. Existing Authentication / Secrets / Environment Constraints Relevant to Copilot
- Auth modes are mixed/transitional (`api/_shared/auth.js`):
  - Supabase JWT bearer auth.
  - `X-LCC-Key` API key mode.
  - Transitional fallback user when `LCC_API_KEY` is not set.
- Role model enforced in handlers: `owner > manager > operator > viewer`.
- Core required environment variables (from `.env.example` and code):
  - Ops: `OPS_SUPABASE_URL`, `OPS_SUPABASE_KEY`
  - Gov: `GOV_SUPABASE_URL`, `GOV_SUPABASE_KEY`, `GOV_API_URL`
  - Dia: `DIA_SUPABASE_URL`, `DIA_SUPABASE_KEY`
  - AI: `AI_CHAT_PROVIDER`, `AI_CHAT_POLICY`, `OPENAI_API_KEY`, `AI_API_BASE_URL`, `EDGE_FUNCTION_URL`
  - Sync/webhooks: `PA_WEBHOOK_SECRET`, `PA_COMPLETE_TASK_URL`
  - Diagnostics: `DIAG_SECRET`
  - Messaging tokens: `MS_GRAPH_TOKEN`, `WEBEX_ACCESS_TOKEN` (+ refresh credentials)
- Copilot implication:
  - For production-authoritative Copilot execution, transitional no-key auth should be retired.
  - Write actions should require workspace role checks plus explicit confirmation in the Copilot layer.

## 8. Existing Data Contracts / Payload Contracts Relevant to Copilot

### Canonical ops contracts (LCC-owned)
- Work items and lifecycle:
  - `inbox_items` (new -> triaged -> promoted/dismissed/archived)
  - `action_items` (open/in_progress/waiting/completed/cancelled)
  - `research_tasks` (queued/in_progress/completed/skipped)
- Activity/audit:
  - `activity_events` append-only timeline events
  - `sync_jobs`, `sync_errors`, `connector_accounts`
  - `pending_updates`, `data_corrections` (loop closure)
- Entity graph:
  - `entities`, `external_identities`, `entity_aliases`, `entity_relationships`
- Workspace/policy:
  - `workspaces`, `users`, `workspace_memberships`, feature flags config

### Proxy/write payload patterns already implemented
- `POST /api/apply-change`:
  - keys include `target_source`, `target_table`, `mutation_mode`, `record_identifier`, `id_column`, `changed_fields`, optional reconciliation/propagation metadata.
- `POST /api/workflows?action=*`:
  - strongly action-specific payloads (promotion/reassign/escalate/research closure).
- `POST /api/sync?action=*`:
  - ingest/outbound/retry/connector verification controls.
- `POST /api/bridge?action=*`:
  - bridge payloads for activity, research closure, entity updates.

### Domain contracts bridged through LCC
- Government:
  - write service endpoint map (`ownership`, `lead-research`, `financial`, `resolve-pending`).
  - evidence endpoint map (`research-artifacts`, apply/promo/review actions).
- Dialysis:
  - marketing lead ingest/backfill, SF activity creation, CRM rollup refresh via DIA Supabase REST paths.

## 9. Best Near-Term Copilot Integrations for This Repo
1. Copilot Chat -> Queue and workflow actions (read first, then guided writes)
- Start with `work_counts`, `my_work`, `inbox`, `research`, `sync_health` queries.
- Add confirmations for `promote_to_shared`, `reassign`, `research_followup`, `retry`.

2. Teams operational copilot cards
- Team queue snapshots, unassigned work, open escalations, sync failures.
- One-click (confirmed) actions for assign/escalate/retry.

3. Outlook + Power Automate ingestion-to-triage loop
- Use existing sync endpoints (`ingest_emails`, `ingest_calendar`, `ingest_sf_activities`) as callable Copilot actions.

4. High-trust write orchestration path
- Standardize Copilot write actions through `/api/apply-change` and gov write/evidence services.
- Keep direct proxy writes out of Copilot action plans except approved fallback policies.

5. Research and live-ingest review assistant
- Copilot drafts follow-up from research and proposes live-ingest operations, but always with acknowledgement/approval before apply.

## 10. Repo-Specific Risks, Conflicts, or Duplications to Avoid
- Auth hardening gap:
  - Transitional fallback auth can permit broader access than intended if keys are missing.
- Write-path duplication risk:
  - Multiple mutation paths exist (apply-change, data-proxy writes, gov-write service, UI fallback direct writes).
- Contacts messaging wiring mismatch:
  - UI posts `send_teams/send_webex/send_sms` but main contacts action switch does not route these actions.
- Monolithic frontend coupling:
  - `app.js`, `gov.js`, `dialysis.js`, `detail.js` contain overlapping orchestration logic and direct endpoint calls.
- Action contract drift:
  - Some UI posts in `detail.js` use action types not aligned with lifecycle enums in `api/_shared/lifecycle.js`.
- Cross-repo ownership ambiguity:
  - Avoid re-implementing gov/dia domain write semantics in LCC when dedicated backend services already exist.

## 11. Recommended Wave 1 / Wave 2 / Wave 3 Opportunities For This Repo

### Wave 1 (stabilize and ship)
- Make LCC the explicit Copilot entry and routing layer for read + low-risk workflow actions.
- Enforce confirmation policy tiers for write/escalation/merge actions.
- Remove/lock transitional auth in production profile.
- Fix contacts send-action routing mismatch.
- Document and centralize action contract definitions for Copilot tooling.

### Wave 2 (scale controlled execution)
- Expand Copilot actions into connector operations, research closure automation, and domain evidence review workflows.
- Add consistent policy engine for autonomous eligibility by action type and data sensitivity.
- Add richer audit linkage from Copilot intent -> executed endpoint -> data_corrections/pending_updates row IDs.

### Wave 3 (authoritative orchestration maturity)
- Make LCC the authoritative cross-repo action broker with strict adapters for GovernmentProject and DialysisProject.
- Add reusable Teams/Outlook/Planner surfaces mapped to the same LCC action contracts.
- Introduce explicit route-level idempotency/approval tokens for high-impact operations.

## 12. Appendix: Key files and why they matter
- `api/bridge.js`: Copilot chat route + domain-to-canonical bridge actions.
- `api/_shared/ai.js`: provider/policy routing (`edge/openai/ollama`), feature-based model routing.
- `api/queue.js`: queue/inbox read model and v2 operational endpoints.
- `api/workflows.js`: canonical orchestration primitives (promote/reassign/escalate/research follow-up).
- `api/actions.js`: action lifecycle + activity logging.
- `api/sync.js`: connectors, ingest jobs, outbound/retry/health, DIA ingest/backfill pipelines.
- `api/data-proxy.js`: gov/dia proxy plus gov-write and gov-evidence routing boundary.
- `api/apply-change.js`: audited mutation contract and loop-closure integration.
- `api/entities.js`: canonical entity/identity merge and data quality entry points.
- `api/admin.js`: workspace/member/flag controls (operational governance).
- `api/contacts.js`: unified contact hub, dedupe/classification, message-read integrations.
- `app.js`: Copilot UI entrypoint, context builder, live-ingest apply orchestration.
- `ops.js`: day-to-day human review and queue operations UI.
- `gov.js`: government-specific orchestration including write/evidence service clients.
- `detail.js`: cross-domain detail actions that currently also trigger workflow/write operations.
- `schema/README.md` and `schema/*.sql`: canonical ops contract and table/view definitions.
- `schema/018_loop_closure.sql`: pending review + audit tables central to safe Copilot write execution.
- `WRITE_SURFACE_POLICY.md`: explicit mutation governance policy for safe orchestration.
