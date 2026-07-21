# Email auto-archive / cleanup layer

Emails that get successfully processed by the LCC intake pipeline (OM/lease deal
emails, deal-closing announcements, infra alerts) used to just sit in the inbox
after processing — the data was captured but nothing filed or removed the raw
email. This layer lets a processed email **file itself once its job is done**.

**intake.js decides; Power Automate moves.** `api/intake.js` has no Graph
mailbox-write access, so it records a *decision* (which folder the email belongs
in) and Power Automate performs the actual Outlook move.

> This layer **never deletes** anything — it only moves to `Processed/*`.
> Permanent deletion of `Processed/Duplicates` after 30 days is a **separate
> retention sweep** (Power Automate), out of scope here.

---

## 1. What it does

When `handleOutlookMessage` finishes with a flagged email it emits a
`processing_complete` decision — the stable `internet_message_id`, an `outcome`,
and a `target_folder` — recorded in `public.processing_log`.

| Outcome | When | target_folder | Mailbox action |
|---|---|---|---|
| `filed` | a **terminal** category where filing IS the whole job (currently a deal-closing comp is `staged`, not filed — see below) | `Processed/{domain}` — `Processed/Deals`, `Processed/Infra`, `Processed/Leads`, `Processed/General` | move + **clear flag** |
| `staged` | intake FINISHED for a **non-terminal** category (deals / leads / general / infra) — the To Do is not done yet | `Intake Staged, Not Completed` (single "everything outstanding" view) | move + **KEEP flag** |
| `needs_review` | nothing captured, extraction failed, or a genuinely ambiguous / low-confidence item | *(null — left in place)* | none; existing flag/inbox surfaces it |
| `duplicate` | a re-flag / already-ingested email | `Processed/Duplicates` | move + clear flag (recoverable ~30d) |

**The `staged` state (defer auto-filing until To Do completion).** Filing an
email and completing the underlying To Do task are two different things. When
intake finishes for a non-terminal category the email moves to a single
**"Intake Staged, Not Completed"** folder and **keeps its flag** — it is
outstanding work, not filed. The flag clears + the email reaches its
`Processed/{category}` folder only when the linked Microsoft To Do task is marked
**completed** (by Scott, or by the terminal-category auto-complete gate). The real
`Processed/{category}` destination is resolved + stored **at staging time** on
`processing_log.final_target_folder` (never re-derived later). Completion is
discovered by the scheduled **To Do Completion Poll** (§6a below), which files the
staged email once its task is done. `needs_review` stays reserved for genuinely
ambiguous / failed items (left in the Inbox). Terminal categories
(`news`/`reference`/`fyi`/`duplicate`) still `filed` immediately + clear the flag
— that behavior is unchanged.

The emit event also carries a **`clear_flag`** boolean (`false` for `staged`,
`true` for `filed`/`duplicate`) so the Move flow knows whether to clear the flag
after the move.

The decision is **idempotent per `(workspace_id, internet_message_id)`** — Power
Automate fires the flagged-email flow 3–6× per flag, and the **first emit wins**
(the fresh pass that actually captured the data), so replays never enqueue a
second move or downgrade a `filed` decision.

The emit is **best-effort** — it never blocks or fails the intake response, and
it no-ops cleanly if the `processing_log` migration has not been applied yet
(deploy-order safe).

## 2. Folder mapping

`targetFolderFor(outcome, { channel, domain })` in
`api/_shared/processing-complete.js`:

- `needs_review` → `null` (leave in place)
- `staged` → `Intake Staged, Not Completed` (the single outstanding-work folder)
- `duplicate` → `Processed/Duplicates`
- `filed`, `domain/channel = infra` → `Processed/Infra`
- `filed`, `lead | news_alert | crexi | loopnet` → `Processed/Leads`
- `filed`, `om | lease | deal_closing | dia | gov | netlease` → `Processed/Deals`
- `filed`, otherwise → `Processed/General`

For a `staged` email, `emitProcessingComplete` ALSO computes
`final_target_folder = targetFolderFor('filed', { channel, domain })` and stores
it on the `processing_log` row — the eventual `Processed/{category}` the email
moves to once its To Do completes (resolved at staging time; the poll never
re-derives it).

## 3. Two ways Power Automate consumes the decision

### (a) Inline — read the intake response
`POST /api/intake?_route=outlook-message` (a.k.a. `/api/intake-outlook-message`)
now returns a `processing_complete` block:

```json
{ "ok": true, "inbox_item_id": "…", "processing_complete": {
    "internet_message_id": "<AAMk…@…>",
    "outcome": "filed",
    "target_folder": "Processed/Deals",
    "move_status": "pending" } }
```

