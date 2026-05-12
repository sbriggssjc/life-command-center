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
