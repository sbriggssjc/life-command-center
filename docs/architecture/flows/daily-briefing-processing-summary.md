# Flow 5 — Daily Briefing: Processing Summary Line

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: HTTP (LCC) + Teams

> **Modify the existing daily-briefing flow — do not create a new flow.** This is
> a one-line cosmetic addition to the LCC Daily Briefing (`lcc-daily-briefing.md`):
> surface a single "email auto-processed" summary line. It has a **prompt-2
> prerequisite** — the `processing_log` source does not exist yet.

## Intent

Give Scott a daily one-liner on what the mailbox-mechanics layer did overnight —
e.g.:

> **14 emails auto-filed, 2 flagged for review, 1 duplicate cleared.**

so the auto-filing is visible + auditable in the same briefing he already reads.

## ⚠️ Prompt-2 prerequisite (verified absent 2026-07-20)

The summary reads from **`processing_log`**, which **does not exist in the repo**
(no table/migration named `processing_log`). Prompt 2 must ship it — an LCC-Opps
table (or view) that records, per processed email, the disposition
(`auto_filed` / `flagged` / `duplicate`), so a daily count can be produced.

Until it lands, this flow change is **inert-safe**: the briefing endpoint should
return an empty/zeroed summary (or omit the line), and the flow renders nothing
extra — never a fabricated count.

## The existing flow (unchanged trigger/topology)

Per `lcc-daily-briefing.md`:
- **Trigger:** Recurrence, weekdays, ~12:30 UTC.
- **Action:** `HTTP GET` `…/api/daily-briefing?action=snapshot&role_view=broker`
  with the `x-lcc-key` header → `Post card in a chat or channel` (Teams).

## The modification (one added line)

Do the count **server-side** (preferred) so the flow stays a thin renderer:

1. **Prompt 2 / LCC** extends the daily-briefing snapshot payload with a
   `processing_summary` object read from `processing_log` for the last 24h:
   ```json
   "processing_summary": {
     "auto_filed": 14,
     "flagged": 2,
     "duplicates": 1,
     "line": "14 emails auto-filed, 2 flagged for review, 1 duplicate cleared."
   }
   ```
   (A precomputed `line` string keeps the flow from doing string math; the counts
   are there for anyone who wants them.)
2. **The flow** adds ONE line to the Teams adaptive card, bound to
   `body('HTTP')?['processing_summary']?['line']`, rendered **only when present
   and non-empty** (null-safe — no line when the summary is absent/zero, so no
   "0 emails" noise before prompt 2 lands or on a quiet day, per your preference).

No new HTTP call, no schema break — it's an additive field on the existing
snapshot + one conditional card line.

## Observability controls (that apply)

| Control | How |
|---|---|
| Null-safe accessors | `?['processing_summary']?['line']` — a missing field renders nothing, never an error. |
| Logical-failure detection | If the HTTP GET returns non-200 or `ok:false`, the existing briefing-failure handling applies; the summary line is simply omitted. |
| (retry/dead-letter) | Inherited from the existing briefing flow — this change adds no new outbound call. |

## Locked constraints

- **Read-only.** This flow reports; it never moves, files, or deletes email.
- Do not fabricate counts — if `processing_log` is empty/absent, render no line.

## Verify after build

1. Once prompt 2 ships `processing_log` + the snapshot field: run the briefing
   flow → the Teams card shows the summary line with real 24h counts.
2. With an empty `processing_log` (or before prompt 2): the card renders **without**
   the line (no "0 emails auto-filed" noise), and the rest of the briefing is
   unchanged.
3. Cross-check the counts against `processing_log` for the same 24h window.