A flow that already has the trigger's message in hand can move it immediately
when `target_folder` is non-null (mirrors the Google/News-Alert `archive:true`
pattern). `move_status: "skipped"` (needs_review) means **do not move**.

### (b) Batch webhook — pull the queue, report back
`/api/webhooks/processing-complete` (→ `/api/intake?_route=processing-complete`),
authenticated exactly like the intake endpoints (operator role, `X-LCC-Key` /
`x-lcc-workspace`).

**GET** — the pending move queue (oldest first, `?limit=N`, max 200):

```json
{ "ok": true, "count": 2, "events": [
  { "id": "…", "internet_message_id": "<AAMk…>", "graph_rest_id": "…",
    "outcome": "filed", "target_folder": "Processed/Deals",
    "domain": "om", "channel": "om", "subject": "…" } ] }
```

Only `move_status = pending` rows are returned (needs_review is `skipped`, so it
never appears here). Power Automate finds each message by `internet_message_id`
(`GET /me/messages?$filter=internetMessageId eq '…'`), calls the Graph
`move`/`copy` action to `target_folder`, then reports back:

**POST** — report move results (single or batch):

```json
{ "results": [ { "id": "…", "moved": true },
               { "internet_message_id": "<AAMk…>", "moved": false, "error": "folder not found" } ] }
```

- `moved: true`  → row flips `move_status → moved`, `moved_at` set.
- `moved: false` → `move_status → move_failed`, `move_error` recorded.

Only rows still `pending` are transitioned (a resolved row is never re-opened).

## 4. Daily briefing one-liner

The briefing's **Ops & Queue** section appends a 24h summary from
`fetchProcessingSummary` (`api/_shared/briefing-data.js`), e.g.:

> Connectors: 4 healthy · 0 error · Email cleanup (24h): 14 auto-filed, 2 flagged for review

so Scott sees the cleanup activity without opening any folder.

## 5. Data model — `public.processing_log`

Migration `supabase/migrations/20260804120000_lcc_processing_log_auto_archive.sql`
(additive, reversible: `DROP VIEW v_processing_log_daily; DROP TABLE
processing_log;`). Key columns: `internet_message_id` (stable move key),
`outcome`, `target_folder`, `move_status` (`pending|moved|move_failed|skipped`),
`domain`/`channel`, `moved_at`, `move_error`, `created_at`. The
`v_processing_log_daily` view rolls outcomes up per workspace per day. The
`created_at` index supports the future retention sweep of `Processed/Duplicates`.

The `staged` outcome + the `final_target_folder` column were added by migration
`20260808120000_lcc_processing_log_staged.sql` (additive: widens the outcome
CHECK to `filed|needs_review|duplicate|staged`, adds `final_target_folder`, and
appends a `staged` count to `v_processing_log_daily`). Reversible: restore the
3-value CHECK + drop the column.

## 5a. To Do Completion Poll — `staged → Processed` on task completion

Microsoft To Do has no "task completed" trigger, so completion is discovered by
POLLING. And **LCC cannot call the To-Do/Graph API directly** — Northmarq IT
blocks Azure AD app registrations, so there is no Graph service token (the same
reason the whole system runs on Power Automate connectors). So **the To-Do calls
live inside Power Automate** (its Microsoft To-Do (Business) connection is already
OAuth-authenticated); **LCC only ever does DB reads/writes here — no Graph, no
token.**

The scheduled **"LCC To Do Completion Poll"** PA flow (Flow 6,
`docs/architecture/flows/todo-completion-poll.md`, every ~30 min) uses two pure-DB
endpoints on `api/sync.js` `?_route=todo-completion-poll` (`handleTodoCompletionPoll`;
pure logic in `api/_shared/todo-completion.js`):

- **`GET` = the worklist** (LCC → PA). Selects the open `staged` `processing_log`
  rows, batch-joins each to its To Do task in `todo_task_map`, and returns the
  actionable items `{ internet_message_id, todo_task_id, todo_list_id,
  target_folder (= the resolved `final_target_folder`), clear_flag: true }`. A
  staged email with no To Do mapping / no destination is excluded (surfaced only as
  an `unmapped` / `no_destination` count). No Graph — just a DB read.
