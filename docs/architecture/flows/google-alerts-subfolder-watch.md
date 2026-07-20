# Flow 3 — Google Alerts Sub-folder Watch

Last updated: 2026-07-20
Owner: LCC architecture/audit track (Scott Briggs)
Part of: `closing-the-loop-overview.md` (prompt 3 — mailbox mechanics)
Tenant: `Default-fccf69d3-58a4-4c10-a59d-14937a5f5d3f` (NorthMarq Capital, LLC)
Connector: Office 365 Outlook (Scott's mailbox)

> **RECONCILE — do not duplicate.** A production Google-Alerts flow **already
> exists** (`flow-google-news-alert.json` + `google-news-alert-power-automate.md`).
> It is **sender-triggered** (`from = googlealerts-noreply@google.com`) and POSTs
> to the **`lead-ingest` edge function** `?action=news_alert` — the single
> production news-alert channel. **Prefer keeping the sender trigger.** Only build
> a sub-folder watch if the Gmail-forward path rewrites the sender so the
> `from = googlealerts-noreply@google.com` filter no longer matches.

## The endpoint the plan got wrong

The "Closing the Loop" plan says the Google-Alerts flow should POST to
`/api/intake?_route=news-alert`. **That route does not exist.** The real,
built channel is:

```
POST {LEAD_INGEST_BASE}/lead-ingest?action=news_alert
Header: X-PA-Webhook-Secret: {PA_WEBHOOK_SECRET}
Body:   { source_ref, subject, raw_body }
```

with the response contract documented in `google-news-alert-power-automate.md`
(`{ ok, news_lead_id, domain, route, archive, … }`). Any new sub-folder watch
must call **this** endpoint — never `/api/intake?_route=news-alert`.

## Decision: sender trigger vs sub-folder trigger

| Situation | Recommended flow |
|---|---|
| Google Alerts arrive with `from = googlealerts-noreply@google.com` (direct, or a forward that preserves the sender) | **Keep the existing sender-triggered flow.** No new flow. This is the default. |
| Google Alerts are forwarded such that the original sender is masked (they arrive from Scott's own forward / a distribution address into a dedicated **Google Alerts** sub-folder) | Build the sub-folder watch below — it is the only way to catch them, since the sender filter can't match. |

Confirm which case is real before building anything. If the sender is preserved,
this sheet is a **no-op** and the existing flow already closes the loop.

## Sub-folder watch (build ONLY if the sender is masked)

### Trigger
- Type: **When a new email arrives (V3)** (Office 365 Outlook).
- **Folder:** the dedicated **Google Alerts** sub-folder the forwards land in
  (select it in the designer).
- No sender filter (the sender is masked — that's why we're using folder scope).

### Actions (mirror the existing flow's shape)
1. **Compose `AuditLog_start`** — `correlation_id = guid()`, `schema_version`,
   `internet_message_id`, subject.
2. **Html to text** — convert the Google Alert HTML body to clean plain text
   (same as the existing flow).
3. **POST** to `{LEAD_INGEST_BASE}/lead-ingest?action=news_alert` with
   `{ source_ref, subject, raw_body }` + the `X-PA-Webhook-Secret` header.
   Retry: **Exponential, 4×PT10S**.
4. **Disposition on the response** (same as the existing flow — and consistent
   with prompt 3's move layer):
   - `archive: true` (high-confidence tracked-tenant hit) → the source email is
     **moved** to its `Processed/News` destination. Prefer letting **Flow 1** do
     the move (POST the `internet_message_id` + `target_folder:"Processed/News"`
     to the processing-complete webhook) so all moves go through one place; the
     existing flow's inline "Move to Archive" is also acceptable if you're
     matching it exactly.
   - `archive: false` (`route:"review"`) → **leave it in the sub-folder / Inbox**
     for Scott's review queue. **Never auto-delete.**
   - `duplicate: true` → no new lead; a high-confidence duplicate still returns
     `archive:true` and is moved.

### Placeholders
| Placeholder | Value |
|---|---|
| `{LEAD_INGEST_BASE}` | Deployed `lead-ingest` edge-function base, e.g. `https://<ops-ref>.supabase.co/functions/v1` (same base the existing flow uses). |
| `{PA_WEBHOOK_SECRET}` | The `PA_WEBHOOK_SECRET` the edge function authenticates against (shared with RCM/LoopNet). |
| Google Alerts sub-folder | Select the dedicated forward-target folder in the designer. |

## Observability controls

| Control | How |
|---|---|
| correlation_id | `guid()` first action; on the POST. |
| schema_version | On the POST body. |
| Exponential 4×PT10S retry | On the `lead-ingest` POST. |
| Dead-letter / fault branch | Run-after has-failed/has-timed-out → shared Teams alert. |
| Logical-failure detection | Route on `ok`/`archive`; a 200-with-`ok:false` is NOT a success — do not move on it. |
| Null-safe accessors | `internet_message_id`, response fields via `?[…]`. |

## Explicitly do NOT

- **Do not duplicate the existing sender-triggered Google-Alerts flow** — if the
  sender is preserved, there is nothing to build. Running both would double-POST
  every alert.
- **Do not POST to `/api/intake?_route=news-alert`** — that route doesn't exist;
  use `lead-ingest?action=news_alert`.
- **Do not auto-delete** a low-confidence alert — it goes to Scott's review queue.

## Verify after build

1. Send a test Google Alert into the sub-folder → the flow fires and POSTs to
   `lead-ingest?action=news_alert`.
2. `GET {LEAD_INGEST_BASE}/lead-ingest?action=health` → `ops_configured: true`.
3. A tracked-tenant hit → `route:"auto"`, `archive:true`, a new `news_alert_leads`
   row, and the email moved to `Processed/News` (or Archive if matching the
   existing flow).
4. A vague no-tenant alert → `route:"review"`, left in place, visible in
   `v_news_alert_review_queue`.
5. Confirm the **existing** sender-triggered flow is either kept (sender
   preserved) or intentionally superseded — never both firing on the same alert.
