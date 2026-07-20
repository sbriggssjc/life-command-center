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
| `filed` | OM/lease intake staged, or a deal-closing comp recorded | `Processed/{domain}` — `Processed/Deals`, `Processed/Infra`, `Processed/Leads`, `Processed/General` | move |
| `needs_review` | nothing captured, extraction failed, or an infra alert (kept visible until acknowledged) | *(null — left in place)* | none; existing flag/inbox surfaces it |
| `duplicate` | a re-flag / already-ingested email | `Processed/Duplicates` | move (recoverable ~30d) |

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
- `duplicate` → `Processed/Duplicates`
- `filed`, `domain/channel = infra` → `Processed/Infra`
- `filed`, `lead | news_alert | crexi | loopnet` → `Processed/Leads`
- `filed`, `om | lease | deal_closing | dia | gov | netlease` → `Processed/Deals`
- `filed`, otherwise → `Processed/General`

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
- Never deletes — moving to `Processed/*` only. Deletion = the separate
  30-day retention sweep on `Processed/Duplicates`.
- Infra alerts stay `needs_review` (left visible in the Inbox), by design — not
  auto-filed.
