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
| CompleteSFTask | `CompleteSFTask_20260512134535.zip` | HTTP Request (`manual`) | Find open Salesforce Tasks and conditionally complete/update by action | `flows/complete-sf-task.md` | Active |
| GovLeaseLeadSync | `GovLeaseLeadSync_20260512134512.zip` | HTTP Request (`manual`) | Upsert Salesforce Lead records based on incoming agency payload | `flows/govlease-lead-sync.md` | Active |
| HTTP-Postmessagechat | `HTTP-Postmessagechat_20260512134401.zip` | HTTP Request (`manual`) | Post arbitrary request body as Teams chat/channel message | `flows/http-postmessagechat.md` | Active |
| HTTP-Postmessagechat2 | `HTTP-Postmessagechat2_20260512134447.zip` | HTTP Request (`manual`) | Format and post GovLease intake ops alert message to Teams | `flows/http-postmessagechat2.md` | Active |
| Flagged Email to To Do Task | `FlaggedEmailtoToDoTask_20260512135651.zip` | Outlook flag trigger | Create downstream To Do task from flagged work email | `flows/flagged-email-to-todo-task.md` | Failing |
| Flagged Email to To Do | `FlaggedEmailtoToDo_20260512135754.zip` | Outlook flag trigger | Sync flagged email into To Do tracking path | `flows/flagged-email-to-todo.md` | Failing |
| Flagged Personal Email to To Do | `FlaggedPersonalEmailtoToDo_20260512135719.zip` | Outlook flag trigger (`V2`) | Create To Do tasks from personal mailbox flagged emails | `flows/flagged-personal-email-to-todo.md` | Active |
| Button -> Send an HTTP request | `Button-SendanHTTPrequest_20260512135816.zip` | Request (`Button`) | Manual utility HTTP invocation flow | `flows/button-send-http-request.md` | Active |
| Log Activity to SF from LCC | `LogActivitytoSFfromLCC_20260512135623.zip` | HTTP Request (`manual`) | Write LCC-origin activity payloads into Salesforce | `flows/log-activity-to-sf-from-lcc.md` | Active |
| Outlook Calendar - LCC Sync | `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip` | `Recurrence` | Sync Outlook calendar context into LCC workflows | `flows/outlookcalendar-lcc-sync.md` | Active |
| LCC - Personal Calendar Sync | `LCC-PersonalCalendarSync_20260512134721.zip` | `Recurrence` | Sync personal calendar context into LCC planning | `flows/lcc-personal-calendar-sync.md` | Active |
| Sync SF Tasks to Supabase | `SyncSFTaskstoSupabase_20260512134655.zip` | `Recurrence` | Pull Salesforce tasks into Supabase/LCC data plane | `flows/sync-sf-tasks-to-supabase.md` | Active |
| Sync SF Activities to Supabase | `SyncSFActivitiestoSupabase_20260512134632.zip` | `Recurrence` | Pull Salesforce activities into Supabase/LCC data plane | `flows/sync-sf-activities-to-supabase.md` | Active |
| Sync Flagged Emails to Supabase | `SyncFlaggedEmailstoSupabase_20260512135136.zip`, `SyncFlaggedEmailstoSupabase_20260512135251.zip` | `Recurrence` | Sync flagged Outlook emails into Supabase intake/task context | `flows/sync-flagged-emails-to-supabase.md` | Active (Duplicate variants) |
| Unflag Completed Email Tasks | `UnflagCompletedEmailTasks_20260512135227.zip` | `Recurrence` | Unflag emails whose linked To Do items are completed | `flows/unflag-completed-email-tasks.md` | Active |
| Recovery - Reflag Completed Emails | `Recovery-ReflagCompletedEmails_20260512135202.zip` | Request (`Button`) | Operator recovery flow to reflag emails when needed | `flows/recovery-reflag-completed-emails.md` | Active |
| HTTP Init LLC (disabled) | `http-initLLC_20260511212018.zip` | HTTP Request (`manual`) | OM staging workflow currently auto-disabled by platform after persistent failure | `flows/http-init-llc.md` | Disabled |

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
| Salesforce | `shared_salesforce` connector | Used in HTTP-Switch and LCCSFFlow1. |
| Office 365 | `shared_office365` connector | Used in flagged email trigger path. |
| Teams | `shared_teams` connector | Used in manual attachment foreach posting flow. |
| Conversion Service | `shared_conversionservice` connector | Used in LoopNet/RCM html-to-text conversion flows. |
| Microsoft To Do | `shared_todo` connector | Used by ToDo-LCCSync for multi-folder task pulls. |
| Microsoft To Do (Personal) | `shared_todoconsumer` connector | Used by personal mailbox flagged-email task sync flow. |
| OneDrive for Business | `shared_onedriveforbusiness_1` connector | Used by ToDo-LCCSync for sync-file read/update. |
| Outlook Calendar | `shared_outlook` connector | Used by personal and business calendar sync recurrence flows. |
| Supabase (LCC Opps) | `sf_sync_queue` table | Source queue for LCCSFFlow1. |
| Supabase (Domain DB) | `contacts`, `true_owners` tables | Updated by `link_*` branches in LCCSFFlow1. |
| Salesforce Objects | `Task`, `Lead` | Queried/updated by CompleteSFTask and GovLeaseLeadSync flows. |

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
| P1 | Write Governance | Manual HTTP-triggered Salesforce update/upsert flows can mutate CRM directly without explicit orchestration-tier approval semantics. | Add explicit request auth, action allowlist, and audit/correlation requirements for manual mutation flows. | LCC + Flow Owners | Open |
| P0 | Production Stability | Platform reported repeated failures across 6 flows and auto-disabled `HTTP Init LLC` after 14 days of continuous failure. | Run incident remediation wave: recover disabled flow, fix top failure-volume flows, and gate all high-risk actions with deterministic error handling. | Flow Owners + LCC Platform | Open |

## Incident Snapshot (From Power Automate Alerts)
Date reviewed: 2026-05-12  
Source emails:
- `C:\Users\scott\Downloads\6 of your flow(s) have failed.eml` (dated 2026-05-06)
- `C:\Users\scott\Downloads\Alert! We've disabled one of your flows.eml` (dated 2026-05-08)

Confirmed failures in prior-week alert:
| Flow | Failure Count | Flow ID | Priority |
|---|---:|---|---|
| To Do - Life Command Center Sync | 95 | `fee2a0fe-21fa-4e28-b230-f83189d4b20b` | P0 |
| LCC Flagged Email Intake | 31 | `44227dbb-3c8b-46b2-9a6a-6c46130a6beb` | P0 |
| Flagged Email to To Do Task | 20 | `2116af42-659e-416b-bce6-1d74e8daa480` | P1 |
| Flagged Email to To Do | 16 | `9071662c-ec79-49d2-82c1-03d8ba4302a6` | P1 |
| HTTP -> Switch... | 4 | `c3744e93-5e95-4b6f-a839-d4308389d21f` | P1 |
| LCC Morning Briefing Email | 2 | `6ec55229-302e-492c-b4b9-a4cab92adc6d` | P2 |

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
