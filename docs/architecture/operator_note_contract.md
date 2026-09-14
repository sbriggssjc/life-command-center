# Operator Note Contract (EB1 foundation slice)

> Mirrors the style of [`daily_briefing_payload_contract.md`](daily_briefing_payload_contract.md).
> Spec: [`EXEC-BRIEFS-SPEC.md`](EXEC-BRIEFS-SPEC.md) v0.2 §6. Storage
> (`operator_notes`) is live as of EB1; **no intake endpoint, triage tick, or `log_operator_note` MCP
> tool exists yet** — those are OC1/OC2/OC3, built first per the spec's build order ("every later
> loop improves faster"). This document is the target contract those prompts build to.

## Design intent

Scott, spec §0: "All of the above — one large funnel sorting into one to-do list, filtered and
delegated by topic to the right agent/thread. Minimise human friction; maximise improvement loops."
Every channel writes the SAME table with the SAME shape; a channel-specific adapter's only job is
to fill `channel`, `raw_text`, `context`, and `received_from` — triage (OC2) is channel-agnostic
from that point on.

## Intake payload — one shape per channel

| Channel (`channel` value) | Mechanism (reuse) | `context` fields typically present |
|---|---|---|
| `outlook_tagged` | Reply to the XB/briefing email, or the "LCC-Note" Outlook category → the existing tagged-comm intake (`api/_handlers/intake-tagged-comm.js`) | `thread_id`, `original_message_id`, `subject` |
| `outlook_reply` | A plain reply to a briefing email not carrying the tag (fallback path; same intake as `outlook_tagged` if the tag classification misses) | same as above |
| `in_app_note` | The in-app "Note" button, every page | `route` (current hash route), `entity_id`/`entity_type` if a detail panel is open, `recent_errors` (last N console/API errors captured client-side), `screenshot_ref` (optional, uploaded separately) |
| `teams` | Power Automate → the intake endpoint, from the LCC Teams channel/bot | `teams_message_id`, `channel_id` |
| `mcp` | MCP write tool `log_operator_note` (sibling of `log_memory` — see below for the template it follows) | `session_id`, `tool_context` (whatever the calling surface — Claude Code, Cowork, Copilot — passes) |
| `cowork` | A Cowork/Claude Code response or chat containing a note, filed via the same endpoint as `mcp` | same as `mcp`, plus `repo`/`branch` if applicable |
| `other` | Reserved for a channel not yet built | whatever that channel can supply |

Every intake call is, at minimum:

```json
{
  "channel": "in_app_note",
  "raw_text": "The Ownership tab on 1500 Main St shows two conflicting owners.",
  "context": { "route": "#/dia?d=prop:dia:24703:Ownership", "entity_id": "24703" },
  "received_from": "sabriggs@northmarq.com",
  "attachments": []
}
```

The endpoint (OC1) inserts one `operator_notes` row and returns `{ "id": "uuid", "disposition": "open" }`.
Nothing about intake requires a lane, type, or severity — those are decided by triage, never by the
capturing surface (a plain text box should never need to know the routing taxonomy).

## `log_operator_note` — the MCP write-tool template

Sibling of `mcp/server.js`'s `log_memory` (same auth/session pattern, same shape of "one call, one
row, no read-back required"). Signature (target, not yet implemented):

```
log_operator_note({ raw_text, context?, channel? })
```

- `channel` defaults to `"mcp"`, overridable to `"cowork"` when the calling harness identifies
  itself as Cowork/Claude Code rather than a chat surface.
- `context` should carry whatever the calling tool already has for free — a session id, a repo/PR
  reference, the prompt that produced the note — mirroring how `log_memory`'s caller supplies
  free-form structured context rather than requiring a second round trip to enrich it later.
- Returns the same `{ id, disposition }` shape as every other channel.

## Triage output (OC2 — on-box Ollama + deterministic rules)

Triage never happens at intake time; it is a separate tick that reads `disposition='open'` +
`triaged_at IS NULL` and writes:

```json
{
  "note_type": "bug" | "data-gap" | "not-connecting" | "idea" | "ux" | "question",
  "lane": "string, free text — a domain/lane label, not the market-brief lane CHECK",
  "severity": "low" | "medium" | "high",
  "dedupe_of": "uuid, if this note restates an already-open note or a live PLANNED-BACKLOG row",
  "routed_to": "app/briefing" | "automation" | "data-coherence" | "surfaces/canon" | "comps" | "buyer-engagement" | "...",
  "evidence": { "matching_log_lines": [...], "failing_endpoint": "..." }
}
```

- **Dedupe against the backlog, not just prior notes** (spec §6: "dedupe against open
  PLANNED-BACKLOG rows and prior notes"). A note that restates an already-filed backlog row sets
  `dedupe_of` to the most similar prior `operator_notes` row (if one exists) and records the
  backlog row reference in `metadata.duplicate_of_backlog_row`, since a backlog row is not itself
  an `operator_notes` id.
- **The routing table is a small, versioned list kept in canon** (spec §6), not hard-coded in the
  triage tick — so a new owner thread is a canon edit, not a redeploy.
- **A bug with a reproducible signal gets an auto-drafted Claude Code prompt** (spec §6) — the
  prompt text (or a pointer to it) rides in `metadata.drafted_prompt_path`.

## The one to-do list (OC3)

A nightly job renders `docs/os/OPERATOR-INBOX.md` (GENERATED header) grouped by `routed_to` thread,
sourced from `operator_notes WHERE disposition IN ('open','routed','in_progress')` ordered by
severity then `received_at`. Every Claude Code / Cowork loop reads it each turn alongside
`responses/`. An item that needs a human decision (rather than autonomous work) is additionally
surfaced as a Decision Center lane row — the file lists it, the lane is where a human acts on it.

## Disposition values (loop closure — OC4)

| `disposition` | Meaning |
|---|---|
| `open` | Captured, not yet triaged. |
| `routed` | Triaged, assigned to an owner thread, not yet worked. |
| `in_progress` | A thread has picked it up (a prompt is drafted / a session is active). |
| `closed` | Resolved — `disposition_detail` names how (a backlog row id, a PR number). |
| `superseded` | Overtaken by a later note or a shipped change; `dedupe_of` or `disposition_detail` names the replacement. |
| `refuted` | Measured and found not to be a real issue — `disposition_detail` states the measurement, per the standing "a refutation is a claim like any other and must be recorded" doctrine. |

`disposed_at` is set the moment `disposition` leaves `open`/`routed`/`in_progress`. The next XB
issue reads notes disposed since its last run and reports them back (spec §6: "each note carries
its disposition ... and the next XB issue reports it back") — this is what makes the funnel a loop
rather than a one-way intake.

## What NOT to build from this document yet

No intake endpoint, no `log_operator_note` tool, no triage tick, no `OPERATOR-INBOX.md` renderer
exist as of EB1. `operator_notes` is live and can be written directly (e.g. for a manual test insert)
but nothing reads it yet.
