# Flow Detail: FlaggedEmailtoToDoTask

Last updated: 2026-05-12
Flow export: `FlaggedEmailtoToDoTask_20260512135651.zip`

## Intent
Create a Microsoft To Do task from a flagged work email using a leaner field set.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `When_an_email_is_flagged_(V3)`
- Connectors: `shared_office365`, `shared_todo`

## High-Level Action Topology
1. Trigger on flagged work email.
2. `Add_a_to-do_(V3)` (`CreateToDoV3`) with:
   - folder id
   - title
   - importance
   - body content

## Key Risks
1. Overlaps with `FlaggedEmailtoToDo` and can cause duplicate lifecycle behavior.
2. Missing due/status fields relative to the other variant can create inconsistent downstream task semantics.

## Evidence Snapshot
- Definition SHA256:
  - `8a6aacfc6e86ec528663f7e67da1041452c2eaeed4a5d827d94e57d83c6ff70e`

