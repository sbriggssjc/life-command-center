# Personal-Life Canon
Canon: v1.0.0

## Purpose
"Life Command Center" spans work **and** personal by design. Personal domains bind to the same brain, memory,
and voice so personal requests are handled as consistently as work ones — without leaking onto team surfaces.

## Triggers
Anything personal Scott routes through the OS: personal tasks/reminders, personal contacts, household/finance,
travel, health, personal writing, personal projects.

## Inputs
`_AI-Context/Copilot-Context/BRIGGS-PERSONAL-CONTEXT.md` (canonical personal context) + Cortex memory.

## Procedure
1. Personal requests use the same engines/memory as work; the difference is **which context loads** and
   **which surfaces are in scope**.
2. Personal context loads on personal-scoped surfaces (Personal Claude, Cowork) and the Deal Agent's personal
   knowledge — **not** pushed onto the shared Northmarq team surfaces.
3. Log personal touchpoints/preferences to Cortex the same way (see `logging-and-touchpoints.md`).

## Output contract
Personal topics handled with the same consistency and voice as work; personal data stays on personal-scoped
surfaces.

## Never
- Never surface personal context or data on the Northmarq team Project or any shared team surface.
- Never fork a separate "personal brain" — it's the same OS, scoped.

## Surface bindings
Personal Claude / Cowork: personal skills + BRIGGS-PERSONAL-CONTEXT + MCP. Deal Agent: personal knowledge set,
scoped. (Team Northmarq surfaces: work-only.)

## Extension notes — how to fold in a NEW personal (or work) area later
1. Add `canon/<area>.md` from the template in `00-INDEX.md`.
2. Add its context to the right knowledge set (personal → BRIGGS-PERSONAL-CONTEXT or a new personal knowledge file).
3. Register it in `REGISTRY.md`; bind surfaces in `SURFACE-SYNC-PROTOCOL.md`; bump `CANON_VERSION`.
This is the single, repeatable path for every future addition — work or personal.
