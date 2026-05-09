# iOS Shortcut: "Send to LCC"

A single share-sheet shortcut that forwards LinkedIn posts, Instagram posts,
articles, emails, and ad-hoc screenshots to `POST /api/intake-share` for
Vision extraction and staging in `intake_share_inbox`.

## What it captures

| Source           | What gets sent                                        |
| ---------------- | ----------------------------------------------------- |
| LinkedIn (iOS)   | Post URL + (optional) screenshot from Photos          |
| Instagram        | Post URL + screenshot                                 |
| Safari article   | Page URL + selected text                              |
| Mail / Outlook   | Email body text + URL                                 |
| Photos           | Just the screenshot                                   |
| Manual           | Free-text note                                        |

The backend auto-detects the domain (gov-leased vs dialysis vs general) from
the content, so a single shortcut covers every case. The optional menu lets
you override the hint when you already know.

## Backend prerequisites

1. Apply the migration:
   `sql/20260506_intake_share_inbox.sql` against the OPS Supabase project.
2. Set Vercel env vars (Production + Preview):
   - `OPS_SUPABASE_URL`, `OPS_SUPABASE_KEY` (already set if other intake routes work)
   - `LCC_API_KEY` (the Shortcut authenticates with this)
   - `OPENAI_API_KEY` and/or `AI_CHAT_URL` — same vars the existing extractor uses
3. Deploy. Endpoint is at `https://<your-host>/api/intake-share`.

Smoke test:

```bash
curl -X POST https://<your-host>/api/intake-share \
  -H "X-LCC-Key: $LCC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "linkedin",
    "url": "https://www.linkedin.com/posts/andy-gallas_...",
    "text": "Closed. State of Ohio Dept of Taxation HQ, 320,000 SF, lease through Jun 2037, sold April 2025.",
    "notes": "test"
  }'
```

You should get back `{ ok: true, id, extraction: {...}, extraction_status: "extracted" }`.

## Building the iOS Shortcut

Open the **Shortcuts** app on your iPhone and create a new shortcut named
**Send to LCC**.

### Settings

- **Receive**: turn on _Show in Share Sheet_
- **Share Sheet Types**: URLs, Text, Images, Files, Safari web pages

### Actions (in order)

1. **Receive Any input from Share Sheet**
   _If there's no input:_ Continue (don't stop).

2. **Get Type of `Shortcut Input`** → Variable `InputType`

3. **If** `Shortcut Input` _has any value_
     - **If** `Shortcut Input` _is_ URL
         - **Get URLs from Input** → variable `SharedURL`
     - **Otherwise If** `Shortcut Input` _is_ Image
         - **Encode Media** → Base-64
         - Store result → variable `ImageB64`
     - **Otherwise**
         - **Get Text from Input** → variable `SharedText`
   **End If**
   **End If**

4. **Ask for Input** (Text, prompt: "Notes (optional)") → variable `Notes`. Default: empty.

5. **Choose from Menu** with items:
   - "Auto-detect"  → variable `Domain` = (empty)
   - "Government lease" → variable `Domain` = `gov_lease`
   - "Dialysis" → variable `Domain` = `dialysis`
   - "General" → variable `Domain` = `general`

6. **Dictionary** (build the JSON body). Use _Type_ `Dictionary` with keys:
   ```
   source       → Text:  linkedin     (you can hard-code "linkedin" or change per-shortcut variant)
   url          → Text:  SharedURL    (use magic-variable; leave empty if none)
   text         → Text:  SharedText   (magic-variable; empty if none)
   notes        → Text:  Notes
   domain_hint  → Text:  Domain       (empty string is fine; backend treats it as null)
   images       → List of Dictionaries:
       - if ImageB64 has any value:
           Dictionary:
             mime_type → Text: image/jpeg
             base64    → Text: ImageB64
   ```
   _Tip:_ in Shortcuts you can build the `images` array with an
   **If `ImageB64` has any value → Add to List → Dictionary{mime_type, base64}**
   block, then convert the List to a List inside the outer dictionary.

7. **Get Contents of URL**
   - URL: `https://<your-lcc-host>/api/intake-share`
   - Method: `POST`
   - Headers:
     - `X-LCC-Key`: _your `LCC_API_KEY` value_
     - `Content-Type`: `application/json`
   - Request Body: **JSON** → use the Dictionary from step 6.

8. **Get Dictionary Value** for key `extraction.post.summary` from the response (optional).

9. **Show Notification**
   - Title: "Sent to LCC"
   - Body: `Contents of URL` (or just the summary if you grabbed it).

### Variants worth creating

Duplicate the shortcut with hard-coded `source` values so you can pick the
right one from the share sheet without an extra menu tap:

- **Send to LCC (LinkedIn)** — `source: "linkedin"`
- **Send to LCC (Instagram)** — `source: "instagram"`
- **Send to LCC (Article)** — `source: "article"`
- **Send to LCC (Mail)** — `source: "mail"`

The backend treats them identically; the `source` value is just stored for
filtering in the review UI.

## Mobile usage

- **From the LinkedIn iOS app**: tap **Share** on a post → **Send to LCC**.
  LinkedIn's share sheet only exposes the post URL, not the image. To attach
  the screenshot:
  1. Take a screenshot of the post first (Volume Up + Side button).
  2. From the screenshot preview, tap **Share** → **Send to LCC** and the
     image is included automatically.
  3. _Or_ run the shortcut from the share sheet on the post and let it
     pick up just the URL — the extractor will hit the URL and fall back to
     text-only extraction.

- **From Safari**: tap **Share** → **Send to LCC**. URL + selected text both
  go through.

- **From Mail/Outlook**: tap and hold the email body → **Share** → **Send to LCC**.

## Backend behavior

- Stages a row in `intake_share_inbox` with `extraction_status='extracting'`.
- Calls `extractFromShare()` which routes through the existing
  `invokeChatProvider` chain (Claude via edge → OpenAI fallback). Vision is
  used when images are attached.
- On success, stores the JSON in `extraction`, sets `detected_domain` and
  `confidence`, flips `extraction_status` to `extracted`.
- On failure, the row stays with `extraction_status='failed'` and an error
  string in `extraction_error` so nothing is lost.
- The shortcut response includes the structured payload so you can verify
  the extraction looked right while you're still on the post.

## Phase 2 — promotion to canonical records

Phase 1 (this PR) only stages and extracts. Promotion to the per-domain
Supabase projects (`gov_lease.properties`, `dialysis.properties`,
`sales_transactions`, broker `contacts`) happens via the existing
`/api/intake-promote` route. To wire it:

1. In the LCC inbox UI, render rows where `extraction_status='extracted'
   AND status='new'` — show the extracted property card with confidence.
2. On approve, call `/api/intake-promote` with a body shaped from the
   `extraction` jsonb, then `PATCH /api/intake-share?id=…` with
   `{ status: 'promoted', promoted_to: {…} }`.
3. Auto-promote rule (optional): if `confidence >= 0.85` and
   `detected_domain` matches `domain_hint`, promote without UI review.

The auto-promote rule is intentionally out of scope here — it's safer to
review the first 5–10 extractions before flipping that switch on.
