# Power Automate Flow Changes Log

Last updated: 2026-05-11
Purpose: authoritative ledger of flow changes, risks, validation evidence, and rollback notes.

## Required Entry Fields
- Date (UTC)
- Flow name
- Flow version/export artifact
- Risk tier (`P0`, `P1`, `P2`, `P3`)
- Change summary
- Exact steps changed
- Affected endpoints/tables/connectors
- Security impact
- Validation evidence (success + failure run IDs/screenshots)
- Rollback action
- Owner

## Entries

### 2026-05-11 — Baseline Documentation Initialization
- Flow name: `LCC Flagged Email Intake`, `HTTP-Switch`, `LCCSFFlow1`
- Flow version/export artifact:
  - `LCCFlaggedEmailIntake_20260511211601.zip`
  - `HTTP-Switch_20260511211836.zip`
  - `LCCSFFlow1_20260511211808.zip`
- Risk tier: `P1` (documentation baseline), `P0` (security finding logged)
- Change summary: Created initial architecture audit docs and per-flow technical sheets.
- Exact steps changed:
  - Added master registry file.
  - Added 3 detailed flow docs.
  - Added this change ledger file.
- Affected endpoints/tables/connectors:
  - `/api/intake?_route=outlook-message`
  - `/api/intake/prepare-upload`
  - `sf_sync_queue`, `contacts`, `true_owners`
  - `shared_office365`, `shared_salesforce`
