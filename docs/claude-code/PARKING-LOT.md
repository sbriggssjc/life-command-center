# Parking lot — things noticed on the way, not yet triaged

**What this is.** A one-line-per-item intake for anything Cowork, Claude Code or Scott notices while
doing something else: a smell in a log, a doc that reads wrong, a flag with no reason, a number that
does not add up. It is **not** a backlog — nothing here is planned, sized or owned. It is the place
where an observation waits so it is neither lost nor allowed to derail the turn it appeared in.

**How it works.**
- Anyone drops a line: date · where it was seen · what · who saw it. No analysis; a link if there is one.
- Every Cowork turn (README step ③b) triages the open lines: each becomes a **backlog row** (with its
  category section), a **checklist line** (if it is Scott's), a **prompt**, a **decision**, or is
  **dropped with a one-word reason**. The line then moves to *Triaged* with its destination.
- Claude Code rounds feed it through the **`Parked:`** section every prompt now asks for in its
  Reporting block: "anything you noticed out of scope, one line each" — Cowork copies those lines in.
- Scott feeds it however is easiest: a line here, a note in `SB notes/`, or a sentence in chat.
- A line older than seven days that nobody has triaged is a process failure; the triage step says so.

Sibling ledgers: `SB notes/TRIAGE.md` (Scott's in-app observations — richer intake, same idea),
`OPERATOR-CHECKLIST.md` (what only Scott can do), `docs/os/PLANNED-BACKLOG.md` (the state).

## Open

| # | seen | where | what | by |
|---|---|---|---|---|
| PL-1 | 2026-09-17 | Dialysis_DB edge functions list | Beyond `ai-copilot` and `salesforce-enrichment`, **eight more** edge functions run `verify_jwt:false` with no gate reviewed: `context-broker`, `template-service`, `intake-receiver`, `lead-ingest`, `intake-salesforce-files`, `sf-promotion-worker`, `npi-lookup`, `npi-registry-sync`, `calendar-*` (4), `w41/w43/w44`. Some are webhooks with their own secret (`lead-ingest` reports `webhook_secret_configured`); the rest are unmeasured. Same class as COPILOT-OPEN. | Cowork |
| PL-2 | 2026-09-17 | `ai-copilot /health` | reports `"version":52` while the deployed function is v84 — the version string in the source is hand-maintained and stale; harmless, but a "merged is not running" check that reads it would be fooled. | Cowork |
| PL-3 | 2026-09-17 | `salesforce-enrichment` | v27 (the log-only gate) has been live since 2026-09-09; **no `[sfenrich-auth]` line in the last 24 h**. Whether the monthly caller exists is unknown until it fires; the enforce flip waits for one full cycle (≈2026-10-09) or for Scott to name the caller. | Cowork |
| PL-4 | 2026-09-17 | Harris apply | `18003 Longenbaugh` exists in dia as both `Rd` and `Dr` (property 22269 + another) — a duplicate property to fold; no row yet. | Cowork |
| PL-5 | 2026-09-17 | gov weekly pipeline | the gov deed ingest runs on GitHub Actions while the gov repo's own note says compute crons belong on Railway — recorded in GOVDEED3's row, not decided. | Cowork |
| PL-6 | 2026-09-17 | Dialysis_DB `properties` | `properties.updated_at` moved on 3 non-Harris rows during the H7 window (`1325 Hwy 4 East`, `1360 N Shenandoah Ave`, `275 Health Center Dr`) — some other writer set `recorded_owner_id`; which one is not identified. | Cowork |

## Triaged

| # | triaged | destination |
|---|---|---|
