# Claude Code Prompt — W7.5: Outbound Loop Closure (sent mail completes work) + per-action summaries

> Grounding: ROLLOUT_STATUS sessions 36k–36y; WAVE7 plan; `api/intake.js::handleOutlookSent`
> (the EXISTING outbound completion engine — auto-resolves offer_review/follow_ups via
> `lcc_advance_todos` p_direction='outbound' and schedules the seller follow-up);
> `api/_handlers/intake-tagged-comm.js` (W7.3 path C receiver, LIVE — note the 36y park-lane
> fix in the working tree); `supabase/migrations/20260818260000_lcc_reconcile_deal_todo.sql`
> (non-destructive deal_next_step reconciliation — KEEP non-destructive). Verify names
> against the repo; never trust this prompt over the code.

## The gap (verified 2026-08-06)
`handleOutlookSent` is complete but UNFED — no live flow posts sent mail to it, so sending
the email a to-do asked for does NOT close the to-do. And the tagged-comm receiver only
calls `lcc_advance_todos` for INBOUND mail: a tagged outbound email is spine-stamped but
completes nothing.

## Scope (three parts, one PR)
**A. Outbound advance in the tagged path (smallest fix, biggest yield).** In
`intake-tagged-comm.js`, when `direction === 'outbound'` and the deal resolved: call
`rpc/lcc_advance_todos` with `p_channel:'email', p_direction:'outbound'` and
`rpc/lcc_reconcile_deal_todo` with `p_direction:'outbound'` — mirroring the inbound branch
(same best-effort/never-block pattern). The existing 5-min PA sweep of Sent Items then
closes to-dos for tagged sends with ZERO new infrastructure.

**B. Untagged sent-mail feed (auto-completion without tagging).** New endpoint pass or PA
spec (pick the cheaper): a 5-min Graph sweep of Sent Items (same "Send an HTTP request"
pattern as W7.3 path C — Get emails V3 does NOT return categories or reliable fields;
Graph $select does) posting ALL external sends to `/api/intake?action=outlook-sent`
(the existing engine; auth per its contract). Write the PA spec doc
(`docs/setup/OUTLOOK_SENT_SWEEP_FLOW.md`) with exact actions/expressions in the style of
OUTLOOK_CATEGORY_TAGGING_FLOW.md + the 36y lessons (fx-expression pitfall, foreach
`?['value']`, Graph URIs). Server side: confirm handleOutlookSent is idempotent vs the
tagged path (same internet_message_id arriving via both routes must not double-log —
different source_type values mean two spine rows today; de-dupe: check for an existing
`outlook_tagged` row with the same external_id before inserting `outlook_sent`, and vice
versa in the tagged receiver).

**C. Per-action Ollama summary (Scott's ask; proposal-only).** After any spine-stamped
comm or call advances/completes to-dos, append a one-line Ollama-generated "action taken"
narration to the activity event's metadata (`action_summary`) and surface it in the deal
timeline + dossier correspondence section. No-fabrication: the narration may only
reference the subject/body/to-dos actually touched (pass them in the prompt; validator:
every to-do title mentioned must be one of the touched ids' titles — drop the summary on
mismatch, never block the pipeline). Flag `W75_ACTION_SUMMARY` (default off). Ollama via
the invokeExtractionAI seam; failure = no summary, never an error.

## Explicitly OUT of scope (need Scott decisions first — present options in the PR notes)
- Mailbox write-back (unflag after triage, move/file emails to Outlook folders, mark
  read) — requires Graph write scopes + a doctrine decision on LCC mutating the mailbox.
- Filing email bodies as deal-folder artifacts (property-doc-writeback exists for docs;
  emails need a rendering/naming decision).
- SF parity for calls (generic "Call logged — see LCC" Task mirroring the offer doctrine).

## Doctrine
Non-destructive on deal_next_step (never auto-complete broad next steps); reversible +
metadata-stamped completions (advance_todos already does this — reuse, no new writer);
own-seam; idempotent on internet_message_id across BOTH sent paths; flag-gated where new
behavior could surprise (`W75_ACTION_SUMMARY`); register every new flag in
feature_flags_registry IN THE MIGRATION (the W7.3 flag-row gap from 36y must not recur).

## Tests
Outbound tagged comm → advance_todos called with outbound + reconcile stamped (mock);
inbound path unchanged; cross-path de-dupe (same internet_message_id via tagged then
sent → one spine row, one advance); action-summary validator (fabricated to-do title →
summary dropped); flag off → no summaries; park-lane regression test for the 36y fix
(domain 'lcc', parked:false + park_error on insert failure).

## Deliverables
PR + migration (if any) with mirror-from-applied-SQL, the two PA spec docs updated/new,
flags registered, WAVE7 plan updated (add W7.5 row), ROLLOUT entry, and a dry-run note:
with A merged + flag off, a tagged outbound send in prod should show `advance` results in
the receiver response without any summary writes.
