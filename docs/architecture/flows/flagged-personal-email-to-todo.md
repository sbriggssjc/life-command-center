# Flow Detail: FlaggedPersonalEmailtoToDo

Last updated: 2026-05-12
Flow export: `FlaggedPersonalEmailtoToDo_20260512135719.zip`

## Intent
Create a To Do task from flagged personal-email trigger path.

## Trigger
- Type: `OpenApiConnectionNotification`
- Operation: `When_an_email_is_flagged_(V2)`
- Connectors: `shared_outlook`, `shared_todoconsumer`

## High-Level Action Topology
1. Trigger on flagged personal email.
2. `Add_a_to-do` (`CreateToDo`) with folder id, title, due date, importance, status, and body content.

## Key Risks
1. Personal connector path and work connector path can diverge if not governed together.
2. Hardcoded folder id dependency.
3. Duplicate or inconsistent ToDo creation compared with work-email flows.

## Evidence Snapshot
- Definition SHA256:
  - `c713172d1b338064d099bfb5b55109ef337956844b75b981e60048f5b0bfd0be`

