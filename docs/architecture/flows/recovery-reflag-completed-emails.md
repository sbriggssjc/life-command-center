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
