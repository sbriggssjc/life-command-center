# Flow Detail — Recovery - Reflag Completed Emails

## Metadata
- Export artifact: `Recovery-ReflagCompletedEmails_20260512135202.zip`
- Display name: `Recovery - Reflag Completed Emails`
- Trigger: `Request` (`kind: Button`)
- Connector: `shared_todo`

## Purpose
Operator recovery utility to reflag emails when downstream completion/unflag logic has over-corrected.

## Risks
1. Manual recovery can reintroduce duplicates if not scoped.
2. Indicates primary flow-state model still needs deterministic controls.

## Improvements
1. Require scoped input filters (date window, folder, owner).
2. Produce post-run reconciliation report (count scanned/updated/skipped).
# Flow Detail: Recovery-ReflagCompletedEmails

Last updated: 2026-05-12
Flow export: `Recovery-ReflagCompletedEmails_20260512135202.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Manual recovery flow to re-flag emails referenced by To Do tasks containing EmailID markers.

## Trigger
- Type: `Request` (`manual`)

## High-Level Action Topology
1. `List_to-do's_by_folder_(V2)` (`ListToDosByFolderV2`).
2. `Apply_to_each` task.
3. Condition checks if task body contains `[EmailID:`.
4. True branch:
   - `Compose`,
   - `Flag_email_(V2)` (re-flag path).

## Contract and Data Dependencies
- Connectors:
  - `shared_todo`
  - `shared_office365`
- Depends on consistent EmailID marker format in task body.

## Key Risks
1. Manual trigger can bulk re-flag unexpectedly without strict request controls.
2. Marker parsing from free text is brittle.
3. Recovery actions need explicit audit trail to avoid confusion with normal automation.

## Recommended Improvements
1. Require explicit dry-run/confirm parameter for manual recovery.
2. Add max-item guardrail per run.
3. Emit run summary (count scanned, count re-flagged, failures).

## Evidence Snapshot
- Trigger: `manual`
- Core condition:
  - `contains(body/content, "[EmailID:")`
- Operations:
  - `ListToDosByFolderV2`
  - `Flag_email_(V2)`

## Change Tracking Hooks
- Snapshot hash (pre-change): `eef758da708a5ab8f33337d7d1a613bc95628271e2d612cf4c0d85359b6b6059`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

