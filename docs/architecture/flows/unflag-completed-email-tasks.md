# Flow Detail — Unflag Completed Email Tasks

## Metadata
- Export artifact: `UnflagCompletedEmailTasks_20260512135227.zip`
- Display name: `Unflag Completed Email Tasks`
- Trigger: `Recurrence`
- Connector: `shared_todo`

## Purpose
Find completed task states and unflag corresponding emails to keep Outlook and To Do aligned.

## Risks
1. Incorrect matching logic can unflag wrong messages.
2. Race conditions with active flagged-email sync flows can cause flip/flop behavior.

## Improvements
1. Enforce one-way state transition guards (only unflag when completion is confirmed and stable).
2. Add reconciliation audit trail for every unflag operation.
# Flow Detail: UnflagCompletedEmailTasks

Last updated: 2026-05-12
Flow export: `UnflagCompletedEmailTasks_20260512135227.zip`
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent
Every 15 minutes, find completed To Do items linked to Outlook email IDs and unflag those emails.

## Trigger
- Type: `Recurrence`
- Frequency: `Minute`
- Interval: `15`
- Start time observed: `2026-03-05T16:00:00Z`

## High-Level Action Topology
1. `List_to-do's_by_folder_(V2)` (`ListToDosByFolderV2`).
2. `Apply_to_each` task.
3. Condition checks:
   - task body contains `[EmailID:`
   - task status equals `completed`
4. True branch:
   - `Compose` (extract/link value),
   - `Flag_email_(V2)` (unflag operation path).

## Contract and Data Dependencies
- Connectors:
  - `shared_todo`
  - `shared_office365`
- Depends on deterministic EmailID marker format in To Do task body.

## Key Risks
1. Marker parsing from free text can break on formatting drift.
2. 15-minute cadence can repeatedly process same tasks without idempotent marker handling.
3. Unflag operation side effects need audit visibility.

## Recommended Improvements
1. Replace free-text marker with structured metadata field if available.
2. Add processed marker/state to prevent repeat operations.
3. Log email-id + task-id + action result for audit.

## Evidence Snapshot
- Trigger: recurrence every 15 minutes
- Core condition:
  - `contains(body/content, "[EmailID:")`
  - `status == completed`

## Change Tracking Hooks
- Snapshot hash (pre-change): `7e3dbfcc95126e128ea22bb7ba0bad7c5602699d10090c7bd6d6c588aa9fdcf6`
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

