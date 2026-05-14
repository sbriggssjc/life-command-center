# Power Automate Flow Audit Registry (LCC + Salesforce + Microsoft 365)

Last updated: 2026-05-12
Owner: LCC Control Plane
Scope: Power Automate flows that integrate Outlook, Teams, Salesforce, and LCC/domain endpoints.

## Purpose
This file is the authoritative portfolio registry for flow architecture, risk posture, dependencies, and remediation status. Detailed behavior lives in per-flow sheets under `docs/architecture/flows/`.

## Current Environment
- Power Automate portal URL: `https://make.powerautomate.com/`
- Tenant / org name: `NorthMarq Capital, LLC` (Microsoft 365 tenant)
- Default environment ID (production): `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f`
- Default environment URL prefix: `https://make.powerautomate.com/environments/Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f/`
- Active user: `sbriggssjc@gmail.com` (signed in as Scott Briggs in tenant)
- Non-prod environment for clone-first repair: `TBD — no dedicated non-prod environment yet; current "clone" strategy = save-as a Copy of the flow into the same Default environment with name suffix \`-NONPROD\` and trigger temporarily replaced with manual Button trigger to prevent live executions during repair.`
- Environment captured: 2026-05-13

## Current Flow Inventory
| Flow Name | Export Artifact | Trigger | Primary Purpose | Detail Doc | Status |
|---|---|---|---|---|---|
| LCC Flagged Email Intake | `LCCFlaggedEmailIntake_20260511211601.zip` | `When_an_email_is_flagged_(V3)` | Ingest flagged Outlook emails + attachments into LCC intake pipeline. **Hardened 2026-05-13** with Terminate (Succeeded) at end of True branch with permissive Run after so the post-intake Outlook cleanup (Flag/Mark/Move) no longer fails the run on 404 NotFound. Flow ID `44227dbb-3c8b-46b2-9a6a-6c46130a6beb`. | `flows/lcc-flagged-email-intake.md` + `FLOW_CHANGES_LOG.md` Task #4 | Active (hardened) |
| HTTP-Switch | `HTTP-Switch_20260511211836.zip` | HTTP Request (`manual`) | Route request by `operation` to Salesforce Account/Contact lookup branches. **SOQL injection fixed 2026-05-13** (Task #6) — added `EscapeAccountName` / `EscapeContactEmail` Compose actions that escape `'` → `\'` before the SOQL queries; both `SoqlAccount` and `SoqlContact` now reference the escaped value. Flow ID `c3744e93-5e95-4b6f-a839-d4308389d21f`. | `flows/http-switch-salesforce-lookup.md` + `FLOW_CHANGES_LOG.md` Task #6 | Active (SOQL-hardened) |
| LCCSFFlow1 | `LCCSFFlow1_20260511211808.zip` | `Recurrence` (every 1 minute) | Poll `sf_sync_queue` and process `find/link` tasks against Salesforce + Supabase | `flows/lcc-sf-flow1-queue-worker.md` | Active |
| LCC Outlook Intake | `LCCOutlookIntake_20260511212049.zip` | `When_an_email_is_flagged_(V3)` | Post flagged-email intake payload to LCC Outlook intake endpoint | `flows/lcc-outlook-intake.md` | Active |
| HTTP Init LLC | `http-initLLC_20260511212018.zip` | HTTP Request (`manual`) | End-to-end OM staging workflow: prepare upload -> PUT -> stage -> extract. **Recovered 2026-05-13** with Condition-after-stage-response soft-skip guard; auto-disabled 2026-05-08 → 2026-05-13. Flow ID `ab11601a-b7d7-4efa-8f3a-52873e873270`. | `flows/http-init-llc.md` + `flows/http-init-llc-repair-runbook.md` | Active (recovered) |
| Manual ForEach Post | `manual-foreachpost_20260511211947.zip` | HTTP Request (`manual`) | Iterate attachments and post Teams card/message per item | `flows/manual-foreachpost-teams.md` | Active |
| LoopNet Power Automate | `LoopNetPowerAutomate_20260511214000.zip` | `When_a_new_email_arrives_(V3)` | Ingest LoopNet emails to LCC LoopNet ingest endpoint | `flows/loopnet-power-automate.md` | Active |
| RCM Power Automate | `RCMPowerAutomate_20260511214031.zip` | `When_a_new_email_arrives_(V3)` | Ingest RCM emails to LCC RCM ingest endpoint | `flows/rcm-power-automate.md` | Active |
| LCC Morning Briefing | `LCCMorningBriefing_20260511215210.zip` | `Recurrence` (weekly weekend) | Pull briefing email payload from LCC and send via Office 365 email | `flows/lcc-morning-briefing.md` | Active |
| HTTP-ParseJSON | `HTTP-ParseJSON_20260511215138.zip` | HTTP Request (`manual`) | Parse input JSON, call LCC property lookup, and send email output | `flows/http-parsejson-property-email.md` | Active |
| LCC Daily Briefing | `LCCDailyBriefing_20260511215104.zip` | `Recurrence` (weekday) | Pull daily snapshot from LCC and post to Teams channel | `flows/lcc-daily-briefing.md` | Active |
| ToDo-LCCSync | `ToDo-LCCSync_20260511215037.zip` | `Recurrence` (hourly) | Aggregate multiple To Do folders and update OneDrive sync artifact. **Recovered 2026-05-13** by stripping legacy `?['value']` accessor from Apply_to_each_2's foreach expression (Microsoft To-Do connector contract drift). Flow ID `fee2a0fe-21fa-4e28-b230-f83189d4b20b`. 8 other Apply to each loops have the same latent bug — surgical fix only addresses the one that hit runtime. | `flows/todo-lcc-sync.md` + `FLOW_CHANGES_LOG.md` Task #3 | Active (recovered) |
| OutlookCalendar-LifeCommandCenterSync | `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip` | `Recurrence` (hourly) | Merge multi-calendar events and sync consolidated payload to Supabase edge endpoint | `flows/outlookcalendar-lcc-sync.md` | Active |
| LCC-PersonalCalendarSync | `LCC-PersonalCalendarSync_20260512134721.zip` | `Recurrence` (hourly) | Pull personal calendar events and sync to Supabase edge endpoint | `flows/lcc-personal-calendar-sync.md` | Active |
| SyncSFTaskstoSupabase | `SyncSFTaskstoSupabase_20260512134655.zip` | `Recurrence` (every 6 hours) | Query Salesforce tasks and push to Supabase sync endpoint | `flows/sync-sf-tasks-to-supabase.md` | Active |
| SyncSFActivitiestoSupabase | `SyncSFActivitiestoSupabase_20260512134632.zip` | `Recurrence` (every 4 hours) | Query Salesforce activities and push normalized payload to Supabase sync endpoint | `flows/sync-sf-activities-to-supabase.md` | Active |
| CompleteSFTask | `CompleteSFTask_20260512134535.zip` | HTTP Request (`manual`) | Find open Salesforce Tasks and conditionally complete/update by action. **FIXED 2026-05-13** (Task #6 Part B.1): OData injection closed via `EscapeSubject` Compose + rewired Filter Query; Condition made null-safe and corrected from the always-null `?['records']` key to `?['value']`. 0 runs/28d. Flow ID `06b7b1dc-f917-4970-b075-7dd7fcef56c1`. Residual: Switch-case branch audit for `['records']` key bug (see changes log). | `flows/complete-sf-task.md` + `FLOW_CHANGES_LOG.md` Task #6 Part B.1 | Active (injection + null-handling FIXED) |
| GovLeaseLeadSync | `GovLeaseLeadSync_20260512134512.zip` | HTTP Request (`manual`) | Upsert Salesforce Lead records based on incoming agency payload. **FIXED 2026-05-13** (Task #6 Part B.2): OData injection closed via `EscapeAgency` Compose + rewired Filter Query `Company eq '@{outputs('EscapeAgency')}'`; Condition made null-safe with coalesce. 0 runs/28d. Flow ID `227bd734-6f65-4b33-9d2c-1ab19e2ff7e9`. | `flows/govlease-lead-sync.md` + `FLOW_CHANGES_LOG.md` Task #6 Part B.2 | Active (injection + null-handling FIXED) |
| HTTP-Postmessagechat | `HTTP-Postmessagechat_20260512134401.zip` | HTTP Request (`manual`) | Post arbitrary request body as Teams chat/channel message | `flows/http-postmessagechat.md` | Active |
| HTTP-Postmessagechat2 | `HTTP-Postmessagechat2_20260512134447.zip` | HTTP Request (`manual`) | Format and post GovLease intake ops alert message to Teams | `flows/http-postmessagechat2.md` | Active |
| Flagged Email to To Do Task | `FlaggedEmailtoToDoTask_20260512135651.zip` | `When_an_email_is_flagged_(V3)` | Create To Do task from flagged work email (lean payload variant). **DEPRECATED 2026-05-13** (Task #5) — turned Off as duplicate of `Flagged Email to To Do`. Flow ID `2116af42-659e-416b-bce6-1d74e8daa480`. | `flows/flagged-email-to-todo-task.md` + `FLOW_CHANGES_LOG.md` Task #5 | Off (deprecated 2026-05-13) |
| Flagged Email to To Do | `FlaggedEmailtoToDo_20260512135754.zip` | `When_an_email_is_flagged_(V3)` | Create To Do task from flagged work email with due/status/importance fields. **Canonical** business flow (post-2026-05-13 consolidation). Flow ID `9071662c-ec79-49d2-82c1-03d8ba4302a6`. | `flows/flagged-email-to-todo.md` + `FLOW_CHANGES_LOG.md` Task #5 | Active (canonical) |
| Flagged Personal Email to To Do | `FlaggedPersonalEmailtoToDo_20260512135719.zip` | `When_an_email_is_flagged_(V2)` | Create To Do tasks from personal mailbox flagged emails | `flows/flagged-personal-email-to-todo.md` | Active |
| Button -> Send an HTTP request | `Button-SendanHTTPrequest_20260512135816.zip` | Request (`Button`) | Send manual HTTP request to Azure cognitive endpoint | `flows/button-send-http-request.md` | Active |
| Log Activity to SF from LCC | `LogActivitytoSFfromLCC_20260512135623.zip` | HTTP Request (`manual`) | Create Salesforce Task activity record from LCC-triggered payload. **PARTIALLY HARDENED 2026-05-13** (Task #6 Part B.3): trigger Request Body JSON Schema added (6 typed contract fields incl. `schema_version`) — fixed the "Invalid parameters" broken-action state on `Create record` and established the documented contract. Residual governance (documented, deferred): strict `required` enforcement, `X-LCC-Key` request-auth Condition, audit/correlation Compose. 0 runs/28d. Flow ID `6700bdfc-3bbd-4c85-a85c-e9660042aab1`. | `flows/log-activity-to-sf-from-lcc.md` + `FLOW_CHANGES_LOG.md` Task #6 Part B.3 | Active (schema fixed; auth hardening outstanding) |
| Sync Flagged Emails to Supabase (Graph Pull Variant) | `SyncFlaggedEmailstoSupabase_20260512135251.zip` | `Recurrence` (daily) | Pull inbox emails via Office connector (GetEmailsV3) for flagged-email sync pipeline | `flows/sync-flagged-emails-to-supabase.md` | Active (canonical pull variant) |
| Sync Flagged Emails to Supabase (Supabase Push Variant) | `SyncFlaggedEmailstoSupabase_20260512135136.zip` | `Recurrence` (daily) | Push flagged-email sync payload to Supabase edge flagged-email endpoint | `flows/sync-flagged-emails-to-supabase.md` | Active (P0: plaintext apikey in export) |

## Dependency Map
| Domain | Dependency | Notes |
|---|---|---|
| LCC API | `/api/intake?_route=outlook-message` | Called by flagged email intake flow. |
| LCC API | `/api/intake-outlook-message` | Called by LCCOutlookIntake flow. |
| LCC API | `/api/intake/prepare-upload` | Used to prepare attachment upload target. |
| LCC API | `/api/stage-om`, `/api/intake-extract` | Used in HTTP Init LLC orchestration flow. |
| LCC API | `/api/loopnet-ingest`, `/api/rcm-ingest` | Used by LoopNet/RCM email ingestion flows. |
| LCC API | `/api/briefing-email`, `/api/daily-briefing?action=snapshot&role_view=broker` | Used by scheduled briefing flows. |
| LCC API | `/api/property?address=...` | Used by HTTP-ParseJSON flow. |
| Supabase Edge | `/functions/v1/ai-copilot/sync/calendar-events` | Used by calendar sync flows. |
| Supabase Edge | `/functions/v1/ai-copilot/sync/sf-tasks`, `/functions/v1/ai-copilot/sync/activities` | Used by Salesforce-to-Supabase sync flows. |
| Supabase Edge | `/functions/v1/ai-copilot/sync/flagged-emails` | Used by flagged-email sync push variant. |
| Salesforce | `shared_salesforce` connector | Used in HTTP-Switch and LCCSFFlow1. |
| Office 365 | `shared_office365` connector | Used in flagged email trigger path. |
| Outlook.com (Personal) | `shared_outlook` connector | Used by personal flagged-email -> ToDo flow. |
| ToDo Consumer | `shared_todoconsumer` connector | Used by personal flagged-email -> ToDo flow. |
| Teams | `shared_teams` connector | Used in manual attachment foreach posting flow. |
| Conversion Service | `shared_conversionservice` connector | Used in LoopNet/RCM html-to-text conversion flows. |
| Microsoft To Do | `shared_todo` connector | Used by ToDo-LCCSync for multi-folder task pulls. |
| Microsoft To Do (Personal) | `shared_todoconsumer` connector | Used by personal mailbox flagged-email task sync flow. |
| OneDrive for Business | `shared_onedriveforbusiness_1` connector | Used by ToDo-LCCSync for sync-file read/update. |
| Outlook Calendar | `shared_outlook` connector | Used by personal and business calendar sync recurrence flows. |
| Outlook.com | `shared_outlook` connector | Used by personal/calendar sync flows (calendar reads). |
| Supabase (LCC Opps) | `sf_sync_queue` table | Source queue for LCCSFFlow1. |
| Supabase (Domain DB) | `contacts`, `true_owners` tables | Updated by `link_*` branches in LCCSFFlow1. |
| Salesforce Objects | `Task`, `Activity` (and related objects) | Queried and forwarded by Salesforce sync flows. |
| Microsoft To Do + Outlook Flags | `ListToDosByFolderV2`, `Flag_email_(V2)` | Used by unflag/recovery flows to synchronize task completion with email flag state. |
| Salesforce Objects | `Task`, `Lead` | Queried/updated by CompleteSFTask and GovLeaseLeadSync flows. |
| Microsoft To Do + Outlook Flags | `ListToDosByFolderV2`, `Flag_email_(V2)` | Used by unflag/recovery flows to synchronize task completion with email flag state. |
| Microsoft To Do Create | `CreateToDoV3`, `CreateToDo` | Used by flagged-email-to-ToDo flows (work + personal variants). |
| Salesforce Task Create | `PostItem_V2` on `Task` | Used by LogActivitytoSFfromLCC manual activity logger. |
| Azure Cognitive Endpoint | `propertyaiextractor.cognitiveservices.azure.com` | Used by manual button flow with subscription key header. |

## Initial Gap Matrix
| Priority | Category | Gap | Required Action | Owner | Status |
|---|---|---|---|---|---|
| P0 | Security | Exported definitions include embedded bearer/service-role credentials in flow actions. | Rotate exposed keys immediately, move secrets to secure references, re-export and verify redaction. | Platform + Flow Owners | Open |
| P1 | Reliability | 1-minute recurrence polling lacks documented per-kind idempotency/retry/dead-letter policy. | Add explicit retry ceilings, dead-letter routing, and idempotency checks per `kind`. | Flow Owner | Open |
| P1 | Contract Governance | No explicit shared schema version + strict validation branch across request/queue payloads. | Introduce `schema_version`, enforce validation branch, fail closed for unknown contracts. | LCC + Flow Owner | Open |
| P2 | Observability | Incomplete standardized telemetry mapping across flow run -> queue row -> endpoint response -> final state. | Add correlation logging fields and runbook queries for traceability. | LCC + Flow Owner | Open |
| P2 | Portfolio Hygiene | Overlapping intake patterns exist across multiple flagged/new-email flows and endpoints. | Consolidate or formally version parallel flow patterns to reduce drift. | LCC + Flow Owners | Open |
| P1 | Duplicate Variant Drift | Duplicate flow exports/names for `Sync Flagged Emails to Supabase` and overlapping flagged-email->ToDo flows increase divergence risk. | Select canonical flow per domain, deprecate duplicates, and enforce one-owner-per-pattern. | LCC + Flow Owners | Open |
| P2 | Scheduling Governance | Multiple recurrence flows run on differing weekly/hourly cadences without unified schedule register. | Create centralized cadence registry and owner-runbook per scheduled flow. | LCC + Flow Owners | Open |
| P0 | Security | Plaintext Supabase `Authorization`/`apikey` material detected in exported definitions for Salesforce sync-to-Supabase flows (`SyncSFTaskstoSupabase`, `SyncSFActivitiestoSupabase`). | Rotate exposed keys immediately, move to secure references, re-export and verify credential-free definitions. | Platform + Flow Owners | Open |
| P0 | Security | Plaintext Supabase `Authorization`/`apikey` material detected in flagged-email sync push variant (`SyncFlaggedEmailstoSupabase_20260512135136.zip`). | Rotate exposed keys immediately, move to secure references, re-export and verify credential-free definitions. | Platform + Flow Owners | Open |
| P1 | Write Governance | Manual HTTP-triggered Salesforce update/upsert flows can mutate CRM directly without explicit orchestration-tier approval semantics. | Add explicit request auth, action allowlist, and audit/correlation requirements for manual mutation flows. | LCC + Flow Owners | Open |
| P0 | Production Stability | Platform reported repeated failures across 6 flows and auto-disabled `HTTP Init LLC` after 14 days of continuous failure. | Run incident remediation wave: recover disabled flow, fix top failure-volume flows, and gate all high-risk actions with deterministic error handling. | Flow Owners + LCC Platform | Open |

## Incident Snapshot (From Power Automate Alerts)
Date reviewed: 2026-05-12  
Source emails:
- `C:\Users\scott\Downloads\6 of your flow(s) have failed.eml` (dated 2026-05-06)
- `C:\Users\scott\Downloads\Alert! We've disabled one of your flows.eml` (dated 2026-05-08)

Confirmed failures in prior-week alert (status updated as flows are repaired):
| Flow | Failure Count | Flow ID | Priority | Repair Status |
|---|---:|---|---|---|
| To Do - Life Command Center Sync | 95 | `fee2a0fe-21fa-4e28-b230-f83189d4b20b` | P0 | **Recovered 2026-05-13** (Task #3) |
| LCC Flagged Email Intake | 31 | `44227dbb-3c8b-46b2-9a6a-6c46130a6beb` | P0 | **Hardened 2026-05-13** (Task #4) |
| Flagged Email to To Do Task | 20 | `2116af42-659e-416b-bce6-1d74e8daa480` | P1 | **Deprecated 2026-05-13** (Task #5; duplicate of canonical) |
| Flagged Email to To Do | 16 | `9071662c-ec79-49d2-82c1-03d8ba4302a6` | P1 | **Healthy 2026-05-13** (Task #5; canonical chosen; failures self-resolved) |
| HTTP -> Switch... | 4 | `c3744e93-5e95-4b6f-a839-d4308389d21f` | **P0** | **FIXED + validated 2026-05-13** — SOQL injection closed in both SoqlAccount + SoqlContact via escape-Compose actions; live test with apostrophe+`$` payload returned HTTP 200. SF mutation governance still pending. See `FLOW_CHANGES_LOG.md` Task #6. |
| LCC Morning Briefing Email | 2 | `6ec55229-302e-492c-b4b9-a4cab92adc6d` | P2 | Pending |

Confirmed disabled flow alert:
- Flow name: `Http -> Init LccApiKey, Call prepare-upload, Parse prepare response, ...`
- Flow ID: `ab11601a-b7d7-4efa-8f3a-52873e873270`
- Disabled timestamp (email): `2026-05-08 05:01:12` (UTC email notice context)
- Immediate action: recover in non-prod clone, validate end-to-end upload path, then re-enable only after guarded retries and explicit fault branches are in place.

## Remediation Waves (Execution Order)
1. Wave 0 (P0 within 24 hours):
   - Rotate any exposed Supabase keys and invalidate prior tokens.
   - Recover/rebuild disabled `HTTP Init LLC` with explicit timeout, retry, and terminal-failure notification.
   - Stabilize `To Do - LCC Sync` and `LCC Flagged Email Intake` with idempotency keys and duplicate suppression.
2. Wave 1 (P1 in 2-5 days):
   - Consolidate duplicate flagged-email-to-ToDo patterns into one canonical flow + one recovery companion.
   - Add strict request contract validation on HTTP-triggered flows (`HTTP-Switch`, Salesforce mutation endpoints).
   - Add dead-letter queue table (`flow_dead_letter`) in Supabase for failed write intents.
3. Wave 2 (P1/P2 in 1-2 weeks):
   - Implement bidirectional propagation contracts (Supabase <-> Salesforce <-> Microsoft tasks/calendar/email states).
   - Add correlation IDs across every flow action and endpoint call.
4. Wave 3 (continuous learning loop):
   - Add run-outcome scoring in LCC (success latency, retry count, failure class, business impact).
   - Trigger daily/weekly optimization prompts in LCC briefing flows with top corrective recommendations.

## One-by-One Execution Order (This Chat Series)
1. Recover disabled `HTTP Init LLC` in non-prod clone and validate end-to-end upload/stage path.
2. Repair `To Do - Life Command Center Sync` (highest failure count) with idempotency + guarded writes.
3. Repair `LCC Flagged Email Intake` and align with To Do sync contract.
4. Consolidate the 3 flagged-email-to-ToDo variants into canonical business + personal + recovery pattern.
5. Harden `HTTP-Switch` and Salesforce mutation flows (`CompleteSFTask`, `GovLeaseLeadSync`, `Log Activity to SF from LCC`) with strict schema/auth controls.
6. Stabilize calendar sync flows and define business/personal boundary + conflict policy.
7. Lock observability standards across all recurrence/manual flows and close remaining P1/P2 gaps.

## Tail Gap Items (folded from prior duplicate appends)
| Priority | Category | Gap | Required Action | Owner | Status |
|---|---|---|---|---|---|
| P1 | Secret Handling | Manual Azure HTTP button flow uses subscription key header and requires controlled secret storage/rotation governance. | Move secret to managed reference and add rotation audit entry. | Platform + Flow Owner | Open |

> Note: All other "tail" gap rows previously appended after the execution-order block (P0 SyncFlaggedEmailstoSupabase apikey leak, P1 flagged-email-to-ToDo variant overlap) are already represented in the main Gap Matrix above and have been folded out of this section to remove duplication.

## Change-Control Standard
1. Capture current flow snapshot hash and export artifact.
2. Record intent, risk tier, and affected endpoints/tables in `FLOW_CHANGES_LOG.md`.
3. Apply changes in non-prod first.
4. Validate one success-path and one failure-path run.
5. Promote to prod with rollback steps documented.
6. Re-export updated flow and update this registry + per-flow sheet.

## Assumptions
- Power Automate remains the integration runtime.
- LCC remains orchestration/control plane.
- Canonical writes remain human-approved.
- This documentation set is updated every integration-related chat iteration.
