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

## Open Action Items
1. Rotate exposed keys and confirm rotation completion here.
2. Re-export affected flows and verify no embedded credentials appear.
3. Add schema version and strict validation branch documentation for HTTP-Switch.
4. Add retry/dead-letter/idempotency policy record per `kind` for LCCSFFlow1.
