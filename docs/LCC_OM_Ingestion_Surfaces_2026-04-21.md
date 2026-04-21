# LCC OM Ingestion — Unified Surfaces
_2026-04-21 — supersedes the Copilot-bot attachment path_

## One endpoint, many surfaces

Every OM goes through the same backend: `POST /api/intake/stage-om`. The
endpoint accepts **either** `bytes_base64` (raw base64) or `data_uri` (full
`data:<mime>;base64,<body>` string) as the primary document. Whatever lands
there flows through `stageOmIntake`:

1. Create / upsert `inbox_items` on LCC Opps
2. Create `staged_intake_items` on LCC Opps (same UUID as inbox_item)
3. Attach bytes to `staged_intake_artifacts` as `inline_data`
4. Fire `processIntakeExtraction` with a 7-second race window
5. Run `matchIntakeToProperty` if extraction succeeds
6. Log an `activity_events` row for entity-scoped memory

No more split between dialysis_db writes and LCC-Opps reads — everything is
on LCC Opps now.

## Surface map

| Surface | Path today | Notes |
|---|---|---|
| **Flagged email in Outlook** | Power Automate flow → `/api/intake-outlook-message` → unified pipeline internally (2026-04-21) | Your existing flow **needs no changes**. The server-side refactor routes its attachments through `stageOmIntake` now. |
| **Manual email forward to a dedicated inbox** | Same as above (flag triggers the flow) | Fastest way to handle "Teams DM with attachment" — forward the message to a dedicated LCC intake address. |
| **Downloaded PDF on a website (Chrome sidebar)** | Existing "Extract" button enriches page context; planned "Stage to LCC" button → `/api/intake/stage-om` with `data_uri` | See §3 for the ~30-line sidebar patch. |
| **Direct API call (scripts, Postman, automations)** | `POST /api/intake/stage-om` with body: `{intake_source, intake_channel, artifacts.primary_document.{bytes_base64 \| data_uri, file_name}}` | Working today (proven via PowerShell). |
| **Copilot Studio Deal Agent** | ~~Bot ingestion~~ Q&A ONLY after ingestion | The bot's generative pipeline fails on attachments in platform-specific ways; not worth fighting. It now surfaces already-ingested OMs via `contextRetrieveEntity`. |

## 1. Email path (no changes needed on your side)

Your Outlook flow already works:

1. You flag an email in Outlook.
2. Power Automate sees the flag, posts to `/api/intake-outlook-message` with
   the email metadata + `attachments[]` containing `inline_data` (base64).
3. `api/intake.js:319` (after 2026-04-21 refactor) calls `stageOmIntake`
   with the first attachment as the primary document.
4. Staged + extracted + matched + memory-logged in one pass.

Verify it still works after deploy: flag any OM email and check
`inbox_items` on LCC Opps for a new row with `source_type = 'copilot_chat_om'`
(actually `email_om` after this refactor, since `channel: 'email'` is passed
in).

## 2. Teams / Copilot message forwarding

Until Copilot Studio fixes its generative-path attachment handling, the
best workflow is:

- When someone sends you an OM in a Teams chat or Outlook message, **forward
  the message to your dedicated LCC intake address** (the one that feeds
  your Power Automate Outlook flow).
- The email flow handles it. No bot involvement.

If you want a **one-click Teams shortcut**: build a Power Automate flow
triggered by "For a selected message" in Teams that calls
`/api/intake/stage-om` with the message's attachment bytes. That's a separate
~20-minute flow build; happy to draft it when you're ready.

## 3. Chrome sidebar "Stage to LCC" button

The existing sidebar has a `doc-ingest-btn` that extracts text for the
current page's research context. That stays. The new button does formal
intake.

**UI addition** (in the doc-card template in `extension/sidepanel.js`, near
the existing Ingest button):

```javascript
// New button, rendered next to the existing doc-ingest-btn
const stageBtn = document.createElement('button');
stageBtn.className = 'doc-stage-btn';
stageBtn.textContent = 'Stage to LCC';
stageBtn.dataset.url = url;
stageBtn.addEventListener('click', async () => {
  stageBtn.disabled = true;
  stageBtn.textContent = 'Staging…';
  try {
    // Fetch PDF bytes via background.js (CORS-safe)
    const resp = await chrome.runtime.sendMessage({
      type: 'FETCH_PDF_AS_BASE64',
      url,
    });
    if (!resp?.base64) throw new Error(resp?.error || 'fetch failed');

    const host = await getConfigValue('lccHost');
    const apiKey = await getConfigValue('lccApiKey');
    const res = await fetch(`${host}/api/intake/stage-om`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LCC-Key': apiKey,
      },
      body: JSON.stringify({
        intake_source: 'copilot',
        intake_channel: 'sidebar',
        intent: `Staged from ${location.hostname}`,
        artifacts: {
          primary_document: {
            bytes_base64: resp.base64,
            file_name: url.split('/').pop() || 'upload.pdf',
            mime_type: 'application/pdf',
          },
        },
      }),
    });
    const json = await res.json();
    if (json.ok) {
      stageBtn.textContent = `✓ Staged (${json.extraction_status})`;
      stageBtn.style.background = 'var(--green)';
    } else {
      stageBtn.textContent = `Failed: ${json.error || 'unknown'}`;
    }
  } catch (err) {
    stageBtn.textContent = `Error: ${err.message}`;
  }
});
```

**Background.js addition** — a PDF-fetch handler that returns base64:

```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_PDF_AS_BASE64') {
    (async () => {
      try {
        const r = await fetch(msg.url);
        const blob = await r.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          const base64 = dataUrl.split(',')[1];
          sendResponse({ base64 });
        };
        reader.onerror = () => sendResponse({ error: 'read failed' });
        reader.readAsDataURL(blob);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;  // keep channel open for async response
  }
});
```

Not deployed yet — apply when you're ready. Estimated ~30 min of careful
editing in the two files.

## 4. Bot configuration (post-pivot cleanup)

In Copilot Studio → LCC Deal Agent:

1. **Delete the Receive OM topic.** It never worked for attachments; the
   email path replaces it. One less moving part.
2. **Update the GPT instructions block** — remove the paragraph about
   "Receive OM topic handles ingestion." Replace with:

   > When a user asks about an OM, property, or contact, call the
   > `contextRetrieveEntity` action to pull the full memory timeline before
   > answering. For formal document intake, tell the user to forward the
   > OM email to the LCC intake address; do not attempt to process
   > attached files yourself.

3. **Add `contextRetrieveEntity` and `memoryLogTurn` as agent tools.**
   Actions → Add → From custom connector → LCC Deal Intelligence → check
   both → Add. These are the read-side tools that give the bot memory
   of ingested OMs.
4. **Optionally**: also add `intakeStageOm` as a tool. The GPT can now
   route to it when a user pastes a data URI inline, but that's an edge
   case. Useful to have available.

After changes, **Publish** the agent. Final verification: chat with the
agent about a property that has an ingested OM. It should call
`contextRetrieveEntity`, surface the extraction summary + prior activity.
