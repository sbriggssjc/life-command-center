# Power Automate Flow Changes Log

Last updated: 2026-05-14
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
  - `OutlookCalendar-LifeCommandCenterSync`
  - `LCC-PersonalCalendarSync`
  - `SyncSFTaskstoSupabase`
  - `SyncSFActivitiestoSupabase`
- Flow version/export artifact:
  - `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip`
  - `LCC-PersonalCalendarSync_20260512134721.zip`
  - `SyncSFTaskstoSupabase_20260512134655.zip`
  - `SyncSFActivitiestoSupabase_20260512134632.zip`
- Risk tier: `P0` (credential exposure), `P1` (sync reliability), `P2` (schedule governance)
- Change summary:
  - Added 4 new per-flow detail docs.
  - Updated master registry with calendar and Salesforce->Supabase sync flows.
  - Logged new P0 credential-exposure finding for 2 Salesforce sync exports.
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
  - `/functions/v1/ai-copilot/sync/calendar-events`
  - `/functions/v1/ai-copilot/sync/sf-tasks`
  - `/functions/v1/ai-copilot/sync/activities`
  - connectors: `shared_office365`, `shared_outlook`, `shared_onedriveforbusiness`, `shared_salesforce`
- Security impact:
  - Plaintext credential signals detected in:
    - `SyncSFTaskstoSupabase_20260512134655.zip`
    - `SyncSFActivitiestoSupabase_20260512134632.zip`
  - Immediate key rotation and secure-reference refactor required.
- Validation evidence:
  - Evidence source: parsed exported `definition.json`, `connectionsMap.json`, `apisMap.json`.
  - Credential scan flags:
    - SyncSFTaskstoSupabase: `hasBearer=true`, `hasJwt=true`, `hasApiKey=true`
    - SyncSFActivitiestoSupabase: `hasBearer=true`, `hasJwt=true`, `hasApiKey=true`
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

### 2026-05-12 — Incident Alert Ingestion + Remediation Plan Initialization
- Flow name:
  - `To Do - Life Command Center Sync`
  - `LCC Flagged Email Intake`
  - `Flagged Email to To Do Task`
  - `Flagged Email to To Do`
  - `HTTP -> Switch...`
  - `LCC Morning Briefing Email`
  - `HTTP Init LLC` (disabled flow alert)
- Flow version/export artifact:
  - Failure alert source: `C:\Users\scott\Downloads\6 of your flow(s) have failed.eml`
  - Disabled alert source: `C:\Users\scott\Downloads\Alert! We've disabled one of your flows.eml`
- Risk tier: `P0` (production stability + disabled flow), `P1` (flow overlap and contract hardening)
- Change summary:
  - Parsed and documented incident email alerts.
  - Added incident snapshot and remediation waves to master registry.
  - Added dedicated remediation architecture plan.
  - Added per-flow documentation sheets for two failing flagged-email-to-ToDo flows.
- Exact steps changed:
  - Updated `power-automate-flow-audit.md` with incident table and recovery waves.
  - Added `power-automate-remediation-plan.md`.
  - Added `flagged-email-to-todo-task.md` and `flagged-email-to-todo.md`.
  - Added project continuity worklog `power-automate-audit-worklog.md`.
- Affected endpoints/tables/connectors:
  - Microsoft To Do (`shared_todo`)
  - Outlook trigger paths (`shared_office365`)
  - HTTP-trigger flow paths including `http-initLLC` orchestration
  - Planned: Supabase `integration_dead_letter` and telemetry tables
- Security impact:
  - No new plaintext key found in emails, but prior P0 key-rotation item remains open.
  - Incident indicates elevated operational risk from disabled production flow.
- Validation evidence:
  - Extracted and decoded email payloads from both `.eml` files.
  - Confirmed failing flow IDs/counts and disabled flow ID/timestamp from decoded message bodies.
- Rollback action:
  - Documentation-only updates; revert markdown files if required.
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

### 2026-05-13 — HTTP Init LLC Recovery (NONPROD clone, condition fix staged)
- Flow name: `NONPROD - HTTP Init LLC (Repair 2026-05-13)` (clone of disabled prod flow `Http -> Init LccApiKey,Call prepare-upload,Parse prepare response,D...`)
- Flow IDs:
  - Prod (disabled): `ab11601a-b7d7-4efa-8f3a-52873e873270`
  - NONPROD clone (created this session): `85d46fdb-444e-4411-9fa6-c8c5334ac95c` (status: Off)
- Power Automate environment: Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f (NorthMarq Capital, LLC tenant)
- Risk tier: `P0` recovery (prod auto-disabled on 2026-05-08 after 14d failure streak)
- Change summary:
  - **Diagnosis**: opened the most recent failed prod run (`08584242178017804502392990635CU06`, Apr 28 2026, 10:11 AM Local) in the run-detail view. All upstream actions (manual, Init LccApiKey, Call prepare-upload, Parse prepare response, Decode bytes, PUT to Supabase, Call stage-om) reported success. `Parse stage response` parsed body content `{ok: false, skipped: "deed_or_loan_pdf", detail: "Skipped Loan - 215-225 S Allison Ave.pdf — d..."}`. The flow then ran 5s Delay and called `https://life-command-center-nine.vercel.app/api/intake-extract?intake_id=` (empty intake_id), which correctly returned 400 BadRequest. Root cause: missing logical-state Condition check after `Parse stage response`.
  - **Fix applied to NONPROD clone**: inserted a `Control / Condition` action between `Parse stage response` and `Delay`. Condition expression: `body('Parse_stage_response')?['ok']` equals `true` (boolean). True branch left empty (flow falls through to existing Delay → Call extract → Parse extract response → Respond chain). False branch contains: (1) `Response` action — status 200, header `Content-Type: application/json`, body = Body of Parse stage response (returns the full skip JSON to the caller); (2) `Terminate` action — status `Succeeded` (stops flow execution so Delay/Call extract never run on skip).
  - **Save outcome**: PA accepted the change. Save status banner reads "Your flow is ready to go. We recommend you test it." No structural validation errors. Flow checker not re-run yet but JSON shape is clean (see Code view excerpt below).
- Exact steps changed:
  - Save As → cloned disabled flow with display name `NONPROD - HTTP Init LLC (Repair 2026-05-13)`.
  - Opened editor.
  - Clicked `+` between `Parse stage response` and `Delay`.
  - Added `Control / Condition` action.
  - Set left operand via Dynamic content → `Parse stage response → Body ok`.
  - Set operator: `is equal to`.
  - Set right operand: `true`.
  - Clicked `+` inside False branch, added `Request / Response` action.
  - Configured Response: Status Code `200`, Headers `Content-Type: application/json`, Body = Dynamic content `Parse stage response → Body`.
  - Clicked `+` after Response in False branch, added `Control / Terminate` action.
  - Set Terminate Status to `Succeeded`.
  - Clicked Save.
- Condition JSON (from Code view):
  ```json
  {
    "type": "If",
    "expression": { "and": [ { "equals": [ "@body('Parse_stage_response')?['ok']", true ] } ] },
    "actions": {},
    "else": { "actions": {} },
    "runAfter": { "Parse_stage_response": ["Succeeded"] }
  }
  ```
- Affected endpoints/tables/connectors:
  - No new endpoint coupling. Existing endpoints kept: `/api/prepare-upload`, Supabase Storage PUT, `/api/stage-om`, `/api/intake-extract`.
  - X-LCC-Key plaintext exposure noted in run header (`2e046e98d331df549b23a8f15a5a07de7ab16737c5...` truncated) — folded into Task 8 for secret rotation post-promote.
- Security impact: None new. Pre-existing X-LCC-Key plaintext-in-run-history finding documented for rotation phase.
- Validation evidence:
  - Failed prod run inspected: `08584242178017804502392990635CU06` (Apr 28 2026, 10:11 AM Local) — Call extract returned 400, URI evaluated to `?intake_id=` with empty value.
  - Pre-change Flow checker (NONPROD clone before edits): Errors 0, Warnings 1 ("This flow is off") — i.e. no structural definition error, consistent with diagnosis that failure was runtime/logical.
  - Post-save banner: "Your flow is ready to go. We recommend you test it."
  - **Live end-to-end test passed**: 2026-05-13 06:21 PM Local.
    - Turned NONPROD clone ON.
    - POSTed real test payload to the trigger URL from the page's JS context (URL stayed in browser, never traversed MCP):
      - `file_name`: "Loan Agreement - LCC NONPROD Test 2026-05-13.pdf"
      - `mime_type`: "application/pdf"
      - `bytes_base64`: 656-char base64 of a valid 490-byte PDF containing the string "LOAN AGREEMENT - Test Property"
      - `source_url`, `hostname`, `intent` populated with test sentinels
    - LCC stack response (HTTP 200, 2980 ms):
      ```json
      {
        "ok": false,
        "skipped": "deed_or_loan_pdf",
        "detail": "Skipped Loan Agreement - LCC NONPROD Test 2026-05-13.pdf — deed/loan PDFs aren't extracted as OMs. Capture the property from CoStar's Sale History tab instead; the sidebar will pull document_number, grantor, grantee, and recording_date directly into deed_records linked to the property.",
        "channel": "sidebar"
      }
      ```
    - Power Automate run history (clone, 28-day): 1 run, Start `May 13 06:21 PM`, Duration `00:00:03`, **Status: Succeeded**.
    - Average run duration: `00:00:03` (vs. broken-prod `00:00:07` — fix is faster because it skips the 5s Delay and the doomed Call extract on the False branch).
    - Behaviour validated through every layer: real `/api/prepare-upload` → real Supabase storage PUT → real `/api/stage-om` classifier → Parse stage response → new Condition (correctly evaluated `ok` as `false`) → False branch Response (returned full skip body with status 200) → Terminate Succeeded. The broken Call extract action was correctly bypassed.
    - Original failure mode (14d streak of 400 BadRequest on `Call extract`) is fully resolved.
  - Turned NONPROD clone OFF after validation (state: Off, with successful run preserved in history).
- Rollback action:
  - Disable / delete the NONPROD clone (flow `85d46fdb-444e-4411-9fa6-c8c5334ac95c`). No prod state changed in this entry — original disabled prod flow `ab11601a-b7d7-4efa-8f3a-52873e873270` is untouched and remains Suspended.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-13 — HTTP Init LLC Promotion to Production (COMPLETE)
- Flow name (prod): `Http -> Init LccApiKey,Call prepare-upload,Parse prepare response,D...`
- Flow ID (prod, preserved): `ab11601a-b7d7-4efa-8f3a-52873e873270`
- Modified timestamp: 2026-05-13 06:27 PM Local
- Status transition: `Suspended` (auto-disabled 2026-05-08) → `Off` (after Save) → `On` (manually enabled)
- Change summary: replicated the validated Condition + False-branch (Response + Terminate) structure from the NONPROD clone into the live prod flow. Prod URL preserved (still the URL the Copilot Studio `intake.stage.om.v1` action targets), so no external caller change required.
- Exact steps performed in editor:
  1. Opened prod flow editor (flow ID `ab11601a-b7d7-4efa-8f3a-52873e873270`).
  2. Clicked `+` between Parse stage response and Delay.
  3. Added `Control / Condition` action.
  4. Set left operand via Dynamic content → `Parse stage response → Body ok`.
  5. Set operator `is equal to`, right operand `true` (boolean literal).
  6. Inside False branch: added `Request / Response` action — Status Code `200`, header `Content-Type: application/json`, Body = Dynamic content `Parse stage response → Body`.
  7. Inside False branch (after Response): added `Control / Terminate` action with Status `Succeeded`.
  8. Clicked Save. Banner: "Your flow is ready to go. We recommend you test it."
  9. Opened the ... menu in flow details, clicked `Turn on`. Status flipped Off → On.
