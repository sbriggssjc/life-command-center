# Flow Detail: FlaggedEmailtoToDo

Last updated: 2026-05-12
Flow export: `FlaggedEmailtoToDo_20260512135754.zip`

## Intent
Create a Microsoft To Do task from a flagged work email using richer task fields.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `When_an_email_is_flagged_(V3)`
- Connectors: `shared_office365`, `shared_todo`

## High-Level Action Topology
1. Trigger on flagged work email.
2. `Add_a_to-do_(V3)` (`CreateToDoV3`) with:
   - folder id
   - title
   - due date
   - importance
   - status
   - body content

## Key Risks
1. Hardcoded folder id dependency.
2. Overlap with other flagged-email-to-todo variant flow.
3. Potential duplicate task creation without idempotency marker.

## Evidence Snapshot
- Definition SHA256:
  - `d4d3561b7c21cf824c4bd5beb4be167c3ff31537bad5bd6ab79ed2306e39295f`

