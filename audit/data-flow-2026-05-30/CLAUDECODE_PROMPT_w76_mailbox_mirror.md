# Claude Code Prompt — W7.6: Mailbox Mirror (Outlook folders reflect open LCC work)

> Grounding: ROLLOUT_STATUS sessions 36k–36z + the W7.5 session entry; WAVE7 plan;
> `api/_handlers/intake-tagged-comm.js` + `api/intake.js::handleOutlookSent` (both live,
> cross-path de-duped on internet_message_id); `lcc_advance_todos` /
> `lcc_reconcile_deal_todo`; the flagged-email intake path (inbox_items / staged intake).
> Verify every name against the repo — never trust this prompt over the code.

## Scott's spec (verbatim intent)
Flagged emails land in an Outlook folder ("Intake Staged, Not Complete") and create LCC
to-dos. When the loop closes — the follow-up email is SENT, or a task that closes the
to-do is COMPLETED — the email should automatically move to a Done/Processed folder, so
the Not-Complete folder shows ONLY open work and mirrors the LCC exactly.

## Architecture (pull model — LCC never touches the mailbox)
LCC publishes a deterministic worklist; a Power Automate "mover" flow executes the
Outlook actions (move + unflag + mark read) via Graph and acks back. Never delete —
move only. Reversible ledger.

**1. Worklist endpoint** `GET /api/mailbox-reconcile-worklist` (X-LCC-Key auth, flag
`MAILBOX_MIRROR` default off, registered in feature_flags_registry IN the migration).
Returns up to N (default 25) rows: `{ internet_message_id, reason, closed_at,
deal_entity_id? }`. A message qualifies when it is an intake-captured inbound email
(has a spine/inbox row with an internet_message_id) AND its loop is CLOSED, defined
deterministically as ANY of:
  (a) every to-do generated from it (advance_todos/deriveNextStep lineage — use the
      activity/ledger linkage that exists; verify the actual FK/metadata path in repo)
      has status done/resolved/dismissed;
  (b) a LATER outbound comm from us exists in the same conversation_id
      (outlook_sent or outlook_tagged outbound on the spine);
  (c) its inbox_item was triaged to a terminal status (done/discarded — verify enum).
No LLM anywhere in this gate — pure SQL/deterministic. Exclude ids already acked in
the ledger.

**2. Ack endpoint** `POST /api/mailbox-reconcile-ack` (same auth): body
`{ internet_message_id, moved: true|false, error? }` → ledger table
`lcc_mailbox_reconcile_ledger` (internet_message_id unique, action, reason, acked_at,
error). moved:false records the error and RE-QUEUES after a backoff (e.g. not before
1h; cap retries at 5 then park with a loud alert row — never silent-drop).

**3. PA spec doc** `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`, exact-actions style of
OUTLOOK_SENT_SWEEP_FLOW.md incl. the 36y pitfalls (fx expressions, `?['value']`).
Flow: Recurrence 5 min → GET worklist → Apply to each: Graph
`GET /me/messages?$filter=internetMessageId eq '<id>'&$select=id,parentFolderId` →
if found: Graph `POST /me/messages/{id}/move` (destinationId = the Processed folder id;
document how Scott finds the folder id once via Graph `GET /me/mailFolders`), then
PATCH `{ "flag": { "flagStatus": "complete" }, "isRead": true }` → POST ack. If not
found: ack moved:false error 'not_found'. NOTE: folder NAMES are Scott's ("Intake
Staged, Not Complete" → source; "Intake Staged, Processed" → destination — confirm
exact names in the doc as placeholders he fills in).

**4. Optional inverse guard (cheap, include):** the worklist NEVER returns a message
whose to-dos are still open even if an outbound reply exists, WHEN the deal also has an
open offer_review (an offer thread stays visible until the offer resolves). Keep this
rule simple and documented; Scott can tune.

## Doctrine
Deterministic gate only (no LLM); move-only (never delete — the hazard class);
reversible + ledgered + idempotent (unique on internet_message_id; re-acks no-op);
flag-gated + flag registered in the migration; own seam (new ledger, no other
producer's tables); loud failure (retry cap → alert row in lcc_health_alerts or the
established alert path — verify name).

## Tests
Worklist gate: open to-dos → excluded; all done → included; outbound-reply-in-thread →
included; triaged-terminal → included; offer_review guard holds; acked → excluded.
Ack: idempotent re-ack; moved:false → backoff requeue; retry cap → alert + park.
No LLM call anywhere in the unit (assert the module imports no ai seam).

## Deliverables
PR + migration (applied live, mirror-from-applied-SQL) with ledger + flag row; the two
endpoints wired in server.js; PA spec doc; WAVE7 plan W7.6 row; ROLLOUT entry; dry-run:
with flag off endpoint returns `{skipped:'flag_off'}`; with flag on (registry+env) a
read of the worklist against live data in the PR description (ids redacted to counts +
reasons) so Scott can sanity-check the gate before building the mover flow.
