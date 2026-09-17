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
| PL-7 | 2026-09-17 | HOME2 build | `v_inbox_triage` carries no `due_date`/overdue concept, only `status IN ('new','triaged')` — the Inbox lane's "new/overdue first" spec was implemented as "new before triaged" since there is no due-date field to distinguish an overdue triaged item from a merely-triaged one. Worth a real overdue definition if this lane graduates past the flag. | Claude Code |
| PL-8 | 2026-09-17 | HOME2 build | Could not measure how often `today_top_5` (the old My-Priorities snapshot) came back empty over the last 14 days — no live Supabase/DB credentials in this sandbox. A one-query check (`daily_briefing_snapshot` or equivalent log, filtered to `today_top_5 = []`) would answer it; flagged as a TODO for whoever has DB access. | Claude Code |
| PL-9 | 2026-09-17 | HOME2 build | `_home3ResearchItems` inherits nbaSnapshot's existing 15-item fetch (`limit=15`) and slices to 5 client-side rather than the API returning exactly 5 — harmless (no new query) but means the Research lane silently discards 10 rows the server already sent, every load. Not worth a server change for a flag-gated feature; worth remembering if the lane graduates. | Claude Code |
| PL-10 | 2026-09-17 | HOME2 build | The BD lane's fetch (`/api/seller-prospect-queue?chip=all&limit=5&offset=0`) is a SEPARATE network round trip from the Research/Inbox lanes (which reuse already-loaded snapshots) — every Home load now costs one more request when the flag is on. Acceptable for a flag-gated re-composition; if graduated, consider folding it into the existing `daily-briefing` payload so Home has one round trip, not two. | Claude Code |
| PL-7 | 2026-09-17 | `brokers` (BR4) | 123 `brokers.broker_name` rows are firm/operator-shaped, not people (flagged into `dia_broker_company_composite_review`, never merged/deleted). Likely disposition: split the firm-shaped ones into `broker_companies` via BR1's own classifier, reassign the operator-shaped ones (DaVita/Fresenius) off `brokers` entirely — not built. | Cowork |
| PL-8 | 2026-09-17 | `brokers` (BR4) | `dia_broker_company_composite_review` still holds 468 open rows: 120 same-name-one-linked-one-blank groups (never auto-filled — filling the blank from the linked sibling would be an identity guess), the 8 firm-string groups that failed either the junk-shape or weak-domain-evidence gate, and residue from earlier BR1 classes. A human pass could raise the mint rate but needs judgment per row. | Cowork |
| PL-9 | 2026-09-17 | `brokers` (BR4) | Own name ("Scott Briggs") appears 3x in `brokers` (ids 1373/2076/2437), one linked to `broker_company_id=126`, two blank — correctly left untouched by the never-guess rule, but worth a manual look. | Cowork |

## Triaged

| # | triaged | destination |
|---|---|---|
