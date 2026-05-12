# Power Automate Flow Audit Registry (LCC + Salesforce + Microsoft 365)

Last updated: 2026-05-12
Owner: LCC Control Plane
Scope: Power Automate flows that integrate Outlook, Teams, Salesforce, and LCC/domain endpoints.

## Purpose
This file is the authoritative portfolio registry for flow architecture, risk posture, dependencies, and remediation status. Detailed behavior lives in per-flow sheets under `docs/architecture/flows/`.

## Current Flow Inventory
| Flow Name | Export Artifact | Trigger | Primary Purpose | Detail Doc | Status |
|---|---|---|---|---|---|
| LCC Flagged Email Intake | `LCCFlaggedEmailIntake_20260511211601.zip` | `When_an_email_is_flagged_(V3)` | Ingest flagged Outlook emails + attachments into LCC intake pipeline | `flows/lcc-flagged-email-intake.md` | Active |
| HTTP-Switch | `HTTP-Switch_20260511211836.zip` | HTTP Request (`manual`) | Route request by `operation` to Salesforce Account/Contact lookup branches | `flows/http-switch-salesforce-lookup.md` | Active |
| LCCSFFlow1 | `LCCSFFlow1_20260511211808.zip` | `Recurrence` (every 1 minute) | Poll `sf_sync_queue` and process `find/link` tasks against Salesforce + Supabase | `flows/lcc-sf-flow1-queue-worker.md` | Active |
| LCC Outlook Intake | `LCCOutlookIntake_20260511212049.zip` | `When_an_email_is_flagged_(V3)` | Post flagged-email intake payload to LCC Outlook intake endpoint | `flows/lcc-outlook-intake.md` | Active |
| HTTP Init LLC | `http-initLLC_20260511212018.zip` | HTTP Request (`manual`) | End-to-end OM staging workflow: prepare upload -> PUT -> stage -> extract | `flows/http-init-llc.md` | Active |
| Manual ForEach Post | `manual-foreachpost_20260511211947.zip` | HTTP Request (`manual`) | Iterate attachments and post Teams card/message per item | `flows/manual-foreachpost-teams.md` | Active |
| LoopNet Power Automate | `LoopNetPowerAutomate_20260511214000.zip` | `When_a_new_email_arrives_(V3)` | Ingest LoopNet emails to LCC LoopNet ingest endpoint | `flows/loopnet-power-automate.md` | Active |
| RCM Power Automate | `RCMPowerAutomate_20260511214031.zip` | `When_a_new_email_arrives_(V3)` | Ingest RCM emails to LCC RCM ingest endpoint | `flows/rcm-power-automate.md` | Active |
| LCC Morning Briefing | `LCCMorningBriefing_20260511215210.zip` | `Recurrence` (weekly weekend) | Pull briefing email payload from LCC and send via Office 365 email | `flows/lcc-morning-briefing.md` | Active |
| HTTP-ParseJSON | `HTTP-ParseJSON_20260511215138.zip` | HTTP Request (`manual`) | Parse input JSON, call LCC property lookup, and send email output | `flows/http-parsejson-property-email.md` | Active |
| LCC Daily Briefing | `LCCDailyBriefing_20260511215104.zip` | `Recurrence` (weekday) | Pull daily snapshot from LCC and post to Teams channel | `flows/lcc-daily-briefing.md` | Active |
| ToDo-LCCSync | `ToDo-LCCSync_20260511215037.zip` | `Recurrence` (hourly) | Aggregate multiple To Do folders and update OneDrive sync artifact | `flows/todo-lcc-sync.md` | Active |
| OutlookCalendar-LifeCommandCenterSync | `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip` | `Recurrence` (hourly) | Merge multi-calendar events and sync consolidated payload to Supabase edge endpoint | `flows/outlookcalendar-lcc-sync.md` | Active |
| LCC-PersonalCalendarSync | `LCC-PersonalCalendarSync_20260512134721.zip` | `Recurrence` (hourly) | Pull personal calendar events and sync to Supabase edge endpoint | `flows/lcc-personal-calendar-sync.md` | Active |
| SyncSFTaskstoSupabase | `SyncSFTaskstoSupabase_20260512134655.zip` | `Recurrence` (every 6 hours) | Query Salesforce tasks and push to Supabase sync endpoint | `flows/sync-sf-tasks-to-supabase.md` | Active |
| SyncSFActivitiestoSupabase | `SyncSFActivitiestoSupabase_20260512134632.zip` | `Recurrence` (every 4 hours) | Query Salesforce activities and push normalized payload to Supabase sync endpoint | `flows/sync-sf-activities-to-supabase.md` | Active |
| CompleteSFTask | `CompleteSFTask_20260512134535.zip` | HTTP Request (`manual`) | Find open Salesforce Tasks and conditionally complete/update by action | `flows/complete-sf-task.md` | Active |
| GovLeaseLeadSync | `GovLeaseLeadSync_20260512134512.zip` | HTTP Request (`manual`) | Upsert Salesforce Lead records based on incoming agency payload | `flows/govlease-lead-sync.md` | Active |
| HTTP-Postmessagechat | `HTTP-Postmessagechat_20260512134401.zip` | HTTP Request (`manual`) | Post arbitrary request body as Teams chat/channel message | `flows/http-postmessagechat.md` | Active |
| HTTP-Postmessagechat2 | `HTTP-Postmessagechat2_20260512134447.zip` | HTTP Request (`manual`) | Format and post GovLease intake ops alert message to Teams | `flows/http-postmessagechat2.md` | Active |
| SyncFlaggedEmailstoSupabase (Graph Pull Variant) | `SyncFlaggedEmailstoSupabase_20260512135251.zip` | `Recurrence` (daily) | Pull inbox emails via Office connector (GetEmailsV3) for flagged-email sync pipeline | `flows/sync-flagged-emails-to-supabase.md` | Active |
| SyncFlaggedEmailstoSupabase (Supabase Push Variant) | `SyncFlaggedEmailstoSupabase_20260512135136.zip` | `Recurrence` (daily) | Push flagged-email sync payload to Supabase edge flagged-email endpoint | `flows/sync-flagged-emails-to-supabase.md` | Active |
| UnflagCompletedEmailTasks | `UnflagCompletedEmailTasks_20260512135227.zip` | `Recurrence` (every 15 min) | Unflag linked emails when To Do tasks with EmailID markers are completed | `flows/unflag-completed-email-tasks.md` | Active |
| Recovery-ReflagCompletedEmails | `Recovery-ReflagCompletedEmails_20260512135202.zip` | HTTP Request (`manual`) | Recovery flow to re-flag emails based on To Do EmailID markers | `flows/recovery-reflag-completed-emails.md` | Active |
| FlaggedEmailtoToDo | `FlaggedEmailtoToDo_20260512135754.zip` | `When_an_email_is_flagged_(V3)` | Create To Do task from flagged work email with due/status/importance fields | `flows/flagged-email-to-todo.md` | Active |
| FlaggedEmailtoToDoTask | `FlaggedEmailtoToDoTask_20260512135651.zip` | `When_an_email_is_flagged_(V3)` | Create To Do task from flagged work email (lean payload variant) | `flows/flagged-email-to-todo-task.md` | Active |
| FlaggedPersonalEmailtoToDo | `FlaggedPersonalEmailtoToDo_20260512135719.zip` | `When_an_email_is_flagged_(V2)` | Create To Do task from flagged personal email | `flows/flagged-personal-email-to-todo.md` | Active |
| LogActivitytoSFfromLCC | `LogActivitytoSFfromLCC_20260512135623.zip` | HTTP Request (`manual`) | Create Salesforce Task activity record from LCC-triggered payload | `flows/log-activity-to-sf-from-lcc.md` | Active |
| Button-SendanHTTPrequest | `Button-SendanHTTPrequest_20260512135816.zip` | HTTP Request (`manual`) | Send manual HTTP request to Azure cognitive endpoint | `flows/button-send-http-request.md` | Active |

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
| OneDrive for Business | `shared_onedriveforbusiness_1` connector | Used by ToDo-LCCSync for sync-file read/update. |
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
| P2 | Scheduling Governance | Multiple recurrence flows run on differing weekly/hourly cadences without unified schedule register. | Create centralized cadence registry and owner-runbook per scheduled flow. | LCC + Flow Owners | Open |
| P0 | Security | Plaintext Supabase `Authorization`/`apikey` material detected in exported definitions for Salesforce sync-to-Supabase flows (`SyncSFTaskstoSupabase`, `SyncSFActivitiestoSupabase`). | Rotate exposed keys immediately, move to secure references, re-export and verify credential-free definitions. | Platform + Flow Owners | Open |
| P0 | Security | Plaintext Supabase `Authorization`/`apikey` material detected in flagged-email sync push variant (`SyncFlaggedEmailstoSupabase_20260512135136.zip`). | Rotate exposed keys immediately, move to secure references, re-export and verify credential-free definitions. | Platform + Flow Owners | Open |
| P1 | Write Governance | Manual HTTP-triggered Salesforce update/upsert flows can mutate CRM directly without explicit orchestration-tier approval semantics. | Add explicit request auth, action allowlist, and audit/correlation requirements for manual mutation flows. | LCC + Flow Owners | Open |
| P0 | Security | Plaintext Supabase `Authorization`/`apikey` material detected in flagged-email sync push variant (`SyncFlaggedEmailstoSupabase_20260512135136.zip`). | Rotate exposed keys immediately, move to secure references, re-export and verify credential-free definitions. | Platform + Flow Owners | Open |
| P1 | Portfolio Hygiene | Multiple flagged-email-to-ToDo flows exist (`FlaggedEmailtoToDo`, `FlaggedEmailtoToDoTask`) with overlapping triggers but different payload semantics. | Consolidate to one canonical flow or document strict split-purpose and lifecycle ownership. | Flow Owners | Open |
| P1 | Secret Handling | Manual Azure HTTP button flow uses subscription key header and requires controlled secret storage/rotation governance. | Move secret to managed reference and add rotation audit entry. | Platform + Flow Owner | Open |

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
