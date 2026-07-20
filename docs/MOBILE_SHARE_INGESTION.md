# iPhone Share Sheet → LCC Mobile Ingestion

One-tap capture of LinkedIn posts, articles, and any web page from the iPhone
Share Sheet ("Send to LCC"). Covers the mobile gap the Chrome/Edge extension
(desktop) and Google-Alert / forwarded-email channels (inbox) don't reach.

The share flows through the **same cross-vertical lead/contact pipeline** the
Google/News-Alert channel uses — it reuses the news-alert scoring functions
verbatim (`matchTenant` / `scoreNewsAlert` / `routeNewsAlert`) and lands in the
canonical LCC-Opps `news_alert_leads` table (or logs a touch on an existing
entity). No app switching, no typing.

## Part A — Backend route (shipped)

`POST /api/intake?_route=mobile-share`

- **Auth:** `X-LCC-Key` header (same pattern as the other intake routes / Power
  Automate).
- **Body (JSON):** `{ url, title, selected_text?, shared_at? }`
- **Classification:** a `linkedin.com` URL is tagged `source:'linkedin'`; anything
  else `source:'web_share'`. Tenant/property name matching runs over
  `title + selected_text` using the **same** news-alert confidence scoring (not a
  copy) plus a `City, ST` extractor for the location.
- **Routing (mirrors the news-alert decision tree):**
  - A tracked tenant that resolves to an **existing LCC entity** (contact / owner /
    property) → logs an **activity touch** on that entity (`activity_events`, the
    same shape the Outlook add-in uses). `outcome:'logged'`.
  - A high-confidence tenant/location signal with **no existing record** → creates a
    `news_alert_leads` row, `source:'linkedin'|'web_share'`, `status:'developer_unknown'`.
    `outcome:'lead_created'`.
  - Low confidence / no match → a lightweight `needs_review` row carrying the raw
    url + title for Scott to eyeball and dismiss or promote. `outcome:'needs_review'`.
- **Response:** `{ status:'ok', outcome:'logged'|'lead_created'|'needs_review', ... }`
  — a one-liner the Shortcut shows as a confirmation banner (no app to open).

**Idempotent:** re-sharing the same URL collapses (stable `source_ref` +
the 90-day tenant/city/state repost guard), same as the news-alert channel.

> **Note on the lead table:** the cross-vertical hub the news-alert channel feeds
> is `news_alert_leads` (LCC Opps), not the gov-domain `prospect_leads` (which
> requires a `matched_property_id`). A shared LinkedIn post has no property, so it
> lands in the cross-vertical hub with the same `developer_unknown` / `needs_review`
> lifecycle the news-alert leads use. Surface both in the LCC app via
> `v_news_alert_developer_queue` / `v_news_alert_review_queue`.

## Part B — iOS Shortcut (one-time setup on the iPhone)

1. **Shortcuts app → + (New Shortcut) → Add Action → "Get Contents of URL".**
   - **URL:** `https://life-command-center-nine.vercel.app/api/intake?_route=mobile-share`
     (or whichever host serves the live app — production runs the Railway Express
     server; use the URL that fronts it).
   - Tap **Show More**:
     - **Method:** `POST`
     - **Headers:** add `X-LCC-Key` = *(the LCC API key)* and
       `Content-Type` = `application/json`
     - **Request Body:** `JSON`, with fields:
       - `url` → **Shortcut Input** (the URL from the Share Sheet)
       - `title` → the shared item's **Name** (if available), else Shortcut Input
       - `shared_at` → **Current Date** (formatted ISO 8601)
       - *(optional)* `selected_text` → **Shortcut Input** when text is shared

2. **Enable "Show in Share Sheet"** (Shortcut settings, the ⓘ / details panel).
   - Under **Share Sheet Types**, restrict input to **URLs** and **Text** so the
     action only appears where relevant.

3. **Add a final "Show Notification" action.**
   - Set the text to the response's `outcome` (e.g. from the "Get Dictionary Value"
     of the response → `outcome`), so Scott sees a one-line confirmation
     ("Lead created" / "Logged as touch" / "Needs review") without opening anything.
   - Optionally map: `logged` → "Logged as touch", `lead_created` → "Lead created",
     `needs_review` → "Saved for review".

4. **Name it "Send to LCC"** and test: open a **LinkedIn** post → **Share** →
   **Send to LCC** appears → one tap → the confirmation banner shows the outcome.

## Env (optional)

- `TRACKED_TENANTS_JSON` — override the tracked-tenant watchlist without a code
  change (same knob as the lead-ingest edge handler; falls back to the seed list).
