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
   `{ source_ref, subject, raw_body }` and the `X-PA-Webhook-Secret` header.
4. **Archive on `archive:true`.** The response says whether it was a high-confidence
   tracked-tenant hit. Only then is the source email moved to **Archive** (no manual
   step). A low-confidence hit is **left in the Inbox** for Scott's review queue —
   it is never auto-deleted.

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
  "article_url": "https://…"
}
```

- `archive: true`  → `route:"auto"`, `status:"developer_unknown"` — lead auto-created,
  the flow archives the email.
- `archive: false` → `route:"review"`, `status:"needs_review"` — lead created flagged
  for review; the flow leaves the email in the Inbox.
- `duplicate: true` (also returned) — a syndicated repost of a story already captured
  within 90 days; no new lead. A high-confidence duplicate still returns `archive:true`.

## Where to POST — two equivalent targets (either works)

`action=news_alert` is reachable at **both**:

1. **Railway app** (the same host RCM/LoopNet use):
   `https://<railway-app>.up.railway.app/api/lead-ingest?action=news_alert`
   `server.js` mounts `/api/lead-ingest` → `api/sync.js` (`?_route=lead-ingest`),
   which **proxies to the edge function** below (mirroring the rcm/loopnet
   `proxyToLeadIngest` pattern). This is the production path.
2. **Edge function directly:**
   `https://<ops-ref>.supabase.co/functions/v1/lead-ingest?action=news_alert`.

Use the Railway URL if your PA flow already targets the Railway host — no
repoint needed. A `GET .../api/lead-ingest?action=health` on either target
returns `ops_configured: true` when the LCC-Opps env is set.

## Two things to verify in your PA flow (common mistakes)

- **`raw_body` must be the EMAIL BODY**, not `sensitivityLabelInfo`. Wire it to
  `@{body('Html_to_text')?['text']}` (via the `Html to text` action on
  `@triggerOutputs()?['body/body']`), or at minimum
  `@{triggerOutputs()?['body/body']}`. If it points at `sensitivityLabelInfo`
  the classifier receives garbage and every alert routes to `needs_review`.
- **Link-wrapping caveat:** if the mailbox rewrites URLs through Mimecast /
  Safe-Links, `article_url` will be the wrapper (e.g.
  `https://url.us.m.mimecastprotect.com/s/...?domain=google.com`). That is
  harmless for classification (confidence is driven by the tenant match, not the
  URL) but the stored `article_url` will be the wrapper, not the original story.

## Placeholders to fill in (in `flow-google-news-alert.json`)

| Placeholder | Value |
|---|---|
| `REPLACE_WITH_LEAD_INGEST_BASE_URL` | Either the Railway app base (`https://<railway-app>.up.railway.app/api` — full URI `…/api/lead-ingest?action=news_alert`) **or** the edge-function base (`https://<ops-ref>.supabase.co/functions/v1` — full URI `…/lead-ingest?action=news_alert`). Both reach the same handler. |
| `REPLACE_WITH_PA_WEBHOOK_SECRET` | The `PA_WEBHOOK_SECRET` the edge function authenticates against (same secret as the RCM/LoopNet flows). |
| `folderPath: "Archive"` (Move step) | Confirm/select the destination Archive folder in the designer if your mailbox uses a different one. |

## Edge-function env (LCC Opps)

- `OPS_SUPABASE_URL` / `OPS_SUPABASE_SERVICE_KEY` — already set (the `news_alert`
  handler writes here via `opsClient()`).
- `PA_WEBHOOK_SECRET` — already set (shared with RCM/LoopNet).
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
3. A DaVita/SSA/Dollar General alert → `domain` set, `route:"auto"`, a new row in
   `news_alert_leads` (status `developer_unknown`), and the email moved to Archive.
4. A vague "new dialysis center" alert (no tracked tenant named) → `route:"review"`,
   status `needs_review`, email left in the Inbox, row visible in
   `v_news_alert_review_queue`.