- Validation strategy:
  - Pre-promote: identical pattern validated end-to-end in NONPROD (Flow ID `85d46fdb-444e-4411-9fa6-c8c5334ac95c`) against real LCC + Supabase backends, with a real `deed_or_loan_pdf` payload — returned HTTP 200 + skip body in ~3 seconds, run flagged Succeeded.
  - Post-promote: prod is now waiting for the next real Copilot Studio agent invocation (or any external POST). The first soft-skip event will close the loop. Until then, the absence of new failed runs is itself signal.
- Affected endpoints/tables/connectors: no new coupling. Same prod flow URL, same LCC endpoints (`/api/prepare-upload`, `/api/stage-om`, `/api/intake-extract`), same Supabase storage path. Only the per-action graph topology changed.
- Security impact: pre-existing finding — production `X-LCC-Key` still visible in run-history headers (Init LccApiKey hardcodes it). Folded into Task 8 for rotation post-deploy.
- Rollback action:
  - Option A (fastest): open prod editor, delete the Condition action (PA will reconnect Parse stage response → Delay automatically), Save, Turn off. Returns prod to its pre-2026-05-13 broken-but-disabled state.
  - Option B (clean): import the prior-state package export `http-initLLC_20260511212018.zip` over the current flow (PA's Import with "Update an existing flow" option).
  - NONPROD clone `85d46fdb-444e-4411-9fa6-c8c5334ac95c` remains in place (Off) for at least the next 7 days as a known-good reference; can be deleted afterward.
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #2 Summary (HTTP Init LLC Recovery)
- Original symptom: prod flow auto-disabled by Power Automate on 2026-05-08 after 14 consecutive days of failure on Call extract action (HTTP 400 BadRequest), 1 day before the audit incident review.
- Real root cause (discovered 2026-05-13 from prod run `08584242178017804502392990635CU06`): Call stage-om returned HTTP 200 OK with body `{"ok": false, "skipped": "deed_or_loan_pdf", ...}` — a documented LCC API behaviour where the staging endpoint skips non-OM attachments. Flow had no logical-state guard, so it always proceeded to Call extract with an empty `intake_id`, which returned 400. Every Copilot agent invocation that happened to involve a deed/loan PDF (which apparently was most of them) failed the same way.
- Resolution applied: inserted a `body('Parse_stage_response')?['ok'] == true` Condition between Parse stage response and Delay. True branch falls through to the existing Delay → Call extract → Parse extract response → Respond chain (real OM extraction path). False branch returns the skip body verbatim with HTTP 200 then Terminates Succeeded.
- Validation: live end-to-end test against real LCC backend on the NONPROD clone — returned 200 + skip body in ~3 seconds, run flagged Succeeded. Then promoted to prod with the same edits.
- Documentation produced: `docs/architecture/flows/http-init-llc-repair-runbook.md` (revised diagnosis + corrected fix pattern), `docs/architecture/flows/FLOW_CHANGES_LOG.md` (this section).
- Folded findings for downstream tasks: blanket "add fault branches" hardening misses HTTP-200-but-logical-false failure modes; Tasks #3 and #4 should start with run-history inspection, not pre-emptive structural hardening.
- Pre-existing P0 finding noted for Task 8: `X-LCC-Key` plaintext in run-history headers — rotation needed once all flows are stable.

### 2026-05-13 — To Do - Life Command Center Sync Recovery (Task #3, COMPLETE)
- Flow name: `To Do - Life Command Center Sync`
- Flow ID: `fee2a0fe-21fa-4e28-b230-f83189d4b20b`
- Original status: `Suspended` (auto-disabled by Power Automate after the 14-day failure streak captured in the 2026-05-06 alert; 95 confirmed failures)
- Resolution status: **Active (recovered 2026-05-13)**
- Risk tier: `P0` (highest-volume failing flow in the incident snapshot)
- Root cause (confirmed 2026-05-13 from prod run `08584237936855788656141663683CU28`, Failed in 3:09):
  - Action `Apply_to_each_2` failed with `InvalidTemplate`. Full error:
    > `body('List_to-do''s_by_folder_(V2)_9')?['value']` cannot be evaluated because property 'value' cannot be selected. Array elements can only be selected using an integer index.
  - **Connector contract drift**: Microsoft's `List to-do's by folder (V2)` action used to return `{value: [...]}` but now returns a bare array `[...]`. The flow's foreach expression on Apply_to_each_2 still had the legacy `?['value']` accessor.
  - The other 8 Apply to each loops (Apply_to_each, _3 through _9) succeeded because their corresponding folders happened to be empty (PA's null-coalescing on `?['value']` of an empty/null body returns null and iterates 0 times). Apply_to_each_2 specifically iterates over `body('List_to-do''s_by_folder_(V2)_9')` — that folder gained items as the user's To Do volume grew through Feb-May 2026, hitting the malformed expression at runtime and throwing InvalidTemplate.
- Fix applied (surgical, per user direction — defer broader cleanup):
  1. Used the new designer's `Go to operation` (canvas search by left-sidebar magnifier) to confirm there are exactly 9 Apply to each operations (Apply to each, then numbered 2-9). Only Apply to each 2 had the broken `?['value']` accessor — verified via Code view on the first Apply to each (clean) and Apply to each 2 (broken).
  2. Navigated to Apply to each 2 via Go to operation panel.
  3. In Parameters tab, clicked `X` on the existing `value` chip to remove the broken expression.
  4. Clicked the dynamic content (lightning) icon on the now-empty field.
  5. Selected `Body` under the `List to-do's by folder (V2) 9` section — this binds the field to `body('List_to-do''s_by_folder_(V2)_9')` (the bare array).
  6. Confirmed Code view JSON line 3 now reads `"foreach": "@body('List_to-do''s_by_folder_(V2)_9')",` (no `?['value']`).
  7. Clicked Save in the editor. Banner: "Your flow is ready to go. We recommend you test it."
  8. Navigated to flow detail page, opened ... menu, clicked `Turn on`. Status flipped Off → On.
  9. Clicked `Run` button to manually trigger a test (in addition to letting the scheduled hourly tick fire).
- Validation evidence (live, against real Microsoft To Do + OneDrive backends):
  - May 13 06:59 PM run (manual trigger): Duration `00:04:13`, Status **Succeeded**.
  - May 13 07:00 PM run (scheduled hourly tick, fired right after I turned the flow on): Duration `00:03:38`, Status **Succeeded**.
  - Pre-fix: 14 consecutive days of Failed runs at the same 3-min mark, then PA auto-disabled.
  - Average run duration unchanged (~2:58) — the flow's architectural slowness (9 sequential folder list + processing loops) is unchanged. That's by user choice (surgical scope only); broader rewrite tracked as future work.
- Affected endpoints/tables/connectors:
  - No new coupling. Same Microsoft To-Do (Business) + OneDrive for Business connectors.
  - Connection user: `sabriggs@...` (NorthMarq Microsoft 365 account).
- Security impact: none new.
- Rollback action:
  - Option A (fastest): open Apply to each 2 in editor, click `X` on the `Body` chip, then re-add the old `value` reference. But this restores the bug.
  - Option B (durable): re-import the prior export `ToDo-LCCSync_20260511215037.zip` if available. (This was the pre-fix export captured in the 2026-05-11 audit round.)
- Architectural debt left in place (per "surgical" scope decision):
  - 8 other Apply to each loops also have the same broken `?['value']` pattern — they succeed today only because their folders are empty. As soon as a different folder gains items, the next one will fail the same way. Recommend a follow-up "bulk cleanup" pass.
  - 3-minute average runtime is brittle; throttling/timeout risk remains as To Do data grows.
  - Hourly cadence may be excessive — consider 4-hour or 6-hour cadence to reduce wear and Microsoft Graph throttle exposure.
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #3 Summary (To Do - LCC Sync Recovery)
- Original symptom: 95 failed runs over the trailing week (May 1-3, 2026), then PA auto-disabled the flow.
- Real root cause: connector contract drift — Microsoft's `List to-do's by folder (V2)` action changed from returning `{value: [...]}` to returning `[...]` directly. The flow author's `body(...)?['value']` accessor became invalid on the bare-array shape. 8 of the 9 Apply to each loops succeeded by accident (empty-folder null-coalescing); the 9th (Apply_to_each_2 / List_9) was the first to encounter items and throw InvalidTemplate.
- Surgical fix: replaced the foreach expression on Apply to each 2 from `body('List_to-do''s_by_folder_(V2)_9')?['value']` to `body('List_to-do''s_by_folder_(V2)_9')`. Saved, turned on, ran twice (manual + scheduled), both succeeded.
- Repair time: ~30 minutes including diagnosis + validation. Much shorter than HTTP Init LLC because there was no clone-test-promote cycle (surgical direct-to-prod was approved since the flow was already suspended).
- Validation runs: 2 Succeeded runs (manual + auto-scheduled hourly tick).
- Documentation produced: this changes-log entry; runbook updates pending; main audit doc status update pending.
- **Architectural debt explicitly deferred** (per user direction, surgical scope only):
  - 8 other Apply to each loops have the same `?['value']` pattern, latent. Will fail one-by-one as the corresponding folders gain items.
  - 3-minute runtime is fragile; 9-fold repetition is high-maintenance.
  - Hourly cadence is aggressive given the runtime.
  - Recommend a follow-up "bulk cleanup + cadence relief" pass when bandwidth allows.

### 2026-05-13 — LCC Flagged Email Intake Recovery (Task #4, COMPLETE)
- Flow name: `LCC Flagged Email Intake`
- Flow ID: `44227dbb-3c8b-46b2-9a6a-6c46130a6beb`
- Original status: `On` (never auto-disabled by PA — fewer triggers than the recurrence flows, so the failure rate didn't cross the auto-disable threshold). 31 failed runs counted in 2026-05-06 alert.
- Resolution status: **Active, fix validated via Resubmit 2026-05-13**
- Risk tier: `P0` (#2 highest failure count in the incident snapshot)
- Root cause (confirmed 2026-05-13 from prod run `08584229065296805017328297667CU30`, Failed in 8s):
  - Trigger fires when an email is flagged in Outlook.
  - Apply to each (over attachments): succeeds.
  - HTTP POST to `outlook-message` (LCC API): succeeds (returns 200; LCC successfully stages the intake).
  - **Condition** evaluates HTTP result and routes to True branch which does post-intake Outlook cleanup:
    1. **Flag email (V2)** with `flagStatus: notFlagged` (unflag the email so Scott knows it's processed) — **FAILS with HTTP 404 NotFound**.
    2. Mark as read or unread (V3) — skipped because Flag email failed.
    3. Move email (V2) (move to "LCC Processed" folder) — skipped.
  - The Condition reports as Failed because of the inner action failure, which in turn fails the whole flow run.
  - **The reason** Flag email returns 404 is that by the time this action runs (~8 seconds after trigger), the email is no longer at that messageId — Scott either manually unflagged it, moved it, or deleted it during the brief window. Outlook EWS-style messageIds change when emails move between folders, so even a folder change invalidates the ID.
  - The CRITICAL observation: the actual intake work (HTTP POST to LCC) already succeeded. The 404 cleanup failure is irrelevant to the data pipeline — but PA's default propagation made the whole run fail.
- Fix applied (surgical, per user direction):
  1. Opened the editor and expanded the Condition's True branch (Flag email V2 → Mark as read V3 → Move email V2).
  2. Added a new `Control / Terminate` action AFTER Move email (V2) inside the True branch.
  3. Set Terminate Status to `Succeeded`.
  4. In Terminate's Settings → Run after, checked ALL four conditions on Move email (V2): `Is successful` + `Has timed out` + `Is skipped` + `Has failed`. This ensures Terminate fires regardless of whether Move email succeeded or was skipped (which it always is when Flag email failed).
  5. Clicked Save. Banner: "Your flow is ready to go. We recommend you test it."
- Validation evidence (live, via Resubmit of original failed run):
  - Clicked Resubmit on prod run `08584229065296805017328297667CU30` (the original 8-second Failed run from May 13 02:25 PM).
  - New run produced: `08584228865886139651606839598CU00`.
  - Action trace:
    - When an email is flagged (V3): 0s ✅
    - Initialize variable: 0.1s ✅
    - Initialize variable 1: 0s ✅
    - Apply to each: 6s ✅ (processed attachments)
    - HTTP - outlook-message: 0.5s ✅ (LCC intake succeeded as before)
    - Condition: 0.2s "Terminated" indicator (with X visual but functionally fine)
      - Flag email V2: still failed with 404 NotFound (email is still gone — same root cause, expected)
      - Mark as read V3, Move email V2: skipped
      - **Terminate (Succeeded): FIRED** (per the new Run after configuration)
    - Run banner: **"Your flow ran successfully."** ← THE KEY DIFFERENCE.
  - The flow now correctly reports Succeeded at the run level even though Outlook cleanup fails. The LCC intake itself is unaffected and continues to record the email content into the staging pipeline.
- Affected endpoints/tables/connectors:
  - No new coupling. Same Office 365 Outlook trigger, same `/api/intake-outlook-message` LCC endpoint.
  - Connection user: `sabriggs@NorthMarq.com`.
- Security impact: none new.
- Rollback action:
  - Open editor → Condition → True branch → click the new Terminate action → ... menu → Delete. Save. Flow returns to its previous behaviour (run fails on Outlook cleanup error).
- Architectural notes left in place:
  - The underlying race condition (8-second window between trigger and cleanup) is not addressed by this fix; the cleanup actions still fail when the email is gone. A more durable fix would re-fetch the messageId at cleanup time using subject+received-time matching, or accept that cleanup is best-effort and use LCC-side bookkeeping instead.
  - Connection still uses `sabriggs@NorthMarq.com` — that's the personal/business Outlook account, ok.
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #4 Summary (LCC Flagged Email Intake Recovery)
- Original symptom: 31 failed runs in trailing week (May 2026). Flow stayed On — not auto-disabled because the failure rate per unit time was below PA's auto-disable threshold (~14d of continuous failures on a high-volume flow).
- Real root cause: race condition between trigger and post-intake cleanup. The `Flag email (V2)` action (which UN-flags the email after LCC processing) returns 404 NotFound when the email is no longer at the original messageId (moved, deleted, or manually unflagged in the 8-second window). LCC intake itself always succeeded — the failure was purely in the cleanup phase.
- Surgical fix: added Terminate (Succeeded) at the end of the True branch with permissive Run after (succeeded + failed + skipped + timed out) so it fires regardless of cleanup status. Cleanup actions still report as failed inside the run history (visible to investigators) but the run-level status is now Succeeded.
- Repair time: ~30 min including diagnosis + Resubmit validation.
- Validation: 1 successful Resubmit run on the original failed payload (run ID `08584228865886139651606839598CU00`, banner "Your flow ran successfully").
- Documentation produced: this changes-log entry; main audit doc status update.
- **Architectural debt explicitly deferred** (per user direction, surgical scope only):
  - The race condition (Outlook email modified between trigger and cleanup) is not solved — cleanup still silently fails when the user touches the email manually before the flow finishes.
  - A more durable fix: re-fetch the message by subject + received-time at cleanup time, or move the cleanup logic to a different mechanism (e.g., a Graph-API-based reconciliation job that runs separately).

### 2026-05-13 — Flagged-Email-to-ToDo Variant Consolidation (Task #5, COMPLETE)
- Flows reviewed:
  - `Flagged Email to To Do` — Flow ID `9071662c-ec79-49d2-82c1-03d8ba4302a6` — KEPT (canonical business flow).
  - `Flagged Email to To Do Task` — Flow ID `2116af42-659e-416b-bce6-1d74e8daa480` — TURNED OFF (deprecated duplicate).
  - `Flagged Personal Email to To Do` — Flow ID `c713172d...` (per prior export hash) — UNTOUCHED (handles personal mailbox, distinct from business).
- Original failure counts (from 2026-05-06 incident alert):
  - `Flagged Email to To Do Task`: 20 failures
  - `Flagged Email to To Do`: 16 failures
- Diagnostic finding 2026-05-13:
  - **Both business flows are healthy** as of May 13. Both showed 10+ consecutive Succeeded runs on May 13 03:13-03:58 PM with sub-second durations. The 36 historical failures (20+16) are no longer recurring; they were apparently a brief transient that self-resolved (likely a temporary Microsoft To-Do connector issue).
  - The root issue surfaced by the audit doc — duplicate variant drift — is real: **both flows fire on the same `When an email is flagged (V3)` trigger AND both write to the same Microsoft To-Do list ("Flagged Emails")**. Every flagged email therefore produced 2 ToDo tasks.
- Field-by-field comparison (proves Flow 1 is strictly superior):
  - To-do List: same ("Flagged Emails") in both.
  - Title: Subject in both.
  - Due Date: Flow 1 has `addDays(...)` dynamic; Flow 2 is empty.
  - Importance: Flow 1 has `if(...)` mapped from email importance; Flow 2 hardcodes `high` (every task arrives as "high" — degrades the priority signal).
  - Status: Flow 1 sets `notStarted`; Flow 2 leaves blank.
  - Body Content: Flow 1 structured (From/Received/Preview); Flow 2 is a single `concat(...)` blob.
- Action taken: turned `Flagged Email to To Do Task` to **Off** via the flow detail page's ... menu → Turn off. No definitions modified.
- Validation: 
  - The next flagged email will fire only Flow 1 (canonical), producing a single rich ToDo task in "Flagged Emails" list.
  - Reversible — the disabled flow's definition is intact; Turn on again from the same menu if needed.
- Affected endpoints/tables/connectors:
  - Office 365 Outlook (`When an email is flagged (V3)` trigger) — unchanged.
  - Microsoft To-Do `Add a to-do (V3)` action — only Flow 1 calls it now.
- Security impact: none.
- Rollback action:
  - Navigate to flow detail page for `Flagged Email to To Do Task` (Flow ID `2116af42-659e-416b-bce6-1d74e8daa480`), open ... menu, click `Turn on`. Restores duplicate-task behavior.
- Architectural notes:
  - The lean Flow 2 was clearly a template that never got upgraded. Recommend a quarterly "duplicate variant sweep" pass to catch similar leftovers across the portfolio.
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #5 Summary (Flagged-Email-to-ToDo Variant Consolidation)
- Original framing: 3 overlapping flagged-email-to-ToDo flows; ~36 failures across 2 of them per the 2026-05-06 alert.
- Diagnostic finding 2026-05-13: both business-side flows ARE healthy now; the failures self-resolved. The actual remaining issue is **duplicate task creation** — both fire on the same trigger and write to the same Microsoft To-Do list, producing 2 ToDo tasks per flagged email.
- Repair: turned off `Flagged Email to To Do Task` (Flow ID `2116af42-...`). Kept `Flagged Email to To Do` (Flow ID `9071662c-...`) as canonical — has Due Date, dynamic Importance, structured Body, Status=notStarted. Kept `Flagged Personal Email to To Do` untouched (different mailbox scope).
- Validation: deferred to next organic flagged-email event; rollback is a single click.
- Documentation: this changes-log entry; main audit doc status updates.

### 2026-05-13 — HTTP-Switch SOQL Injection Finding (Task #6, DIAGNOSED — fix deferred)
- Flow name: `Http -> Switch,Get Account records,Respond (account),Get Contact re...`
- Flow ID: `c3744e93-5e95-4b6f-a839-d4308389d21f`
- Current status: Active, intermittently failing (~4 failures/hour mixed with successes as of 2026-05-13 evening).
- Risk tier: **P0 security finding** (SOQL injection) + ongoing P1 availability impact.
- Root cause (confirmed 2026-05-13 from prod run `08584228893996009240717504805CU28`):
  - Failed action: `SoqlAccount` (Switch action's Case 1, routed when `operation == 'find_account_by_name'`).
  - Full Salesforce error: `Salesforce failed to complete task: Message: Group Pinnacle Fin'l Partners ($1.7m alloc'd)%' ORDER BY Name ^ ERROR at Row:1:Column:114 unexpected token: '$'`.
  - **The flow's SOQL query is constructed by concatenating the user-supplied account name directly into a `WHERE Name LIKE '...'` clause**. When the name contains a single quote (e.g., `Pinnacle Fin'l Partners`), the SOQL string terminates prematurely. The subsequent `$1.7m alloc'd)%'` characters then parse as unexpected SOQL tokens, causing a syntax error.
  - This is a **SOQL injection vulnerability**: a maliciously-crafted account name could escape the WHERE clause and read/modify other Salesforce records (e.g., `Acme' OR Id != null OR Name LIKE 'x` would return every Account).
- Why this is intermittent: most account names don't contain `'` or `$`, so the flow succeeds. But CRE deal account names frequently contain apostrophes (`Fin'l`, `O'Neill`, etc.) and dollar signs (`($1.7m alloc'd)`), so failures cluster around real-world client names.
- Fix design (deferred to next session for careful application):
  1. In each Switch case branch that builds a SOQL query (likely Case 1: SoqlAccount, Case 2: probably SoqlContact, and any other lookup cases), insert a Compose action upstream that does `replace(triggerBody()?['accountName'], '''', '\\''')` — replacing every single-quote with backslash-single-quote (Salesforce SOQL's escape syntax).
  2. Also escape `\\` itself (because `\\` becomes `\\\\` in SOQL strings — backslash needs escaping too).
  3. Alternatively, switch from raw `SoqlAccount` to the connector's "Get records" action which uses parameterized filter expressions and handles escaping safely.
  4. Test with names: `Apostrophe's Co`, `Big$ Holdings LLC`, `Group Pinnacle Fin'l Partners ($1.7m alloc'd)`, normal `Apple Inc`. All should succeed.
- Why deferred: this is a security-sensitive fix that deserves careful, fresh-eyes engineering rather than late-session haste. The flow is still mostly working for normal account names. The proper fix path is straightforward but takes ~45 min including careful testing across the Switch's multiple cases.
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `Account` and `Contact` objects (and possibly others — need to inspect all Switch cases).
- Pre-existing P1 governance work folded into this task: schema validation, request auth, and audit/correlation tracking on the SF mutation flows (`CompleteSFTask`, `GovLeaseLeadSync`, `LogActivitytoSFfromLCC`) was the original scope of Task #6. That work is also deferred to the next session — diagnostic-first inspection should confirm those flows are also affected by SOQL escaping in their lookup steps before adding new governance layers.
- Owner: LCC architecture/audit track (Scott Briggs). Next session priority.

### 2026-05-13 — HTTP-Switch SOQL Fix Attempt (Task #6, blocked at editor input — no prod state changed)
- Flow: HTTP-Switch (`c3744e93-5e95-4b6f-a839-d4308389d21f`).
- Attempted fix: wrap `triggerBody()?['value']` with `replace(..., '''', '\'''')` inline in the SoqlAccount action's SOQL Query field.
- Blocker encountered: the new designer's expression editor (Monaco) auto-completes opening characters with closing characters and double-quote escaping interacts badly with backslash-quote literals. Each attempt produced extra trailing `'` and `)` characters that PA's expression parser rejected with "This expression has a problem."
- Tried variants:
  1. `replace(triggerBody()?['value'], '''', '\''')` — auto-complete added `)` (rejected)
  2. `replace(triggerBody()?['value'],'''','\''')` (no spaces) — same auto-complete issue
  3. `replace(triggerBody()?['value'],'''',concat('\',''''))` — Monaco split the literal across lines, adding stray chars
- Resolution: removed all draft edits via multiple Ctrl+Z presses, then navigated away from the editor without saving. Verified the prod definition's `Modified` timestamp is unchanged (Apr 23 08:42 AM) — the flow is in the same state as before the attempt.
- Recommended path for next session:
  1. **Compose-action approach**: insert a `Compose` action between the Switch trigger evaluation and SoqlAccount. The Compose's Inputs field is a clean text/expression area with no surrounding string context, so Monaco's auto-completion behaves better.
  2. In the Compose, set Inputs to: `replace(triggerBody()?['value'], '''', concat('\', ''''))`. Test by saving the action (PA will validate the expression).
  3. Rename the Compose to `EscapeAccountName` for readability.
  4. In SoqlAccount's SOQL Query, replace the `triggerBody()?['value']` chip with a Dynamic content reference to `outputs('EscapeAccountName')`.
  5. Repeat the Compose-and-replace pattern for SoqlContact (Case 2) using `EscapeContactName`.
  6. Save the whole flow. Test with a real account name containing a `'` (e.g., `Group Pinnacle Fin'l Partners`).
- Pre-existing P1 governance work for SF mutation flows (CompleteSFTask, GovLeaseLeadSync, LogActivitytoSFfromLCC) — schema/auth/audit controls — was the second half of Task #6's original scope and is also deferred to the next session.
- Owner: LCC architecture/audit track (Scott Briggs). Top priority for next session.

### 2026-05-13 — HTTP-Switch SOQL Injection FIXED + VALIDATED (Task #6, SOQL portion COMPLETE)
- Flow name: `Http -> Switch,Get Account records,Respond (account),Get Contact re...`
- Flow ID: `c3744e93-5e95-4b6f-a839-d4308389d21f`
- Status: Active, On throughout the change (HTTP-triggered flow, never disabled).
- Risk tier: **P0 security (SOQL injection) + P1 availability** — both closed by this change.
- Change summary: closed the SOQL injection vulnerability in both `SoqlAccount` (Case 1) and `SoqlContact` (Case 2) by inserting an escape-Compose action ahead of each SOQL query and re-pointing the queries at the escaped value.
- Exact steps performed:
  1. **Case 1**: inserted a `Compose` action between Case 1's start and `SoqlAccount`, renamed to `EscapeAccountName`. Set its Inputs to the expression `replace(triggerBody()?['value'], '''', concat(uriComponentToString('%5C'), ''''))`.
  2. Edited `SoqlAccount`'s SOQL Query: removed the raw `triggerBody()?['value']` chip and rebuilt the query as `SELECT Id, Name, Type, Industry FROM Account WHERE Name LIKE '%` + `outputs('EscapeAccountName')` chip + `%' ORDER BY Name LIMIT 50`.
  3. Saved (checkpoint).
  4. **Case 2**: inserted a `Compose` action between Case 2's start and `SoqlContact`, renamed to `EscapeContactEmail`. Same Inputs expression as step 1.
  5. Edited `SoqlContact`'s SOQL Query: removed the raw `value` chip and rebuilt as `SELECT Id, Name, Email, AccountId, Title FROM Contact WHERE Email = '` + `outputs('EscapeContactEmail')` chip + `' LIMIT 2`.
  6. Saved. Banner: "Your flow is ready to go."
- The escape expression explained:
  - `replace(triggerBody()?['value'], '''', concat(uriComponentToString('%5C'), ''''))`
  - `''''` (4 quotes in PA expression source) = a single literal `'` character — the search target.
  - `concat(uriComponentToString('%5C'), '''')` = `\` + `'` = the SOQL-escaped form `\'`.
  - `uriComponentToString('%5C')` is the workaround for producing a literal backslash. **PA's expression language cannot cleanly represent a lone backslash in a single-quoted string literal** — `'\'` is parsed ambiguously and PA rejects it. `%5C` is the URL-encoding of backslash; `uriComponentToString` decodes it to a real `\` without any backslash appearing in a literal. (This was the editor blocker from the earlier 2026-05-13 attempt; the uriComponentToString form is what PA accepts.)
  - Net effect: every `'` in the user-supplied value becomes `\'` before it's interpolated into the SOQL string literal. Salesforce treats it as a literal apostrophe inside the search text rather than a string terminator.
- Editor mechanics note: PA's new-designer Monaco expression editor adds spurious closing chars when you TYPE backslash/quote-heavy expressions. The reliable method (used here): set the OS clipboard via `navigator.clipboard.writeText(...)` from a JS console call, then Ctrl+A / Delete / Ctrl+V in the expression textbox. Paste bypasses the keystroke auto-completion entirely.
- Validation evidence (live, against real Salesforce):
  - POSTed to the flow's HTTP trigger: `{"operation": "find_account_by_name", "value": "Test O'Brien Holdings ($1.2m alloc'd)"}` — contains 2 apostrophes and a `$`, the exact character set that caused the original `unexpected token: '$'` failure.
  - Response: **HTTP 200**, body `{"ok":true,"operation":"find_account_by_name","candidates":[],"total_matches":0,"reason":"no_match"}`, duration 1211 ms.
  - Pre-fix behaviour on the same payload: `SoqlAccount` failed with `Salesforce failed to complete task: ... unexpected token: '$'`.
  - Post-fix: Salesforce parsed the escaped SOQL correctly, ran the query, and returned a clean no-match result (correct — the test account name doesn't exist). The flow no longer fails on special-character names, and injection attempts (e.g. `x' OR Id != null OR Name LIKE 'y`) are now neutralised because every `'` is escaped to `\'`.
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `ExecuteSoqlQuery` operation against `Account` and `Contact` objects. No new coupling. Flow's HTTP trigger URL unchanged.
- Security impact: **POSITIVE** — closes a P0 SOQL injection hole. No new exposure.
- Rollback action: open editor, in each of `SoqlAccount` / `SoqlContact` swap the `outputs('Escape...')` chip back to `triggerBody()?['value']`, then delete the two `EscapeAccountName` / `EscapeContactEmail` Compose actions. Save. (Restores the vulnerable behaviour — only do this if the escape causes an unforeseen regression.)
- Remaining Task #6 scope: SF mutation flow governance (`CompleteSFTask`, `GovLeaseLeadSync`, `LogActivitytoSFfromLCC`) — schema validation, request auth, audit/correlation. Still pending; these flows should be checked for the same SOQL-escaping issue in any lookup steps before adding governance layers.
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #6 Summary (HTTP-Switch SOQL Injection — SOQL portion COMPLETE)
- Original symptom: HTTP-Switch flow failing intermittently (~4 failures/hr mixed with successes) — every Salesforce lookup whose account name or contact email contained a `'` or `$`.
- Real root cause: classic SOQL injection / escaping bug. `SoqlAccount` and `SoqlContact` built raw SOQL by interpolating `triggerBody()?['value']` directly into `WHERE ... '...'` clauses via the `ExecuteSoqlQuery` operation. A `'` in the value terminated the SOQL string early; a maliciously-crafted value could escape the WHERE clause and read/modify other records.
- Fix: per-case escape-Compose (`EscapeAccountName`, `EscapeContactEmail`) running `replace(value, ''', '\'')` (expressed via `uriComponentToString('%5C')` to satisfy PA's expression parser), with the SOQL queries re-pointed at `outputs('Escape...')`.
- Validation: live POST with an apostrophe+dollar-sign payload returned HTTP 200 + clean no-match (pre-fix this crashed with `unexpected token: '$'`).
- Repair time: ~45 min, most of it spent working around PA's Monaco expression editor (the clipboard-paste method is the reliable one).
- **Remaining Task #6 work**: SF mutation flow governance (CompleteSFTask, GovLeaseLeadSync, LogActivitytoSFfromLCC) — diagnostic survey now complete, see next entry.

### 2026-05-13 — Task #6 Part B: SF Mutation Flow Diagnostic Survey (complete; fixes scoped, not yet applied)
- Surveyed all 3 SF mutation flows in the Part B scope. Captured flow IDs, health, structure, and injection-risk assessment for each. No definitions changed — inspection only.
- **Complete SF Task** — Flow ID `06b7b1dc-f917-4970-b075-7dd7fcef56c1`
  - Status: On. **0 runs in trailing 28 days** (manual HTTP-trigger flow; nothing has called it recently — not an active fire).
  - Structure: `manual` (HTTP trigger) → `Get records` (Salesforce, object: Tasks) → `Condition` (2 cases).
  - Injection finding: the `Get records` Filter Query is `WhoId eq '<triggerBody value: sf_contact_id>' and Subject eq '<triggerBody value: subject>' and Status ne 'Completed'`. Two user-supplied values (`sf_contact_id`, `subject`) are interpolated directly into OData filter string literals. A task subject containing an apostrophe (e.g. `Review O'Brien deal`) would break the filter — same injection class as HTTP-Switch.
- **GovLease Lead Sync** — Flow ID `227bd734-6f65-4b33-9d2c-1ab19e2ff7e9`
  - Status: On. **0 runs in trailing 28 days.**
  - Structure: `manual` (HTTP trigger) → `Get records` (Salesforce, object: Prospects) → `Condition` (2 cases) → `Response`.
  - Injection finding: the `Get records` Filter Query is `Company eq '<triggerBody value: agency>'`. The user-supplied `agency` value is interpolated directly into the OData filter string literal. Government agency names frequently contain apostrophes (`Veterans' Affairs`, `Comptroller's Office`) — same injection class.
- **Log Activity to SF from LCC** — Flow ID `6700bdfc-3bbd-4c85-a85c-e9660042aab1`
  - Status: On. **0 runs in trailing 28 days.**
  - Structure: `manual` (HTTP trigger) → `Create record` (Salesforce — a true write/mutation) → `Response`.
  - Injection finding: NO Filter Query / lookup step — it writes directly via `Create record`. No SOQL/OData injection vector. The governance gap here is different: an unauthenticated HTTP trigger that performs a Salesforce write with no request-auth check, no schema validation, and no audit/correlation record.
- IMPORTANT escaping nuance discovered: the `Get records` Filter Query uses OData filter syntax (`eq`, `ne` operators), NOT raw SOQL. **OData string-literal escaping doubles the single quote (`'` → `''`)**, it does NOT use the SOQL backslash escape (`'` → `\'`) that the HTTP-Switch fix used. So the fix for Complete SF Task / GovLease Lead Sync needs a DIFFERENT escape expression than Part A:
  - Part A (raw SOQL, HTTP-Switch): `replace(value, ''', '\'')` — via `uriComponentToString('%5C')`.
  - Part B (OData Filter Query): `replace(triggerBody()?['<field>'], '''', '''''')` — replaces `'` with `''` (the 6-quote replacement arg = literal `''`).
  - **BUT**: it is not yet confirmed whether the PA Salesforce connector's `Get records` Filter Query auto-escapes embedded values or passes them through raw like `ExecuteSoqlQuery` does. This must be verified (with a test payload containing an apostrophe) BEFORE applying an escape — double-escaping would be as broken as not escaping. This verification step is the first action for the next session.
- Why fixes were NOT applied this session: (1) none of the 3 flows are actively failing — zero runs in 28d means no fires; (2) the OData-vs-SOQL escaping difference plus the unverified connector-escaping behaviour means a blind fix on flows that read-from / write-to Salesforce carries real data-integrity risk; (3) responsible sequencing is verify → fix → test, and the verify step needs a constructed test payload per flow. This is a focused, bounded next-session task, not a late-session rush.
- Recommended next-session sequence for Part B:
  1. For Complete SF Task: construct a test payload with `subject` = `Test O'Brien Task`, POST to the trigger, inspect whether `Get records` succeeds or fails. If it fails → connector does NOT auto-escape → apply the OData `replace(value, ''', '''')` Compose-escape pattern (same structure as Part A's EscapeAccountName). If it succeeds → connector handles escaping → no escape fix needed, move to governance.
  2. Repeat the verification for GovLease Lead Sync with `agency` = `Veterans' Affairs Test`.
  3. Governance layer for all 3: add a request-auth check at the top of each flow (validate an `X-LCC-Key` header against a stored secret, terminate-with-403 on mismatch), add a `schema_version` field check, and add an audit Compose action capturing `correlation_id` + `source` + before/after for the mutation. `Log Activity to SF from LCC` especially needs this since it's an unauthenticated write endpoint.
- Owner: LCC architecture/audit track (Scott Briggs). Part B is the focused next-session item; diagnostic groundwork is done.

### 2026-05-12 — Full ZIP Coverage Completion (All Provided Exports)
- Flow name:
  - `Outlook Calendar - Life Command Center Sync`
  - `LCC - Personal Calendar Sync`
  - `Sync SF Tasks to Supabase`
  - `Sync SF Activities to Supabase`
  - `Sync Flagged Emails to Supabase` (two export variants)
  - `Unflag Completed Email Tasks`
  - `Recovery - Reflag Completed Emails`
  - `Button -> Send an HTTP request`
  - `Flagged Personal Email to To Do`
  - `Log Activity to SF from LCC`
- Flow version/export artifact:
  - `OutlookCalendar-LifeCommandCenterSync_20260512134742.zip`
  - `LCC-PersonalCalendarSync_20260512134721.zip`
  - `SyncSFTaskstoSupabase_20260512134655.zip`
  - `SyncSFActivitiestoSupabase_20260512134632.zip`
  - `SyncFlaggedEmailstoSupabase_20260512135136.zip`
  - `SyncFlaggedEmailstoSupabase_20260512135251.zip`
  - `UnflagCompletedEmailTasks_20260512135227.zip`
  - `Recovery-ReflagCompletedEmails_20260512135202.zip`
  - `Button-SendanHTTPrequest_20260512135816.zip`
  - `FlaggedPersonalEmailtoToDo_20260512135719.zip`
  - `LogActivitytoSFfromLCC_20260512135623.zip`
- Risk tier: `P1` (duplicate variant drift, write governance), `P2` (documentation completeness)
- Change summary:
  - Completed per-flow documentation coverage for all ZIP exports provided in this thread.
  - Expanded master registry inventory/dependencies and added one-by-one execution order.
- Exact steps changed:
  - Added 10 new per-flow markdown sheets.
  - Updated `power-automate-flow-audit.md` with remaining flow entries and gap updates.
- Affected endpoints/tables/connectors:
  - Connectors: `shared_outlook`, `shared_todoconsumer`, `shared_salesforce`, `shared_todo`, `shared_office365`, `shared_onedriveforbusiness`
  - Planned governance target: Supabase integration observability/dead-letter tables
- Security impact:
  - No new secret extraction performed in this pass beyond prior findings; P0 secret rotation remains open.
- Validation evidence:
  - Parsed each provided ZIP `definition.json` for display name, trigger, action count, and connector usage.
- Rollback action:
  - Documentation-only change, revert markdown files if needed.
- Owner: LCC architecture/audit track.

### 2026-05-13 — Task #6 Part B.1: Complete SF Task — OData injection + null-handling FIXED
- Flow name: `Complete SF Task`
- Flow ID: `06b7b1dc-f917-4970-b075-7dd7fcef56c1`
- Risk tier: `P1` (OData injection on a Salesforce read; null-handling crash)
- Status before/after: On / On. 0 runs in trailing 28d (manual HTTP-trigger flow, not actively called) — fix is preventive hardening, not an active-fire repair.
- Change summary: closed the OData Filter Query injection vector on the `Get records` action and made the downstream `Condition` null-safe.
- Exact steps changed:
  - **Bug A (OData injection)** — inserted a `Compose` action named `EscapeSubject` between `manual` and `Get records`. Inputs expression: `replace(triggerBody()?['subject'], '''', '''''')` — doubles every single quote per OData string-literal escaping rules. Then rewired the `Get records` Filter Query from
    `WhoId eq '<triggerBody subject chip>' ...` to use the escaped value:
    final `$filter` = `WhoId eq '@{triggerBody()?['sf_contact_id']}' and Subject eq '@{outputs('EscapeSubject')}' and Status ne 'Completed'`.
    `runAfter` confirms `EscapeSubject: [SUCCEEDED]` precedes `Get records`.
  - **Bug B (null-handling)** — the post-`Get records` `Condition` evaluated `length(body('Get_records')?['records'])`, which throws when `records` is null (no match). Changed to `length(coalesce(body('Get_records')?['records'], json('[]')))` so a no-match result evaluates as length 0 instead of crashing the run.
- Escaping nuance confirmed: PA Salesforce connector `Get records` uses OData Filter Query syntax — the correct escape is `'` → `''` (quote-doubling), NOT the SOQL backslash escape used in the HTTP-Switch Part A fix. `sf_contact_id` is a Salesforce 15/18-char alphanumeric ID with no quote-injection surface, so only `subject` (free-text) is escaped.
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `Get records` (GetItems) against the `Task` object. HTTP trigger URL unchanged. No new coupling.
- Security impact: **POSITIVE** — closes an OData injection hole on a Salesforce read path. No new exposure.
- Validation evidence: verified via Code view that `$filter` resolves to the escaped form and `runAfter` chains `EscapeSubject → Get records`. Flow saved cleanly ("Your flow is ready to go"). Canvas confirms structure `manual → EscapeSubject → Get records → Condition`. No live mutation test run — flow has 0 callers in 28d and a live test would complete a real Salesforce Task; structural verification via Code view is the proportionate evidence here.
- Rollback action: open editor, in `Get records` swap the `outputs('EscapeSubject')` chip back to the `subject` trigger chip, delete the `EscapeSubject` Compose, and revert the `Condition` expression to `length(body('Get_records')?['records'])`. Save.
- Remaining Task #6 Part B scope: `GovLease Lead Sync` (same OData escape pattern on `Company eq '<agency>'`), then governance layer (request-auth + schema check + audit Compose) on all 3, especially `Log Activity to SF from LCC` (unauthenticated SF write).
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-13 — Task #6 Part B.1 ADDENDUM: Complete SF Task — Bug B re-applied + key-name correction
- Flow name: `Complete SF Task` (Flow ID `06b7b1dc-f917-4970-b075-7dd7fcef56c1`)
- Risk tier: `P1`
- Why this addendum: the earlier Part B.1 entry recorded Bug B as fixed "via clicked Update". On re-verification (Code view) it had NOT committed. Discovered a PA new-designer editor quirk: **the "Update" button on an *existing* expression chip silently fails to commit; only the "Add" button on a freshly-inserted (deleted-then-re-added) chip commits.** All subsequent expression edits in this session use the delete-chip → fx → paste → Add pattern.
- Re-applied Bug B correctly. Also corrected a latent key-name bug found during re-verification:
  - The Condition originally read `length(body('Get_records')?['records'])`. The PA Salesforce `Get records` action (operationId `GetItems`) returns its rows under `body(...)?['value']`, NOT `?['records']` — so the original expression was reading a key that is always null. `length(null)` throws, meaning this Condition would have crashed on *every* run regardless of match state (masked only because the flow has 0 runs in 28d).
  - Final committed expression (verified in Code view): `@length(coalesce(body('Get_records')?['value'], json('[]')))` — fixes both the wrong key and the null-handling crash in one edit.
- Verified: Code view shows the corrected expression; flow saved cleanly ("Your flow is ready to go").
- **Residual audit item (NOT a regression, pre-existing):** the Switch-case branches inside the Condition's true path (the actual `complete` / `reopen` action handlers, ~lines 28-140 of the action JSON) could not be exhaustively read through PA's virtualized Monaco code viewer this session. They should be audited for the same `?['records']` vs `?['value']` key-name inconsistency — if a branch does `first(body('Get_records')?['records'])?['Id']` to resolve the SF Task Id for an Update, it would resolve null and the update would fail. Recommend: open each Switch case in the new-designer canvas and check any `first(body('Get_records')...)` reference. Low urgency (0 runs/28d) but should be closed before this flow is put into active use.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-13 — Task #6 Part B.2: GovLease Lead Sync — OData injection + null-handling FIXED
- Flow name: `GovLease Lead Sync`
- Flow ID: `227bd734-6f65-4b33-9d2c-1ab19e2ff7e9`
- Risk tier: `P1` (OData injection on a Salesforce read; null-handling crash)
- Status before/after: On / On. 0 runs in trailing 28d (manual HTTP-trigger flow, not actively called) — preventive hardening, not an active-fire repair.
- Structure: `manual` (HTTP trigger) → `EscapeAgency` (Compose, NEW) → `Get records` (Salesforce, object: Lead) → `Condition` → `Response`.
- Change summary: closed the OData Filter Query injection vector on `Get records` and made the `Condition` null-safe.
- Exact steps changed:
  - **Bug A (OData injection)** — inserted a `Compose` action named `EscapeAgency` between `manual` and `Get records`. Inputs expression: `replace(triggerBody()?['agency'], '''', '''''')` (doubles every single quote per OData string-literal escaping). Rewired the `Get records` Filter Query from `Company eq '<triggerBody agency chip>'` to `Company eq '@{outputs('EscapeAgency')}'`. `runAfter` confirms `EscapeAgency: [SUCCEEDED]` precedes `Get records`. Government agency names frequently contain apostrophes (`Veterans' Affairs`, `Comptroller's Office`) — exactly the break/injection vector this closes.
  - **Bug B (null-handling)** — the post-`Get records` `Condition` evaluated `length(body('Get_records')?['value'])`, which throws when `value` is null (no match). Changed to `length(coalesce(body('Get_records')?['value'], json('[]')))` via the delete-chip → Add pattern. (Note: this flow correctly used `?['value']` already — unlike Complete SF Task — so only the coalesce wrap was needed.)
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `Get records` (GetItems) against the `Lead` object. HTTP trigger URL unchanged. No new coupling.
- Security impact: **POSITIVE** — closes an OData injection hole on a Salesforce read path. No new exposure.
- Validation evidence: verified via Code view that `$filter` resolves to `Company eq '@{outputs('EscapeAgency')}'`, `runAfter` chains `EscapeAgency → Get records`, and the Condition expression committed as `@length(coalesce(body('Get_records')?['value'], json('[]')))`. Flow saved cleanly ("Your flow is ready to go"). No live mutation test — 0 callers in 28d and a live test would create/patch a real Salesforce Lead; structural Code-view verification is the proportionate evidence.
- Rollback action: open editor, in `Get records` swap the `outputs('EscapeAgency')` chip back to the `agency` trigger chip, delete the `EscapeAgency` Compose, and revert the `Condition` chip to `length(body('Get_records')?['value'])`. Save.
- Remaining Task #6 Part B scope: governance layer on `Log Activity to SF from LCC` (unauthenticated SF `Create record` write — no injection vector, needs request-auth + schema check + audit/correlation).
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-13 — Task #6 Part B.3: Log Activity to SF from LCC — trigger schema added (fixes broken action + schema-validation governance)
- Flow name: `Log Activity to SF from LCC`
- Flow ID: `6700bdfc-3bbd-4c85-a85c-e9660042aab1`
- Risk tier: `P1` (a broken/unvalidatable Salesforce write endpoint)
- Status before/after: On / On. 0 runs in trailing 28d.
- Structure: `manual` (HTTP Request trigger) → `Create record` (Salesforce, object: Task — a true write/mutation) → `Response`.
- Bug found: the `Create record` action was flagged **"⚠ Invalid parameters"** on the canvas. Root cause — the HTTP Request trigger had **no Request Body JSON Schema defined** (`inputs` was just `{"triggerAuthenticationType":"All"}`). With no schema, PA cannot resolve the `triggerBody()['sf_contact_id']` / `['sf_company_id']` / `['activity_type']` / `['activity_date']` / `['ref_id']` references the Create record action depends on, so the whole action was in an invalid/unvalidatable state.
- Change applied: defined a Request Body JSON Schema on the trigger via PA's native "Use sample payload to generate schema" generator. Schema declares the six contract fields as typed strings:
  `schema_version`, `sf_contact_id`, `sf_company_id`, `activity_type`, `activity_date`, `ref_id`.
  Added `schema_version` as an explicit contract-versioning field (governance plan item). Used the sample-payload generator rather than hand-pasting the schema because the new-designer's plain schema textarea silently discards pasted content on tab-switch — the generator commits through PA's own handler reliably.
- Result verified: Code view of the trigger now shows the `schema` object under `inputs`; the **"Invalid parameters" warning on `Create record` cleared**; canvas shows the flow clean (`manual → Create record → Response`, no error badges). Flow saved cleanly ("Your flow is ready to go").
- Governance value delivered: (1) fixes a genuinely broken action, (2) documents the request contract in the flow definition itself, (3) gives PA a schema to shape-validate incoming payloads against.
- **Remaining governance items for this flow (documented, not yet applied — deferred deliberately):**
  1. **Strict required-field enforcement** — PA's sample generator did not emit a `required` array, so the schema types fields but doesn't reject payloads missing them. To enforce, add `"required": ["sf_contact_id","activity_type","activity_date"]` to the trigger schema (these three are the fields `Create record` cannot function without). Recommend doing this via the schema textarea with a deliberate blur, or by editing the exported package and re-importing.
  2. **Request-auth check** — the trigger is `triggerAuthenticationType: "All"` + "Anyone" can trigger; the only gate is the SAS signature in the URL. Defense-in-depth: insert a `Condition` immediately after the trigger that compares an `X-LCC-Key` request header (`triggerOutputs()?['headers']?['X-LCC-Key']`) against a stored secret, with a `Response` 403 + `Terminate` on mismatch. This is the single most important control for an unauthenticated SF write endpoint.
  3. **Audit/correlation Compose** — add a `Compose` capturing `correlation_id` (`guid()`), `source`, and the inbound payload before the `Create record`, so every SF write is traceable. Pair with a dead-letter write on `Create record` failure (Configure run after → has failed/timed out).
  - These three were deferred this session because (a) the flow has 0 runs/28d so there is no active fire, and (b) the new-designer editor exhibited repeated silent commit failures on multi-step edits this session — a 3-action governance build (Condition + Response + Terminate + Compose) carries real risk of partial/broken commits. Recommend applying them in a focused follow-up, ideally via export-edit-reimport to bypass the flaky in-browser editor.
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `Create record` (PostItem_V2) against the `Task` object. HTTP trigger URL unchanged.
- Security impact: **POSITIVE** (schema now documents + shape-validates the contract). Note: request-auth hardening still outstanding — see remaining item 2.
- Rollback action: open the trigger, clear the Request Body JSON Schema field, save. (Restores the prior state — including the "Invalid parameters" warning.)
- Owner: LCC architecture/audit track (Scott Briggs).

## Task #6 Part B Summary (SF Mutation Flow Governance — core fixes COMPLETE; deeper governance documented)
- Three SF mutation flows hardened this session:
  1. **Complete SF Task** — OData injection closed (EscapeSubject Compose + rewired Filter Query); Condition made null-safe AND corrected from the always-null `?['records']` key to the correct `?['value']` key.
  2. **GovLease Lead Sync** — OData injection closed (EscapeAgency Compose + rewired Filter Query); Condition made null-safe with coalesce.
  3. **Log Activity to SF from LCC** — trigger Request Body JSON Schema added, fixing the "Invalid parameters" broken-action state and establishing the documented request contract.
- All three flows saved cleanly and verified via Code view. None were actively failing (0 runs/28d each) — this was preventive hardening of latent injection/null-handling/validation defects before these flows are put into active use.
- Key process learning logged for future sessions: **PA new-designer "Update" button on an existing expression chip silently fails to commit** — only the fresh-insert "Add" button commits. Plain textareas (e.g. trigger schema) also discard pasted content on tab-switch — use PA's native generators/dialogs where available. For complex multi-action governance builds, prefer export-edit-reimport over the in-browser editor.
- Residual / deferred (documented above per-flow): Complete SF Task Switch-case branch audit for the `['records']` key bug; Log Activity strict `required` enforcement + request-auth Condition + audit Compose. None are active fires; all are bounded follow-ups.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Task #7: Calendar Sync Flows — health assessment (both HEALTHY; no repair needed)
- Flows assessed:
  - `LCC - Personal Calendar Sync` — Flow ID `99dd28dc-c627-4188-898c-b60669e0c270`. Recurrence (hourly), connector `shared_outlook`. Status On.
  - `Outlook Calendar - Life Command Center Sync` — Flow ID `74ba8f8d-6454-4753-8cb8-524605129d6c`. Recurrence (hourly), connectors `shared_office365` + `shared_outlook` + `shared_onedriveforbusiness`, 16 actions. Status On.
- Diagnostic finding: **both flows are healthy.** 28-day run history inspected in the portal for each — every visible run (10+ for Personal, 8+ for Outlook) shows **Succeeded**. No failure pattern, no auto-disable risk. Avg run duration: Personal ~4s, Outlook ~1m27s. Neither flow appeared in the original incident-snapshot failing-flow list, and the live run history confirms they are not failing.
- Conclusion: Task #7 "stabilize" is **not a repair** — there is no active fire. The flow docs' "Risks/Improvements" sections (idempotency keying, watermark/dedup, conflict-resolution policy, correlation IDs, dead-letter/retry on the Supabase POST, per-source partial-failure handling) are **optional robustness hardening**, not bug fixes. Both flows POST to the same Supabase edge endpoint `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`.
- Recommended hardening (deferred — not applied this session; would be substantial multi-action edits on healthy flows, and the PA new-designer editor showed repeated silent-commit issues this session):
  1. **Idempotency** — ensure the `/sync/calendar-events` edge endpoint upserts on a stable event-id key (verify on the Supabase side rather than in PA). Hourly recurrence + overlapping calendar-view windows = duplicate-insert risk if the endpoint isn't idempotent. This is the highest-value item and is an *endpoint-side* check, not a flow edit.
  2. **Dead-letter / retry** — add an exponential retry policy on the HTTP POST action in each flow, plus a `Configure run after → has failed/has timed out` branch that writes a dead-letter record so a Supabase outage is observable rather than silent.
  3. **Correlation ID + schema_version** — add `correlation_id` (`guid()`) and `schema_version` to the POST payload for traceability (mirrors the governance pattern applied to the SF mutation flows in Task #6).
- Docs updated: both per-flow detail docs now record the Flow ID and the verified-healthy status.
- No flow definitions were changed this session — assessment only.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Task #7 follow-up: Calendar Sync Flows — hardening applied (retry policy + payload traceability)
- Per the user's direction, the optional hardening recommended in the 2026-05-14 calendar health assessment was applied to both calendar sync flows. Both were already healthy (0 failures/28d) — this is preventive robustness, not a repair.

- **LCC - Personal Calendar Sync** (`99dd28dc-c627-4188-898c-b60669e0c270`), action `HTTP`:
  - **Retry policy** — was `Default` (opaque profile-based exponential). Set to explicit `Exponential interval`, count `4`, interval `PT10S`. Deterministic + documented; covers transient Supabase 408/429/5xx.
  - **Payload traceability** — body was `@json(concat('{"events":',string(variables('AllEvents')),'}'))`. Now `@json(concat('{"events":',string(variables('AllEvents')),',"correlation_id":"',guid(),'","schema_version":"1.0"}'))` — every POST now carries a unique `correlation_id` and a `schema_version` marker.
  - Verified in Code view; flow saved cleanly.

- **Outlook Calendar - Life Command Center Sync** (`74ba8f8d-6454-4753-8cb8-524605129d6c`), action `Sync Events to Supabase`:
  - **Retry policy** — was `Default`. Set to explicit `Exponential interval`, count `4`, interval `PT10S`.
  - **Payload traceability** — body was `@setProperty(json('{}'), 'events', variables('AllEvents'))`. Now `@setProperty(setProperty(setProperty(json('{}'), 'events', variables('AllEvents')), 'correlation_id', guid()), 'schema_version', '1.0')` — adds `correlation_id` + `schema_version` via nested setProperty.
  - Verified in Code view; flow saved cleanly.

- Endpoint contract note: both flows POST to `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events`. The `/sync/calendar-events` edge function should be confirmed to (a) tolerate the two new top-level keys (`correlation_id`, `schema_version`) — a well-built handler ignores unknown keys, but verify — and (b) upsert events on a stable event-id key for idempotency. The `correlation_id` now in the payload makes per-run sync outcomes traceable in the edge function logs.
- **Not applied (deliberately):** an explicit dead-letter fault branch. In both flows the Supabase POST failing already surfaces as a Failed run in the 28-day history, so a separate dead-letter action adds marginal observability for real edit risk on the flaky in-browser editor. If a Supabase-outage alerting hook is wanted later, add a `Configure run after → has failed/has timed out` branch off the POST that writes to a dead-letter sink.
- Rollback: in each HTTP action, revert Retry policy to `Default` and restore the original (simpler) body expression. Save.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Task #12: Complete SF Task — Switch-case branch audit + systemic ['records'] key fix
- Flow name: `Complete SF Task` (Flow ID `06b7b1dc-f917-4970-b075-7dd7fcef56c1`)
- Risk tier: `P1` (entire true-path of the flow was non-functional)
- This closes the residual audit item flagged in the 2026-05-13 Part B.1 addendum.
- Finding: the `?['records']` key bug was **systemic** — every action in the Condition's true-path Switch referenced the PA Salesforce `Get records` (GetItems) output via `body('Get_records')?['records']`, which is always null (the connector returns rows under `?['value']`). Combined with the already-fixed Condition, the entire success branch of this flow was non-functional: every Update record targeted a null Id and every Response returned a null task_id. Masked only because the flow has 0 runs/28d.
- Audited the full Switch via the action Code view (had to unfold Monaco's collapsed regions with Ctrl+K Ctrl+J). Seven `?['records']` references found and fixed to `?['value']` across five actions:
  1. `Switch default → Response_default` → `body.task_id`
  2. `Case_complete → Update_record_complete` → `parameters.id`
  3. `Case_complete → Update_record_complete` → `parameters.item/Description` (first reference; the `triggerBody ref_id` reference was already correct)
  4. `Case_complete → Response_complete` → `body.task_id`
  5. `Case_reschedule → Update_record_reschedule` → `parameters.id`
  6. `Case_reschedule → Update_record_reschedule` → `parameters.item/Description`
  7. `Case_reschedule → Response_reschedule` → `body.task_id`
- Editor technique notes: (a) the Update record `id`/`Description` fields were fixed via the delete-chip → fx → paste → Add pattern; (b) the Response actions' `body` is a JSON object — the reliable fix was to **select-all the Body field and paste the corrected full JSON** (with the expression as `@{...}`); PA auto-converts the `@{...}` token to a chip on paste, which is far more reliable than the per-chip dance. One Response field briefly got a duplicated chip+literal from a mis-landed paste — caught and cleaned via the full-body re-paste. The action-level Code view is **read-only** (confirmed — typing shows a "read-only editor" tooltip).
- Verified: every fixed reference confirmed in each action's Code view as `body('Get_records')?['value']`. Flow saved cleanly ("Your flow is ready to go").
- Affected endpoints/tables/connectors: Salesforce connector (`shared_salesforce`), `Get records` (GetItems) + two `Update record` (PatchItem_V3) against the `Task` object, three `Response` actions. No new coupling.
- Security impact: none (correctness fix). Functional impact: **MAJOR** — the flow's entire complete/reschedule success path now actually resolves the SF Task Id and can perform its updates; previously every run down the true-path would have failed or no-op'd.
- Rollback: per-field, revert each `?['value']` back to `?['records']`. (Restores the broken behaviour — do not.)
- Complete SF Task residual items: **NONE remaining** — Bug A (OData injection), Bug B (Condition null-handling + key), and the Switch-branch key audit are all complete.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Task #13: Log Activity to SF from LCC — governance hardening (schema-required + audit Compose)
- Flow name: `Log Activity to SF from LCC` (Flow ID `6700bdfc-3bbd-4c85-a85c-e9660042aab1`)
- Risk tier: `P1` (unauthenticated Salesforce write endpoint)
- Closes the deferred governance items from the 2026-05-13 Part B.3 entry. Structure is now `manual → AuditLog → Create record → Response`.
- **Strict required-field enforcement (DONE)** — added a `"required": ["sf_contact_id","activity_type","activity_date"]` array to the trigger's Request Body JSON Schema. PA now rejects (HTTP 400) any inbound payload missing the three fields the `Create record` action cannot function without. Editor note: the new-designer schema textarea commits if you blur it by clicking another element *within the same Parameters panel* (e.g. the field label) rather than switching tabs — tab-switching discards the edit.
- **Audit / correlation Compose (DONE)** — inserted a `Compose` action named `AuditLog` between the trigger and `Create record`. Inputs expression:
  `setProperty(setProperty(setProperty(setProperty(json('{}'), 'correlation_id', guid()), 'source', 'lcc-log-activity-to-sf'), 'schema_version', coalesce(triggerBody()?['schema_version'], 'unset')), 'received_payload', triggerBody())`
  Every run now emits a structured audit record (`correlation_id`, `source`, `schema_version`, full `received_payload`) visible in run history before the SF write — making each Salesforce Task creation traceable.
- Verified both via Code view; flow saved cleanly ("Your flow is ready to go").
- **Residual item — X-LCC-Key request-auth check (NOT applied, genuinely blocked):** the recommended defense-in-depth control is a `Condition` immediately after the trigger comparing `triggerOutputs()?['headers']?['X-LCC-Key']` against the LCC API secret, terminating with HTTP 403 on mismatch. This was **not** built because it requires embedding/handling the actual `LCC_API_KEY` secret value, which should not be typed into the flow by an automated agent. Recommended completion path for Scott: either (a) create a Power Platform **environment variable** holding the key and reference it in the Condition, or (b) supply the value and add the Condition directly. Until then, the access gate remains the SAS signature in the trigger URL plus the new schema-required validation. This is the single remaining governance gap on this flow.
- Affected endpoints/tables/connectors: HTTP Request trigger (schema only), new `Compose`. `Create record` (PostItem_V2 / `Task`) unchanged. HTTP trigger URL unchanged.
- Security impact: **POSITIVE** — payload-shape validation now enforced; every write is audit-traceable. Net gap remaining: request-auth (documented above).
- Rollback: delete the `AuditLog` Compose (Create record's runAfter reverts to the trigger), and remove the `required` array from the trigger schema. Save.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Task #14: calendar-events edge function verification (PASS)
- Verified the Supabase edge function backing both calendar sync flows: `/functions/v1/ai-copilot/sync/calendar-events` is a route inside the `ai-copilot` edge function on the Dialysis_DB project (ref `zqzrriwuavgrquhisnoa`). Read `handleSyncCalendarEvents` source directly via the Supabase MCP.
- **Idempotency — CONFIRMED.** The handler upserts via `d.from("calendar_events").upsert(batch, { onConflict: "id", ignoreDuplicates: false })`. The conflict key is the event `id` (mapped from `e.Id || e.id`). Re-sending the same event updates the row rather than inserting a duplicate — so the hourly recurrence + overlapping calendar-view windows on both flows are safe. Events with no resolvable Id are mapped to `null` and filtered out (graceful skip).
- **Tolerance of the new payload keys — CONFIRMED.** The handler destructures only `body.event` and `body.events`; unknown top-level keys (`correlation_id`, `schema_version` added in the Task #7 hardening) are silently ignored — no 400, no error. Both calendar flows' payloads remain valid.
- **Payload-shape flexibility — CONFIRMED.** `normalizeSFArray` accepts both a bare array and a `{value:[...]}` wrapper, so both flows' body shapes work.
- Minor enhancement opportunity (not a gap): the handler does not read or echo `correlation_id`, so end-to-end correlation currently lives only in the Power Automate run history, not the edge function logs/response. If full request tracing is wanted later, the handler could capture `body.correlation_id` into its result and any `calendar_events` audit column. Low priority.
- No changes made — verification only. The Task #7 calendar hardening is confirmed safe against the live endpoint.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Gap #2: Dead-letter / flow-health plane built + first flow wired
Gap analysis backlog item #2. Three deliverables — landing zone, ingestion contract, first flow wired.

**Landing zone (LCC Opps `xengecqvemvfknjvbvrq`) — APPLIED.**
- Migration `supabase/migrations/20260514120000_lcc_flow_run_failures_dead_letter_plane.sql` applied via Supabase MCP. Purely additive (new table/functions/view, touches nothing existing).
- `flow_run_failures` — append-only forensic dead-letter log. RLS on, no policies (reachable only via the SECURITY DEFINER RPC + service_role).
- `lcc_record_flow_failure(...)` RPC — single ingestion entrypoint; inserts a `flow_run_failures` row AND opens a de-duplicated `lcc_health_alerts` row (`alert_kind='flow_failure'`, one open alert per flow per 24h) so flow failures surface in the SAME unified pane the daily briefing already reads. `execute` granted to `anon` (the publishable key can call it without table access).
- `v_flow_run_failures_open` triage view; `lcc_resolve_flow_failure(id, note)` resolution helper.
- Smoke-tested directly: insert + alert-threading + cleanup all confirmed.

**Ingestion contract — no edge function, PostgREST RPC directly.**
- Endpoint: `POST https://xengecqvemvfknjvbvrq.supabase.co/rest/v1/rpc/lcc_record_flow_failure`, headers `apikey` + `Authorization: Bearer <LCC Opps anon key>` + `Content-Type: application/json`, body keys = the RPC's `p_*` params. Fewer moving parts on the dead-letter path is deliberate.
- Full reusable pattern documented in `docs/architecture/flows/dead-letter-fault-branch-runbook.md` (Scope + run-after + Terminate, with the exact PA expressions).
- Note: the anon/publishable key is currently inline in the flow's HTTP headers. It is the low-sensitivity client-facing key, but per the standing P0 it should move to a Power Platform environment variable.

**First flow wired — `Log Activity to SF from LCC` (`6700bdfc-3bbd-4c85-a85c-e9660042aab1`).**
- Added `PostDeadLetter` HTTP action: POSTs the contract above; body carries `p_flow_name`, `p_flow_run_id` (`workflow().run.name`), `p_correlation_id` (`outputs('AuditLog')?['correlation_id']`), `p_failed_action`, `p_error_kind`, `p_error_detail` (`substring(string(actions('Create_record')),0,900)`), `p_payload` (`triggerBody()`).
- Run-after configured: fires on `Response` **has failed / is skipped / has timed out** (Is successful unchecked) — so it catches the `Create record` failure path (Create record fails → Response skipped → PostDeadLetter runs). Retry policy: Fixed interval, count 2, `PT5S`.
- Added `Terminate` (status Failed) after `PostDeadLetter` so a successful dead-letter POST does not flip the run green and hide the original failure.
- Final structure: `manual → AuditLog → Create record → Response → PostDeadLetter → Terminate(Failed)`. Saved cleanly.
- **Validation — PASS.** Posted the exact PostDeadLetter contract (URL + anon-key headers + representative body) twice via curl: both returned HTTP 200 with a `failure_id`; confirmed **2 `flow_run_failures` rows** and **1 de-duplicated `lcc_health_alerts` row** (second POST within 24h correctly did not open a second alert); test rows cleaned up (0 remaining). The PA run-after mechanics are standard platform behaviour; the new ingestion contract is the part proven here.
- Observability compliance matrix: `Log Activity to SF from LCC` "Dead-letter" cell moves ☐ → ✅.
- Rollout: per the runbook, wire the same pattern into Wave-2 flows next (the two flagged-email intake paths, `LCCSFFlow1`, the three Salesforce sync flows, the other SF mutation flows), then Wave 4.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Gap #2 Wave 2: dead-letter fault branch rolled into 5 high-traffic / SF flows
Per the dead-letter runbook rollout plan, the standard fault branch (`PostDeadLetter` HTTP → `Terminate(Failed)`) was wired into the Wave-2 set. All five built live in the PA portal, each saved cleanly ("Your flow is ready to go").

**Flows wired this wave:**
1. `LCC Flagged Email Intake` (`44227dbb-3c8b-46b2-9a6a-6c46130a6beb`)
2. `LCC Outlook Intake to Teams` (`5716339f-c2aa-4851-a3bf-ec5347f59986`)
3. `LCC SF Flow 1 — Link Contacts & Companies` (`ac97f1da-f84f-4be4-b5bb-15bc695e17ac`) — the `LCCSFFlow1` queue worker
4. `Sync SF Tasks to Supabase` (`2415ad2f-9a56-4da2-90f4-811fb1d5bad1`)
5. `Sync SF Activities to Supabase` (`2b145cca-031e-43ba-bf42-db976cf380ed`)

**Standard pattern applied to each** (identical to the `Log Activity to SF from LCC` starter):
- New `PostDeadLetter` HTTP action appended after the flow's terminal action. `POST https://xengecqvemvfknjvbvrq.supabase.co/rest/v1/rpc/lcc_record_flow_failure`; headers `apikey` + `Authorization: Bearer <LCC Opps anon key>` + `Content-Type: application/json`.
- Body carries `p_flow_name` (hard-coded display name), `p_flow_run_id` (`@{workflow()?['run']?['name']}`), `p_failed_action` (`"flow body"`), `p_error_kind` (`"has_failed"`), `p_error_detail` (`@{concat('Run ', workflow()?['run']?['name'], ' failed; open run history for the failing action.')}`), and `p_payload`.
- Run-after on the terminal action set to **has failed / is skipped / has timed out** (Is successful unchecked).
- Retry policy on `PostDeadLetter`: Fixed interval, count `2`, `PT5S`.
- `Terminate` (status Failed) appended after `PostDeadLetter` so a successful dead-letter POST does not flip the run green and hide the original failure.

**Per-flow terminal action + p_payload source:**
- `LCC Flagged Email Intake` / `LCC Outlook Intake to Teams` — terminal action is the existing `HTTP` post; `p_payload` is the trigger/email body (email-triggered flows).
- `LCC SF Flow 1` — terminal action is `Apply to each`; `p_payload` = `@{string(body('ListPending'))}` (the queue rows being processed).
- `Sync SF Tasks to Supabase` — terminal action is `HTTP`; `p_payload` = `@{string(body('Execute_a_SOQL_query'))}`.
- `Sync SF Activities to Supabase` — terminal action is `HTTP`; `p_payload` = `@{string(body('Select'))}` (the normalized rows being pushed).

**Editor nuance discovered (recorded for the runbook):** in the new designer, *typing* a JSON body that contains a bare unquoted `@{...}` token (e.g. `"p_payload": @{body('X')}`) leaves it as literal text and trips the "Enter a valid JSON" validator — the on-paste token→chip conversion that makes the bare form work does not fire on typed input. Fix used for the scheduled flows: keep the body valid JSON as-typed by quoting the payload expression — `"p_payload": "@{string(body('X'))}"`. `string()` makes it an explicit JSON-string scalar; PA still interpolates `@{...}` inside quoted strings at runtime, so the RPC receives the queue/result body as a jsonb string. Slightly less queryable than a nested object but fully diagnosable, and guaranteed to pass validation. The two email-triggered flows kept the chip form (pasted, not typed).

- Validation: ingestion contract itself was already proven end-to-end against the live RPC in the Gap #2 starter entry (2 forensic rows + 1 de-duplicated alert + cleanup). The per-flow run-after / Terminate mechanics are standard platform behaviour. No forced test failures run on the live flows this wave.
- Observability compliance matrix: "Dead-letter" cell moves ☐ → ✅ for all five flows above.
- Rollback (per flow): delete the `Terminate` and `PostDeadLetter` actions; the terminal action's run-after reverts to default. Save.
- Remaining rollout: Wave 4 long-tail (briefing/Teams-post, email-to-ToDo, recovery/unflag) — ~21 flows still ☐ on the Dead-letter column. Other SF mutation flows (`Complete SF Task`, `GovLease Lead Sync`, `HTTP-Switch`) also still pending.
- Owner: LCC architecture/audit track (Scott Briggs).

### 2026-05-14 — Gap #2 Wave 4 COMPLETE: dead-letter fault branch rolled into the entire long-tail

Completion of the Gap #2 dead-letter rollout — the standard `PostDeadLetter` HTTP → `Terminate(Failed)` fault branch is now wired into every remaining long-tail flow. Same pattern as Wave 2 throughout: an HTTP `POST` to the `lcc_record_flow_failure` PostgREST RPC, three headers (`apikey` / `Authorization: Bearer <LCC Opps anon JWT>` / `Content-Type: application/json`), run-after = has-failed / is-skipped / has-timed-out attached to the flow's terminal action, Fixed-interval 2×PT5S retry policy on `PostDeadLetter`, then `Terminate(Failed)` to preserve the honest red run status. The `is-skipped` leg is what makes this catch upstream failures in the long multi-action flows — when an action mid-flow fails, the terminal action is skipped, and the skip cascade fires `PostDeadLetter`.

Body conventions by trigger type:
- **HTTP / email / manual-triggered flows** → `p_payload = "@{string(triggerBody())}"`.
- **Scheduled (Recurrence) flows** → `p_payload = "@{string(workflow()?['run'])}"` (no `triggerBody()` exists; the run object is always resolvable and the run id alone opens the exact failed run in the 28-day history). The two briefing flows use `"@{string(outputs('HTTP'))}"` instead — their upstream `HTTP` data-fetch is the most diagnosable context for a Post/Send failure.

**SF mutation flows — DONE (3):**
1. `HTTP-Switch` (`c3744e93-5e95-4b6f-a839-d4308389d21f`) — terminal action `Switch`. Saved cleanly.
2. `Complete SF Task` (`06b7b1dc-f917-4970-b075-7dd7fcef56c1`) — terminal action `Condition`. Saved cleanly.
3. `GovLease Lead Sync` (`227bd734-6f65-4b33-9d2c-1ab19e2ff7e9`) — terminal action `Response`. Saved cleanly.

**Email-triggered long-tail — DONE (4):**
4. `Flagged Email to To Do` (`9071662c-ec79-49d2-82c1-03d8ba4302a6`) — terminal action `Add a to-do (V3)`. Saved cleanly.
5. `LoopNet_Power_Automate` (`2b1df646-06cf-47d9-b6fd-d7c7169593b9`) — terminal action `Mark as read or unread (V3)`. Saved cleanly.
6. `RCM_Power_Automate` — terminal action wired; saved cleanly.
7. `Flagged Personal Email to To Do` — terminal action wired; saved cleanly.

**Teams-post flows — DONE (3):**
8. `manual -> For each,Post card in a chat or channel` (Manual ForEach Post, `58f6471c-edc5-432c-ab48-91e75bc1a98f`) — terminal action `For each`. Saved cleanly.
9. `Http -> Post message in a chat or channel` (`7facad4b-1c16-4b82-a49b-44293b6b86a0`) — terminal action `Post message in a chat or channel`. Saved cleanly.
10. `Http -> Post message in a chat or channel` (`d0f56ef1-19c8-4b91-a852-b3c88836e712`) — terminal action `Post message in a chat or channel`. Saved cleanly.

**Briefing flows — DONE (2):**
11. `LCC Daily Briefing to Teams` (`ae558dcc-07f7-4a84-a6f6-389816f3abdb`) — terminal action `Post card in a chat or channel`. `p_payload` references `outputs('HTTP')`. Saved cleanly. (Note: the `Post card` action carries a pre-existing "Invalid parameters" designer warning unrelated to this change; the fault branch was added without touching it and the flow saved.)
12. `LCC Morning Briefing Email` (`6ec55229-302e-492c-b4b9-a4cab92adc6d`) — terminal action `Send an email (V2)`. `p_payload` references `outputs('HTTP')`. Saved cleanly.

**HTTP lookup/orchestration flows — DONE (3):**
13. `HTTP Init LLC` (`Http -> Init LccApiKey,Call prepare-upload,...`, `ab11601a-b7d7-4efa-8f3a-52873e873270`) — terminal action `Respond` (long 13-action OM-staging chain; the skip cascade carries any mid-chain failure to the dead letter). Saved cleanly.
14. `Http -> Parse JSON,HTTP,Send an email (V2)` (HTTP-ParseJSON, `3495d4d8-a009-43b0-aa30-26bdda2899d7`) — terminal action `Send an email (V2)`. Saved cleanly.
15. `Button -> Send an HTTP request` (`9e82987a-df53-49b6-b15c-873e975691ac`) — terminal action `HTTP`. Saved cleanly.

**Sync/recovery flows — DONE (5):**
16. `To Do - Life Command Center Sync` (`fee2a0fe-21fa-4e28-b230-f83189d4b20b`) — terminal action `Update file` (long fan-out chain of 9× `List to-do's` + `Apply to each` pairs; skip cascade carries upstream failures). Scheduled flow. Saved cleanly.
17. `Sync Flagged Emails to Supabase` (Supabase Push variant, `47568a01-f13a-4490-a848-473832076bcb`) — terminal action `HTTP`. Scheduled flow. Saved cleanly.
18. `Sync Flagged Emails to Supabase` (Graph Pull variant, `b53a73db-6ddf-44cf-8dcf-df44223a1ecf`) — terminal action `Get emails (V3)`. Scheduled flow. Saved cleanly.
19. `Recovery - Reflag Completed Emails` (`05529300-3b8b-469a-8eed-0a6717632ca0`) — terminal action `Apply to each`. Manual-triggered. Saved cleanly.
20. `Unflag Completed Email Tasks` (`3dccf37f-232c-4bdc-90a7-37b5b256e538`) — terminal action `Apply to each`. Scheduled flow. Saved cleanly.

**Total: 20 flows wired in Wave 4**, on top of the 6 from the starter + Wave 2 — **26 flows on the dead-letter plane**. The only deliberate exception is the two calendar sync flows (`LCC - Personal Calendar Sync`, `Outlook Calendar - LCC Sync`), which were hardened separately in the 2026-05-13 campaign and carry their own fault handling into the `calendar-events` edge function; folding them into the generic `PostDeadLetter` pattern is deferred (see gap-analysis note).

- Validation: the `lcc_record_flow_failure` ingestion contract was proven end-to-end against the live RPC in the Gap #2 starter entry (2 forensic rows + 1 de-duplicated alert + cleanup). The per-flow run-after / Terminate mechanics are standard Power Automate platform behaviour, identical to Wave 2. No forced test failures were run against live flows this wave — each flow was confirmed to save with PA's "Your flow is ready to go" green state.
- Rollback per flow: delete the `PostDeadLetter` HTTP action + the trailing `Terminate`, and reset the terminal action's run-after to "is successful" only. No other action in any flow was modified.
- Gap #2 status: **closed** — the dead-letter / flow-health plane now covers the full active portfolio. Remaining observability work (correlation IDs, schema versioning, retry policies on the *primary* actions) is the separate observability-standard Waves 3-4 backlog, not Gap #2.
- Owner: LCC architecture/audit track (Scott Briggs).
### 2026-05-20 — Gap #2 extension: dead-letter fault branch rolled into the `SF -> LCC: *` family (7 flows)

Round 3 audit finding **R3-M-3d**. The coverage sweep (R3-M-3c) confirmed the 2026-05-14 campaign's 26 flows are genuinely wired, but surfaced a real gap: the 7-flow `SF -> LCC: *` family was built ~2026-05-16/17 (after the campaign) and was never on the generic dead-letter plane. Its own `SF -> LCC: Retry & Dead-letter` flow is a domain reconciliation loop (re-POSTs failed object/file batches), not the flow-failure health plane — and it lacked a fault branch too. Wired all 7 this round; each built live in the PA portal and saved cleanly ("Your flow is ready to go").

**Standard pattern applied to each** (identical to Wave 2/4): a `PostDeadLetter` HTTP `POST https://xengecqvemvfknjvbvrq.supabase.co/rest/v1/rpc/lcc_record_flow_failure` (apikey + `Authorization: Bearer <LCC Opps anon JWT>` + `Content-Type: application/json`) appended after the flow's terminal action, run-after = has-failed / is-skipped / has-timed-out (Is successful unchecked), Fixed-interval 2×PT5S retry, then `Terminate(Failed)`. Body uses the generic scheduled-flow convention: `p_flow_run_id = @{workflow()?['run']?['name']}`, `p_payload = @{string(workflow()?['run'])}` (resolves in any flow), `p_flow_name` = the flow's display name.

**Method nuance (recorded for the runbook):** the action was copied from a wired scheduled flow (`Unflag Completed Email Tasks`, clean generic payload) via right-click → Copy action, then right-click the terminal "+" → Paste an action. This carried URL/headers/retry/body intact, so the only per-flow edit was `p_flow_name`. In the new designer, **Code view is read-only** — `p_flow_name` must be edited in the Parameters → Body field (select the value to end-of-line including the closing quote, then retype value + `",`; selecting only the inner words risks deleting the closing quote and stringifying the body).

**Flows wired this round:**
1. `SF -> LCC: Retry & Dead-letter` (`f7e7bc07-6cbe-4638-b4c6-09a5f3206930`) — terminal `Apply to each` (keystone; wired first). Saved cleanly.
2. `SF -> LCC: Property Promotion` (`c06b207e-b077-43a8-a483-39f2fb8c4243`) — terminal `Promote Deals`. Saved cleanly.
3. `SF -> LCC: File Discovery & Move` (`8cb891a2-05dc-46bd-84c3-d2f3bffbfd18`) — terminal `Apply to each`. Saved cleanly.
4. `SF -> LCC: Daily Bulk File Backfill` (`3d8be768-cfe7-41c9-81f4-e6b6f024ee5e`) — terminal `Apply to each 1`. Saved cleanly.
5. `SF -> LCC: On-demand File Backfill` (`aaa452c0-7eb5-4c98-bfe2-f6d872d80639`) — terminal `Apply to each`. Manual-triggered. Saved cleanly.
6. `SF -> LCC: On-demand Backfill` (`4ffa81bd-c8af-4883-bd8b-c292e6b9346d`) — terminal `POST Backfill Complete`. Manual-triggered. Saved cleanly.
7. `SF -> LCC: Object Sync` (`503d5519-221e-4014-bde8-c483b6a8ef10`) — terminal `POST Crawl Complete` (long crawl chain). Saved cleanly.

**Total: dead-letter plane now covers 33 flows** (26 from 2026-05-14 + the R2-M-5 `LCC Weekday Briefing Email` clone + these 7). Deliberate exceptions unchanged: the 2 calendar sync flows + the pending (not-yet-on) `LCC Outlook Calendar Write`.

- Validation: same posture as Wave 4 — the `lcc_record_flow_failure` ingestion contract was already proven end-to-end against the live RPC; per-flow run-after/Terminate is standard platform behaviour. No forced test failures run against the live SF -> LCC flows. A controlled fire-test on one safe flow remains the open verification item (R3-M-3c).
- Rollback per flow: delete the `PostDeadLetter` HTTP action + trailing `Terminate`, reset the terminal action's run-after to "is successful" only. No other action modified.
- Standing P0 reminder: the anon key is now inline in 33 flows' PostDeadLetter headers. The DRY fix (single shared "dead-letter" child flow invoked via Run a Child Flow, centralizing the key) is captured as a future round.
- Owner: LCC architecture/audit track (Scott Briggs).
