# Prompt 31 Worklog - Property-record consolidation + sale reconciliation

## Objective
Capture Prompt 31 as an open Claude Code queue item and update the comps data-integrity architecture note with
the 2026-08-04 dedup reframe: preserve genuine repeat sales, consolidate duplicate property records, reconcile
multi-source same-event sales, and position Ollama as a review-lane/unstructured assistant rather than the primary
dedup engine.

## Guardrails
- Documentation handoff only in this chat.
- No schema changes, no data mutation, no dedup execution, and no API edits.
- Preserve the doctrine: dry-run first, reversible backup, conservative confidence bands, review lane, provenance
  tags, idempotency, and no hard deletes.

## Progress
- Read `AGENTS.md`, `CLAUDE.md`, `docs/claude-code/README.md`, `docs/claude-code/STATUS.md`,
  `PROMPT_30_WORKLOG.md`, and `docs/architecture/comps-data-integrity-and-canonical-record.md`.
- Added `docs/claude-code/prompts/31-data-integrity-property-record-consolidation.md`.
- Appended `Update 2026-08-04 — dedup reframe + Ollama decision` to
  `docs/architecture/comps-data-integrity-and-canonical-record.md`.
- Updated `docs/claude-code/STATUS.md` so Prompt 31 appears in the open queue.

## Verification
- Inspected git diff/status after edits and confirmed the touched files are documentation/queue files only.
