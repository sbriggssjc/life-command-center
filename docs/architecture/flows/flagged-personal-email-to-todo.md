# Flow Detail — Flagged Personal Email to To Do

## Metadata
- Export artifact: `FlaggedPersonalEmailtoToDo_20260512135719.zip`
- Display name: `Flagged Personal Email to To Do`
- Trigger: `When_an_email_is_flagged_(V2)`
- Connector profile: `shared_todoconsumer` (personal Microsoft account)

## Purpose
Create personal To Do tasks from flagged personal mailbox emails.

## Risks
1. Personal and business task pipelines may diverge in behavior/governance.
2. Cross-account duplication risk if same email exists in business flow scope.

## Improvements
1. Explicitly separate personal vs business sync governance in registry.
2. Add common idempotency strategy shared with business flagged-email flows.
