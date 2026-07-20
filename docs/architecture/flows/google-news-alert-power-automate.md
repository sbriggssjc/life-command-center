# Google / News Alert — Power Automate flow (single cross-vertical intake)

Google Alerts on new construction / new locations for tracked tenants are a
**cross-vertical** lead source — a hit can be dialysis, government, or net-lease.
This flow is the **single production channel** for all three verticals: it POSTs
each Google Alert to the LCC `lead-ingest` edge function's `news_alert` action,
which classifies the domain, runs the confidence gate, dedups 90-day reposts, and
lands the lead in the canonical LCC-Opps `news_alert_leads` table. The LCC app
surfaces the queues (`v_news_alert_review_queue`, `v_news_alert_developer_queue`).

> The government-lease Python `email_pipeline` news-alert path was **retired** in
> favor of this flow — this is the one channel; the gov folder/`.eml` path no
> longer creates news-alert leads.

Import: `flow-google-news-alert.json` (repo root, mirrors `flow-loopnet-backfill.json`).

## What it does

1. **Trigger — sender, not subject.** `When a new email arrives (V3)` on the
   Office 365 (Northmarq) mailbox, filtered `from = googlealerts-noreply@google.com`.
   Google always sends from that address, so no subject pattern is needed.
2. **Html to text.** Google Alerts are HTML; converts the body to clean plain text.
3. **POST** to `…/lead-ingest?action=news_alert` with
   `{ source_ref, subject, raw_body, internet_message_id }` and the
   `X-PA-Webhook-Secret` header. `source_ref` = the Outlook message `id` (mutable);
   `internet_message_id` = `triggerOutputs()?['body/internetMessageId']` (the STABLE
   id the auto-archive move queue uses).
4. **The move is deferred to the auto-archive pull-queue — this flow no longer
   moves the email inline.** The `news_alert` handler records a `processing_complete`
   decision in `public.processing_log` (a high-confidence tracked-tenant hit →
   `filed`/`Processed/Leads`; a low-confidence hit → `needs_review`, left in the
   Inbox). The separate **processing-complete** Power Automate flow
   (`GET /api/webhooks/processing-complete`) reads the pending decisions and performs
   the Outlook move by `internetMessageId`, so a filed lead lands in
   **Processed/Leads** and the daily briefing counts it. A low-confidence hit is
   never moved or auto-deleted. (This unifies the move mechanism with the flagged-
   email intake — see `docs/EMAIL_AUTO_ARCHIVE.md` §6.)

## Response contract (from the edge function)

```json
{
  "ok": true,
  "news_lead_id": "…",
  "domain": "dialysis | government | netlease | null",
  "tenant": "DaVita",
  "match_kind": "exact | alias | keyword | none",
  "confidence": 0.85,
  "route": "auto | review",
  "status": "developer_unknown | needs_review",
  "archive": true,
  "target_folder": "Processed/Leads | Processed/Duplicates | null",
  "processing_complete": { "internet_message_id": "…", "outcome": "filed | needs_review | duplicate", "target_folder": "…", "move_status": "pending | skipped" },
  "article_url": "https://…"
}
```

- `route:"auto"`, `status:"developer_unknown"` → lead auto-created; the handler
  recorded a `filed` processing_complete → `target_folder:"Processed/Leads"`,
  `move_status:"pending"` (the pull-queue moves it).
- `route:"review"`, `status:"needs_review"` → lead created flagged for review;
  `needs_review` → `target_folder:null`, left in the Inbox.
- `duplicate: true` (also returned) — a syndicated repost of a story already captured
  within 90 days; no new lead → a `duplicate` processing_complete
  (`target_folder:"Processed/Duplicates"`, `move_status:"pending"`).
- `archive` is retained for backward compatibility; the flow no longer reads it (the
  move is driven by `processing_complete` / the pull-queue). Prefer `target_folder`.

## Placeholders to fill in (in `flow-google-news-alert.json`)

| Placeholder | Value |
|---|---|
| `REPLACE_WITH_LEAD_INGEST_BASE_URL` | The deployed `lead-ingest` edge-function base, e.g. `https://<ops-ref>.supabase.co/functions/v1` (the same base RCM/LoopNet use). Full URI becomes `…/lead-ingest?action=news_alert`. |
| `REPLACE_WITH_PA_WEBHOOK_SECRET` | The `PA_WEBHOOK_SECRET` the edge function authenticates against (same secret as the RCM/LoopNet flows). |

The inline "Move to Archive" step was removed (the move is now the auto-archive
pull-queue's job — §6 of `docs/EMAIL_AUTO_ARCHIVE.md`). The `Processed/Leads` /
`Processed/Duplicates` folders must exist in the mailbox (the processing-complete
flow moves into them).

## Edge-function env (LCC Opps)

- `OPS_SUPABASE_URL` / `OPS_SUPABASE_SERVICE_KEY` — already set (the `news_alert`
  handler writes here via `opsClient()`).
- `PA_WEBHOOK_SECRET` — already set (shared with RCM/LoopNet).
- `LCC_DEFAULT_WORKSPACE_ID` — the workspace the daily briefing filters on. **NEW /
  required for the `processing_complete` emit** — the lead's `processing_log` row is
  tagged with it so the briefing counts it. Absent ⇒ the emit is a warned no-op (lead
  ingestion still succeeds; the lead just won't appear in the auto-filed count).
- `TRACKED_TENANTS_JSON` *(optional)* — override the seed tenant watchlist without a
  code change. Same shape as `DEFAULT_TRACKED_TENANTS` in
  `supabase/functions/lead-ingest/news-alert.js`:
  `{ "<domain>": { "tenants": [{ "name": "...", "aliases": [] }], "keywords": [] } }`.

## Confidence gate (so you can tune it)

Confidence is driven by how directly the article matches Scott's tracked-tenant
list, with a per-kind ceiling so a loose keyword/no-tenant hit can **never**
auto-create:

| Match | Base | Ceiling | Routes to |
|---|---|---|---|
| exact tenant name | 0.85 | 0.98 | auto (developer_unknown) |
| known alias | 0.78 | 0.92 | auto (developer_unknown) |
| loose domain keyword | 0.50 | 0.65 | review (needs_review) |
| no match | 0.20 | 0.40 | review (needs_review) |

Auto threshold = 0.70. `+0.05` if city+state present, `+0.03` if an article URL was
found (both capped by the ceiling).

## Verify after deploy

1. Send yourself a test Google Alert (or wait for one). The flow should fire.
2. `GET …/lead-ingest?action=health` → `ops_configured: true`.
3. A DaVita/SSA/Dollar General alert → `domain` set, `route:"auto"`,
   `target_folder:"Processed/Leads"`, a new row in `news_alert_leads` (status
   `developer_unknown`) + a `processing_log` row (`outcome:"filed"`,
   `move_status:"pending"`). The processing-complete pull-queue then moves the email
   to **Processed/Leads**, and the daily briefing counts it (`filed`).
4. A vague "new dialysis center" alert (no tracked tenant named) → `route:"review"`,
   status `needs_review`, `target_folder:null`, email left in the Inbox, row visible in
   `v_news_alert_review_queue`.
