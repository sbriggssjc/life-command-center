# Closing the Loop — mailbox-mechanics layer (build overview)

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Scope: Power Automate cloud flows in the `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f`
(NorthMarq Capital, LLC) tenant that make flagged/ingested email **move, file, and
delete itself** with no manual step after classification.

> **This is prompt 3 of a three-prompt design.** Prompts 1 and 2 handle
> classification, scoring, and *deciding* what should happen to each email. This
> layer is the actual mailbox mechanics — only the Office 365 connector (via Power
> Automate) can move a message in Scott's mailbox; the LCC API can only decide.
>
> **These are PA-flow changes, not code.** The flows are authored in the Power
> Automate designer (browser), not in this repo. This doc + the five per-flow
> sheets + the `FLOW_CHANGES_LOG.md` entry are the build spec Scott (or a session
> with browser access) follows in the designer. Nothing here is a live flow until
> it is built + turned on in PA.

## ⚠️ Prompt-2 prerequisites that do NOT exist yet (verified 2026-07-20)

The "Closing the Loop" plan assumes two artifacts "from prompt 2." A grep of the
repo confirms **neither exists**, so the flows below have nothing to call until
prompt 2 ships them:

| Assumed dependency | Status in repo | What must be built (prompt 2) |
|---|---|---|
| `POST /api/webhooks/processing-complete` | **Not found.** No `processing-complete` route/handler anywhere. | The endpoint intake.js/operations.js emits (or is called to emit) when an email is classified. It must return the move instruction (`internet_message_id` + `target_folder` + `disposition`). Per repo rule #1–4 it is a **sub-route** (`?_route=`/`?action=`), NOT a new `api/*.js` file — the 12-function limit holds. |
| `processing_log` (table the briefing line reads) | **Not found.** No table/migration named `processing_log`. | An LCC-Opps table (or view) that records, per processed email, the disposition (`auto_filed` / `flagged` / `duplicate`) so the daily briefing can produce the one-line summary. |

**Endpoint correction — the news-alert route in the plan is wrong.** The plan
says the Google-Alerts flow POSTs to `/api/intake?_route=news-alert`. That route
does **not** exist. The built news-alert channel is the Supabase **`lead-ingest`
edge function** `?action=news_alert`, and a **sender-triggered flow already
exists** for it (`flow-google-news-alert.json` +
`google-news-alert-power-automate.md`). See the "Google Alerts Sub-folder Watch"
sheet — the recommendation is to **not duplicate** that flow.

Build the five flows against the real/known contracts (documented per-sheet);
where a contract is a prompt-2 prerequisite, the sheet marks it and the flow
no-ops safely (Respond/Terminate) until prompt 2 lands — the same
feature-flagged-rollout posture the rest of the portfolio uses.

## The flows (+ their per-flow sheets)

| # | Flow | Sheet | Trigger | Load-bearing? |
|---|---|---|---|---|
| 1 | Processing Complete → Move Message | `processing-complete-move-message.md` | HTTP request (from prompt-2 webhook) | **Yes — build first.** Both hygiene flows and the briefing line depend on the move actually happening + being logged. |
| 2 | Vercel/GitHub Direct Alert Trigger | `vercel-github-direct-alert.md` | New email (V3), Inbox-scoped | No — confirms trigger scope now that infra alerts land direct (Gmail hop removed). |
| 3 | Google Alerts Sub-folder Watch | `google-alerts-subfolder-watch.md` | New email (V3), sub-folder-scoped | No — **reconcile with the existing sender-triggered flow; do not duplicate.** |
| 4 | Weekly Retention Sweep | `weekly-retention-sweep.md` | Scheduled, weekly | No — hygiene; the only flow that ever **deletes** (and only from `Processed/Duplicates` after 30d). **Never touches the staging folder.** |
| 5 | Daily Briefing — Processing Summary Line | `daily-briefing-processing-summary.md` | Modify the existing daily-briefing flow | No — cosmetic; reads `processing_log`. |
| 6 | LCC To Do Completion Poll (staged → Processed) | `todo-completion-poll.md` | Scheduled, every ~30 min | No — files a `staged` email once its To Do task completes. **Reuses Flow 1's Move + Flag mechanics** (different trigger + source). |

## Build sequencing (per the plan)

1. **Processing Complete → Move Message** first — the load-bearing piece.
2. The two intake trigger flows (Vercel/GitHub direct, Google Alerts sub-folder).
3. Weekly Retention Sweep and the Daily-Briefing summary line last (hygiene /
   cosmetic).

## Folder taxonomy (the plan's convention)

```
Inbox
Intake Staged, Not Completed/  ← top-level sibling; a `staged` email lives here
                                 (kept flagged) until its To Do completes, then
                                 Flow 6 files it to Processed/{category}.
                                 OUT of the retention sweep's scope — never swept.
Processed/
  Duplicates/          ← weekly sweep permanently deletes items older than 30d
  <disposition folders>/  ← auto-filed classes; items older than 180d → Archive
Archive/
  LCC-Processed/       ← single archive sink for aged Processed/* items
```

- **`target_folder`** in the move payload names a path under `Processed/`
  (e.g. `Processed/Duplicates`, `Processed/OM`, `Processed/News`) — OR the
  top-level staging folder `Intake Staged, Not Completed` for a `staged` email.
  The Move flow looks up / creates the destination folder by that path.
- **The staging folder is a top-level sibling of `Processed/`**, deliberately
  OUTSIDE `Processed/*` so the retention sweep never archives/deletes an
  outstanding-work email. A `staged` email keeps its flag (the emit's
  `clear_flag:false`); the flag clears + it files to `Processed/{category}` only
  when its To Do task completes (Flow 6).
- The retention sweep is the ONLY flow that hard-deletes, and only from
  `Processed/Duplicates` after 30 days. Everything else is a move (reversible).

## Hard "do nots" (locked)

- **Never set any flow to permanently delete on first pass.** Only the Weekly
  Retention Sweep deletes, and only from `Processed/Duplicates` after 30 days.
- **Do not duplicate the existing Flag → To Do flow** — it stays as-is as the
  single "I want a human to look at this" mechanism. The move layer is orthogonal
  to it (a flagged email can be both moved-and-filed AND surfaced as a To Do).
- **Do not duplicate the existing Google-Alerts sender flow** — reconcile the
  sub-folder watch against it (sheet 3).

## Observability bar (every new flow starts GREEN)

Per `power-automate-observability-standards.md`, each new HTTP-triggered flow
gets, at build time: a `correlation_id = guid()` first-action `AuditLog` Compose;
a trigger Request-Body JSON Schema with a `required` array; `schema_version` on
outbound payloads; Exponential 4×PT10S retry on every outbound HTTP/connector
call; a `Configure run after → has failed / has timed out` dead-letter branch;
and a `Condition` on any response body that can soft-fail (an HTTP 200 with
`ok:false` is NOT success — the lesson that auto-disabled HTTP Init LLC for 14
days). The per-flow sheets note which controls apply.
