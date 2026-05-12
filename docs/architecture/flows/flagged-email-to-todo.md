# Flow Detail — Flagged Email to To Do

## Metadata
- Export artifact: `FlaggedEmailtoToDo_20260512135754.zip`
- Flow ID (from failure alert): `9071662c-ec79-49d2-82c1-03d8ba4302a6`
- Current status: Failing (16 failures in 2026-05-06 weekly alert)
- Runtime: Power Automate

## Known Purpose
Synchronize flagged Outlook emails into Microsoft To Do workflow for execution tracking.

## Incident Context
- Included in "6 of your flow(s) have failed" notification.
- Overlaps with `Flagged Email to To Do Task`; likely duplication/drift risk.

## Immediate Repair Checklist
1. Compare this flow against `Flagged Email to To Do Task` action-by-action.
2. Decide canonical flow and deprecate duplicate path where possible.
3. Add strict null checks and guarded updates for To Do object references.
4. Add standard telemetry (`correlation_id`, `source_message_id`, `attempt_number`).
5. Add deterministic retry policy and dead-letter branch.

## Dependencies (expected)
- Outlook trigger (`shared_office365`)
- Microsoft To Do actions (`shared_todo`)
- Optional LCC sync path (to confirm once export is parsed in detail)

## Open Questions
1. Should this flow remain independent from `To Do - Life Command Center Sync`?
2. What completion event should unflag the source email (if any)?
