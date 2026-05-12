# Flow Detail — Flagged Email to To Do Task

## Metadata
- Export artifact: `FlaggedEmailtoToDoTask_20260512135651.zip`
- Flow ID (from failure alert): `2116af42-659e-416b-bce6-1d74e8daa480`
- Current status: Failing (20 failures in 2026-05-06 weekly alert)
- Runtime: Power Automate

## Known Purpose
Create/propagate Microsoft To Do tasks from flagged Outlook email events.

## Incident Context
- Included in "6 of your flow(s) have failed" email.
- Current failure volume indicates either trigger duplication, downstream To Do connector issues, or missing null-guard behavior in mapping steps.

## Immediate Repair Checklist
1. Export latest active definition and snapshot checksum.
2. Confirm trigger uniqueness (single mailbox scope, no duplicate flows for same event).
3. Add idempotency guard keyed by Outlook message ID + flag timestamp.
4. Add explicit failure branch with Teams/email alert + dead-letter write to Supabase.
5. Validate one success and one forced failure run in non-prod.

## Dependencies (expected)
- Outlook trigger connector (`shared_office365`)
- Microsoft To Do connector (`shared_todo`)
- Optional LCC HTTP endpoint or OneDrive sync branch (to verify in definition export)

## Open Questions
1. Is this flow intended to replace or complement `Flagged Email to To Do`?
2. Which system is source-of-truth for completion state: To Do or Outlook flag?
