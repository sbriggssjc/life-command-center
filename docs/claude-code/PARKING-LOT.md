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
  A round that writes here directly uses the **next free PL number in the file at the time it writes**
  (two rounds on 2026-09-17 both used PL-7…9; renumbered).
- Scott feeds it however is easiest: a line here, a note in `SB notes/`, or a sentence in chat.
- A line older than seven days that nobody has triaged is a process failure; the triage step says so.

Sibling ledgers: `SB notes/TRIAGE.md` (Scott's in-app observations — richer intake, same idea),
`OPERATOR-CHECKLIST.md` (what only Scott can do), `docs/os/PLANNED-BACKLOG.md` (the state).

## Open

| # | seen | where | what | by |
|---|---|---|---|---|

## Triaged

| # | triaged | destination |
|---|---|---|
| PL-1 | 2026-09-17 | → backlog `EDGE-GATES1` (prompted) — *Beyond `ai-copilot` and `salesforce-enrichment`, **eight more** edge functions run `verify_jwt:false` with no …* |
| PL-2 | 2026-09-17 | → folded into `EDGE-GATES1` (drift check) — *reports `"version":52` while the deployed function is v84 — the version string in the source is hand-maintaine…* |
| PL-3 | 2026-09-17 | → checklist Q2 (enforce ≈2026-10-09) — *v27 (the log-only gate) has been live since 2026-09-09; **no `[sfenrich-auth]` line in the last 24 h**. Whethe…* |
| PL-4 | 2026-09-17 | → backlog `DIA-DUP1` — *`18003 Longenbaugh` exists in dia as both `Rd` and `Dr` (property 22269 + another) — a duplicate property to f…* |
| PL-5 | 2026-09-17 | recorded on `GOVDEED3`; no action (dropped: existing state, decided elsewhere) — *the gov deed ingest runs on GitHub Actions while the gov repo's own note says compute crons belong on Railway …* |
| PL-6 | 2026-09-17 | → backlog `OWNER-WRITERS1` — *`properties.updated_at` moved on 3 non-Harris rows during the H7 window (`1325 Hwy 4 East`, `1360 N Shenandoah…* |
| PL-7 | 2026-09-17 | → noted on `HOME2` row (no due-date field) — *`v_inbox_triage` carries no `due_date`/overdue concept, only `status IN ('new','triaged')` — the Inbox lane's …* |
| PL-8 | 2026-09-17 | → `HOME2-on` gate (measure before the flip) — *Could not measure how often `today_top_5` (the old My-Priorities snapshot) came back empty over the last 14 da…* |
| PL-9 | 2026-09-17 | → noted on `HOME2` row (perf nit) — *`_home3ResearchItems` inherits nbaSnapshot's existing 15-item fetch (`limit=15`) and slices to 5 client-side r…* |
| PL-10 | 2026-09-17 | → noted on `HOME2` row (perf nit) — *The BD lane's fetch (`/api/seller-prospect-queue?chip=all&limit=5&offset=0`) is a SEPARATE network round trip …* |
| PL-11 | 2026-09-17 | → backlog `BR4-b` — *123 `brokers.broker_name` rows are firm/operator-shaped, not people (flagged into `dia_broker_company_composit…* |
| PL-12 | 2026-09-17 | → backlog `BR4-b` — *`dia_broker_company_composite_review` still holds 468 open rows: 120 same-name-one-linked-one-blank groups (ne…* |
| PL-13 | 2026-09-17 | → checklist Q29 (Scott, 30 s) — *Own name ("Scott Briggs") appears 3x in `brokers` (ids 1373/2076/2437), one linked to `broker_company_id=126`,…* |
| PL-14 | 2026-09-17 | → noted on `COPILOT-OPEN` + `EDGE-GATES1-b` — *`ai-copilot` logs `DENY-WOULD` for `POST /chat` with caller class `node other` (not browser, not Railway) — an unnamed chat caller that breaks on the enforce flip; seen by Cowork in the 24 h log 2026-09-17…* |
| PL-15 | 2026-09-17 | → backlog `EDGE-GATES1-b` (e) — *`calendar-ics-sync` v21 logs `DENY-WOULD` from a caller of unknown class within hours of the gate landing — a real caller nobody has named…* |
| PL-16 | 2026-09-17 | → design input on backlog `RECON1` (no separate row) — *Scott 2026-09-17: "maybe deploy an Ollama local model on a regular cleaning and connecting task" — source of truth and accuracy lacking, many gaps to close…* |
