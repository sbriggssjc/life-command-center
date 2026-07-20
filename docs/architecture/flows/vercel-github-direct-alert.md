# Flow 2 — Vercel / GitHub Direct Alert Trigger

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: Office 365 Outlook (Scott's mailbox)

> **Confirm-scope, not rebuild.** Infra alerts (Vercel deploy failures, GitHub
> Action results) now land in the Inbox directly — the old Gmail forwarding hop
> is gone. This flow just triggers on those Inbox arrivals; the existing
> **Flag → To Do** flow (`flagged-email-to-todo.md`) is the human-review path and
> is left **exactly as-is**.

## Intent

React to an infra alert email the moment it lands in the Inbox (no Gmail relay).
The flow's job here is **only** the trigger + scope confirmation — the actual
disposition (move/file) is handled by Flow 1 once prompt 2 classifies the alert
and calls the webhook. This flow does **not** move or delete anything.

## Trigger

- Type: **When a new email arrives (V3)** (Office 365 Outlook).
- **Folder: Inbox** (top-level; do not scope to a sub-folder — the whole point is
  that alerts now arrive direct to Inbox, not via a Gmail-forward sub-folder).
- Suggested trigger filters (tighten to the real alert senders once confirmed):
  - `From` in the infra-alert set — e.g. `notifications@vercel.com`,
    `notifications@github.com` / `noreply@github.com`. Use the designer's
    From/Importance filter, not a body scan.
- Leave attachments off (infra alerts are body-only).

## What it does (minimal)

1. **Compose `AuditLog_start`** — `correlation_id = guid()`, `schema_version`,
   `internet_message_id` (from the trigger), sender, subject, `utcNow()`.
2. **Hand off to prompt 1/2** — POST the message identity to the classifier
   endpoint prompt 2 exposes (the same pipeline the rest of intake uses). Prompt
   2 decides the disposition and calls **Flow 1** with the move instruction.
   *(If prompt 1/2 is not yet wired, this flow logs + terminates — a safe no-op.
   It never moves/deletes on its own.)*
3. **No move here.** Filing is Flow 1's job; a human-review need is the untouched
   Flag → To Do flow's job.

## Explicitly do NOT

- **Do not duplicate the Flag → To Do flow.** That flow remains the single "I want
  a human to look at this" mechanism. If an infra alert also warrants human
  review, it is flagged there — not re-implemented here.
- **Do not permanently delete.** Only the Weekly Retention Sweep deletes, only
  from `Processed/Duplicates` after 30 days.
- **Do not re-add a Gmail hop.** Alerts arrive direct; the trigger is Inbox-scoped.

## Observability controls (that apply)

| Control | How |
|---|---|
| correlation_id | `guid()` at the first action; carried on the hand-off POST. |
| Exponential 4×PT10S retry | On the outbound classifier POST (step 2). |
| Dead-letter / fault branch | Run-after has-failed/has-timed-out on the POST → shared Teams alert. |
| Logical-failure detection | Treat a classifier 200-with-`ok:false` as not-handled (log, don't assume success). |
| Null-safe accessors | `internet_message_id` / sender read via `?[…]` coalesced. |

## Verify after build

1. Trigger the flow with a real (or test) infra alert to the Inbox → the flow
   fires, logs the `correlation_id`, and hands off (or safely no-ops if prompt 2
   isn't wired).
2. Confirm the **Flag → To Do** flow still fires independently on a flagged
   message — this flow did not change it.
3. Confirm no Gmail sub-folder is in the trigger scope.