- PA loops the worklist, calls its **Get a to-do (V3)** action per item to check
  `status`, and for each `completed` task does the **Move + Flag-clear itself**
  (reusing Flow 1's mechanics), then POSTs the completed ids back.
- **`POST` = the report-back** (PA → LCC). Body `{ completed: [{internet_message_id}
  | "<imid>", …] }` → flips each matching row `staged → filed` (`move_status='moved'`,
  `target_folder = final_target_folder`, `moved_at`), guarded on `outcome=staged` so
  a re-report / concurrent poll flips it at most once (idempotent). PA already moved
  the email, so this is bookkeeping only.

If PA's move fails it simply doesn't report that id → the row stays `staged` (still
flagged, still in "Intake Staged, Not Completed", re-offered next tick — never
lost; the retention sweep never touches the staging folder).

## 6. Lead channels (news_alert / CREXi / LoopNet) — the edge-function twin

The `news_alert` (Google Alerts), `rcm` (CREXi/RCM LightBox), and `loopnet`
marketplace-inquiry channels don't run through `api/intake.js` — they land in
the `lead-ingest` **Supabase edge function** (Deno), which can't import the Node
`emitProcessingComplete`. So they emit through the pure ESM twin
`supabase/functions/lead-ingest/processing-complete.js`
(`targetFolderForLead` + `buildProcessingRow`) and a best-effort I/O wrapper
`emitLeadProcessingComplete()` in `lead-ingest/index.ts` that writes the SAME
`public.processing_log` row (LCC Opps):

| lead outcome | when | `target_folder` | `move_status` |
| --- | --- | --- | --- |
| `filed` | a lead was created (news alert `route=auto`; a new CREXi/LoopNet lead) | `Processed/Leads` | `pending` |
| `needs_review` | low-confidence news alert (`route=review`) | *(null — left in Inbox)* | `skipped` |
| `duplicate` | dedup-window / `source_ref` collision | `Processed/Duplicates` | `pending` |

Because these write `move_status='pending'`, the **same batch webhook pull-queue**
(§3b) moves them — one unified mover for every channel. So the lead-ingest PA
flows must **not** also move the email inline (`flow-google-news-alert.json` had
its inline "Move to Archive" removed and now defers to the pull-queue). The
flow must send the stable `internet_message_id`
(`triggerOutputs()?['body/internetMessageId']`) in the POST body so the
pull-queue can move by it; `source_ref` (the mutable Graph id) is kept as the
fallback move key. The news vertical (dialysis/government/netlease) rides the
`domain` column as metadata only — a lead always files to `Processed/Leads`,
never `Processed/Deals`.

**Env:** the edge function needs `LCC_DEFAULT_WORKSPACE_ID` (the workspace the
daily briefing filters on) set in its Supabase secrets; without it the emit is a
warned no-op (lead ingestion still succeeds) and the lead won't appear in the
briefing count. Best-effort throughout — a missing table / DB hiccup never
blocks or fails a lead ingest.

## 7. Scope / boundaries

- Fires only on a `processing_complete` emit — from `handleOutlookMessage`
  (flagged email) or a `lead-ingest` handler (§6). Mail that never went through
  intake is untouched.
- Never deletes — moving to `Processed/*` or the staging folder only. Deletion =
  the separate 30-day retention sweep on `Processed/Duplicates`.
- **Staged emails are outstanding work, never swept.** "Intake Staged, Not
  Completed" is a top-level sibling of `Processed/`, so the retention sweep's
  `Processed/*` scope never touches it — a staged email is never
  archived/deleted by age. It leaves the folder ONLY when its To Do completes
  and the poll (§5a) files it to `Processed/{category}`.
- **Non-terminal categories `stage` (not auto-file, not stay-in-Inbox).**
  deals / leads / general / infra finished-intake emails move to the staging
  folder and keep their flag until their To Do completes. Only the terminal
  categories (`news`/`reference`/`fyi`/`duplicate`) file immediately + clear the
  flag; `needs_review` stays reserved for genuinely ambiguous / failed items
  (left in the Inbox).

## 8. Open questions (deferred, best-judgment defaults in effect)

- **needs_review → staged boundary.** The intake emit sites that previously
  recorded `needs_review` for a finished-intake, non-terminal category
  (infra dedup + fresh, general/OM dedup + fresh, a successfully-recorded
  deal-closing comp) now record `staged`. Sites that record a genuine
  failure/ambiguity (a deal-closing handler failure) still record
  `needs_review`, and the low-confidence news-alert branch (edge-function
  twin, §6) stays `needs_review`. Confirm with Scott whether any other
  `needs_review` site should stage instead.
- **Visible "staged" indicator.** No Teams card / To Do "staged vs still in
  Inbox" indicator was added — the staging folder itself is the single
  "everything outstanding" view. Revisit if Scott wants an explicit badge.