- Security impact:
  - Identified embedded credential material in flow export definitions (P0).
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json` files from provided ZIP artifacts.
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-11 — Export Round 2 Documentation Ingestion
- Flow name:
  - `LCCOutlookIntake`
  - `http-initLLC`
  - `manual-foreachpost`
  - `LoopNetPowerAutomate`
  - `RCMPowerAutomate`
  - `HTTP-Switch` (re-export reference, no new behavioral delta captured)
- Flow version/export artifact:
  - `LCCOutlookIntake_20260511212049.zip`
  - `http-initLLC_20260511212018.zip`
  - `manual-foreachpost_20260511211947.zip`
  - `LoopNetPowerAutomate_20260511214000.zip`
  - `RCMPowerAutomate_20260511214031.zip`
  - `HTTP-Switch_20260511211836.zip`
- Risk tier: `P1` (new architecture capture), `P2` (hygiene/standardization)
- Change summary:
  - Added 5 new per-flow detail sheets.
  - Updated master audit registry with new flow inventory and dependencies.
  - Captured additional risk signals (parallel pattern drift, brittle condition references).
- Exact steps changed:
  - Created markdown docs under `docs/architecture/flows/`.
  - Updated `power-automate-flow-audit.md` inventory, dependencies, and gap matrix.
- Affected endpoints/tables/connectors:
  - `/api/intake-outlook-message`
  - `/api/intake/prepare-upload`, `/api/intake/stage-om`, `/api/intake-extract`
  - `/api/loopnet-ingest`, `/api/rcm-ingest`
  - connectors: `shared_office365`, `shared_conversionservice`, `shared_teams`
- Security impact:
  - No plaintext bearer/service-role token strings were detected in this export batch's `definition.json` files.
  - Existing prior P0 credential exposure finding for `LCCSFFlow1` remains open until rotated/re-exported.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert added/edited markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-11 — Export Round 3 Documentation Ingestion
- Flow name:
  - `LCCMorningBriefing`
  - `HTTP-ParseJSON`
  - `LCCDailyBriefing`
  - `ToDo-LCCSync`
- Flow version/export artifact:
  - `LCCMorningBriefing_20260511215210.zip`
  - `HTTP-ParseJSON_20260511215138.zip`
  - `LCCDailyBriefing_20260511215104.zip`
  - `ToDo-LCCSync_20260511215037.zip`
- Risk tier: `P1` (new architecture capture), `P2` (schedule/config governance)
- Change summary:
  - Added 4 new per-flow detail docs.
  - Updated master registry inventory/dependency map/gap matrix.
  - Captured recurrence cadence and delivery-path dependencies (email, Teams, To Do/OneDrive).
- Exact steps changed:
  - Created markdown docs under `docs/architecture/flows/`.
  - Updated `power-automate-flow-audit.md` with new flows and dependencies.
- Affected endpoints/tables/connectors:
  - `/api/briefing-email`
  - `/api/daily-briefing?action=snapshot&role_view=broker`
  - `/api/property?address=...`
  - connectors: `shared_office365`, `shared_teams`, `shared_todo`, `shared_onedriveforbusiness_1`
- Security impact:
  - No plaintext bearer/service-role token strings detected in this batch's `definition.json` files.
  - Secret-header patterns (`X-LCC-Key`, `x-lcc-key`) continue and remain a configuration control focus.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert added/edited markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-12 — Export Round 4 Documentation Ingestion
- Flow name:
  - `CompleteSFTask`
  - `GovLeaseLeadSync`
  - `HTTP-Postmessagechat`
  - `HTTP-Postmessagechat2`
- Flow version/export artifact:
  - `CompleteSFTask_20260512134535.zip`
  - `GovLeaseLeadSync_20260512134512.zip`
  - `HTTP-Postmessagechat_20260512134401.zip`
  - `HTTP-Postmessagechat2_20260512134447.zip`
- Risk tier: `P1` (write governance), `P2` (payload/schema hygiene)
- Change summary:
  - Added 4 new per-flow detail docs.
  - Updated master registry with Salesforce mutation and Teams message-post flows.
  - Logged governance risks for manual-trigger CRM mutation patterns.
- Exact steps changed:
  - Created markdown docs under `docs/architecture/flows/`.
  - Updated `power-automate-flow-audit.md` inventory, dependencies, and gap matrix.
- Affected endpoints/tables/connectors:
  - Salesforce objects: `Task`, `Lead`
  - Teams connector message-post paths
  - connectors: `shared_salesforce`, `shared_teams`
- Security impact:
  - No plaintext bearer/service-role token strings detected in this batch's `definition.json` files.
  - Manual trigger + mutation flows still require stronger request-auth/audit controls.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert added/edited markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-12 — Export Round 5 Documentation Ingestion
- Flow name:
  - `SyncFlaggedEmailstoSupabase` (Graph Pull Variant)
  - `SyncFlaggedEmailstoSupabase` (Supabase Push Variant)
  - `UnflagCompletedEmailTasks`
  - `Recovery-ReflagCompletedEmails`
- Flow version/export artifact:
  - `SyncFlaggedEmailstoSupabase_20260512135251.zip`
  - `SyncFlaggedEmailstoSupabase_20260512135136.zip`
  - `UnflagCompletedEmailTasks_20260512135227.zip`
  - `Recovery-ReflagCompletedEmails_20260512135202.zip`
- Risk tier: `P0` (credential exposure), `P1` (state sync semantics), `P2` (variant drift)
- Change summary:
  - Added 3 new detail docs (including split-variant analysis for SyncFlaggedEmailstoSupabase).
  - Updated master registry with flagged-email sync and flag-state maintenance flows.
  - Logged new P0 credential exposure on the flagged-email Supabase push variant.
- Exact steps changed:
  - Created markdown docs under `docs/architecture/flows/`.
  - Updated `power-automate-flow-audit.md` inventory, dependencies, and gap matrix.
- Affected endpoints/tables/connectors:
  - `/functions/v1/ai-copilot/sync/flagged-emails`
  - connectors: `shared_office365`, `shared_todo`
  - operations: `GetEmailsV3`, `ListToDosByFolderV2`, `Flag_email_(V2)`
- Security impact:
  - Plaintext credential signals detected in:
    - `SyncFlaggedEmailstoSupabase_20260512135136.zip`
  - Immediate key rotation and secure-reference refactor required.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Definition hashes:
    - `SyncFlaggedEmailstoSupabase_20260512135251`: `f4d2b5e379797fe3431df0aacb7cc48bb8ce244895fabcbba81f3b813a03e9b2`
    - `SyncFlaggedEmailstoSupabase_20260512135136`: `736d1f8ae409770557af0f6c5d9d29244d8680c4458cdd00a67420ac199b33e3`
    - `UnflagCompletedEmailTasks_20260512135227`: `7e3dbfcc95126e128ea22bb7ba0bad7c5602699d10090c7bd6d6c588aa9fdcf6`
    - `Recovery-ReflagCompletedEmails_20260512135202`: `eef758da708a5ab8f33337d7d1a613bc95628271e2d612cf4c0d85359b6b6059`
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert added/edited markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-12 — Export Round 6 Documentation Ingestion (Final Batch)
- Flow name:
  - `Button-SendanHTTPrequest`
  - `FlaggedEmailtoToDo`
  - `FlaggedPersonalEmailtoToDo`
  - `FlaggedEmailtoToDoTask`
  - `LogActivitytoSFfromLCC`
- Flow version/export artifact:
  - `Button-SendanHTTPrequest_20260512135816.zip`
  - `FlaggedEmailtoToDo_20260512135754.zip`
  - `FlaggedPersonalEmailtoToDo_20260512135719.zip`
  - `FlaggedEmailtoToDoTask_20260512135651.zip`
  - `LogActivitytoSFfromLCC_20260512135623.zip`
- Risk tier: `P1` (manual mutation/control), `P1` (variant drift), `P1` (secret handling governance)
- Change summary:
  - Added 5 new per-flow detail docs.
  - Updated master registry with ToDo creation variants, SF activity logger, and Azure button flow.
  - Added governance gaps for duplicated flagged-email-to-todo patterns and subscription-key handling.
- Exact steps changed:
  - Created markdown docs under `docs/architecture/flows/`.
  - Updated `power-automate-flow-audit.md` inventory, dependencies, and gap matrix.
- Affected endpoints/tables/connectors:
  - Azure endpoint: `propertyaiextractor.cognitiveservices.azure.com`
  - Salesforce `Task` create path (`PostItem_V2`)
  - ToDo create operations (`CreateToDoV3`, `CreateToDo`)
  - connectors: `shared_office365`, `shared_todo`, `shared_outlook`, `shared_todoconsumer`, `shared_salesforce`
- Security impact:
  - No plaintext bearer/service-role token strings detected in this batch.
  - Subscription-key pattern in manual Azure flow requires secure reference + rotation controls.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Definition hashes:
    - `Button-SendanHTTPrequest_20260512135816`: `32cfe1a3e83b9fddbad17bec442306ca438db0cf0b715a25248de92973515b3c`
    - `FlaggedEmailtoToDo_20260512135754`: `d4d3561b7c21cf824c4bd5beb4be167c3ff31537bad5bd6ab79ed2306e39295f`
    - `FlaggedPersonalEmailtoToDo_20260512135719`: `c713172d1b338064d099bfb5b55109ef337956844b75b981e60048f5b0bfd0be`
    - `FlaggedEmailtoToDoTask_20260512135651`: `8a6aacfc6e86ec528663f7e67da1041452c2eaeed4a5d827d94e57d83c6ff70e`
    - `LogActivitytoSFfromLCC_20260512135623`: `f4d557944514ce22d9c320f82480dd8f412ee34ed98047b7e0295ba147386efc`
  - Runtime run IDs: `TBD`
- Rollback action:
  - Documentation-only change, revert added/edited markdown files if needed.
- Owner: LCC architecture/audit track.

## Open Action Items
1. Rotate exposed keys and confirm rotation completion here.
2. Re-export affected flows and verify no embedded credentials appear.
3. Add schema version and strict validation branch documentation for HTTP-Switch.
4. Add retry/dead-letter/idempotency policy record per `kind` for LCCSFFlow1.
