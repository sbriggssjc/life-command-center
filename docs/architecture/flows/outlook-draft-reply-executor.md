# Flow — LCC Create Outlook Draft (the last mile of draft-assist)

Last updated: 2026-08-21 (P124)
Owner: LCC architecture/audit track (Scott Briggs)
Connector: Office 365 Outlook (Scott's mailbox) · Microsoft Graph passthrough
Definition: [`flow-lcc-create-outlook-draft.json`](../../../flow-lcc-create-outlook-draft.json)
Seam: `api/_shared/outlook-draft.js::createOutlookDraftViaPA`
Flag: `DRAFT_ASSIST` (Railway env **or** `feature_flags_registry.state`)

> **SAVE-NOT-SEND is the whole point of this flow.** It creates a **draft**. There is no send
> action in the definition, `api/draft-assist.js` contains no send call, and
> `test/draft-assist.test.mjs` asserts both — walking every `operationId` and every Graph `Uri`
> in the flow JSON and failing on any transmitting operation. **Do not add one.**

## Status — what is and is not verified

| | |
|---|---|
| Flow definition file | ✅ exists, updated P124 (reply branch + `bcc`) |
| Seam (`createOutlookDraftViaPA`) | ✅ shipped, sends `to/cc/bcc/subject/body_html/in_reply_to/attachment_*` |
| draft-assist passes `in_reply_to` | ✅ **new in P124** — it never did before |
| Flow consumes `in_reply_to` | ✅ **new in P124** — it silently dropped it before |
| Imported into the tenant | ❓ **UNVERIFIED** — needs the steps below |
| `PA_OUTLOOK_DRAFT_URL` set on Railway | ❓ **UNVERIFIED** — check `GET /api/diag?kind=env` |
| A real draft observed in Outlook Drafts | ❌ **not yet** — this is the acceptance gate |

**Nothing below has been exercised against a live M365 tenant from this session** (the sandbox has
no egress to Railway, Graph, or Power Automate). Treat every `operationId` as *needs confirming in
the designer* — that is normal for a Logic App definition, which only resolves `$connections` on
import.

## Why it exists

Draft-assist generates a reply grounded in the real thread history with a party, in Scott's voice.
Without this flow it can only ever return JSON. The flow is what turns that into something Scott
opens in Outlook, edits, and sends himself — the human stays the sender, always.

Microsoft Graph's own `/sendMail` would require a tenant-admin app registration we do not have.
Power Automate's Office 365 Outlook connector runs under Scott's **already-consented** M365
connection, so the flow needs no new admin grant.

## The contract — exactly what LCC POSTs

`POST <PA_OUTLOOK_DRAFT_URL>` · `Content-Type: application/json` ·
`X-LCC-Flow-Secret: <PA_OUTLOOK_DRAFT_SECRET>` (optional, validated in-flow)

```jsonc
{
  "to":              "someone@example.com",   // semicolon-delimited; REQUIRED
  "cc":              "",
  "bcc":             "",                      // offer-submission uses this
  "subject":         "Re: 1050 Old Camp Road", // REQUIRED
  "body_html":       "<div>…</div>",           // REQUIRED
  "in_reply_to":     "<AS8PR…@namprd12.prod.outlook.com>", // RFC internetMessageId, or ""
  "attachment_url":  "",
  "attachment_name": ""
}
```

Expected response — the seam reads `ok`, `draft_id`, `web_link`:

```jsonc
{ "ok": true, "draft_id": "AAMkAG…", "web_link": "https://outlook.office365.com/…", "threaded": true }
```

A non-2xx, or `{"ok": false}`, surfaces to the caller as `save_error` and the draft is simply not
created. The seam never retries and never falls back to sending.

## The threading problem (and why `createReply`)

The ask is a draft **in reply to the thread**. The connector's `Create draft (V3)` action cannot do
that: it exposes To/Cc/Bcc/Subject/Body and **no** conversation or internet-header input, so a draft
it creates is always a new thread — it looks right in the Drafts folder and lands as an orphan in
the recipient's inbox, breaking the conversation Scott is actually working.

The only operation that threads correctly is Graph's **`POST /me/messages/{id}/createReply`**, which
creates a **draft** reply carrying the right `conversationId` and `In-Reply-To`/`References`
headers. It creates and does not transmit. (Its sibling `/reply` *does* transmit — never use it.)

So the flow branches:

```
in_reply_to == ""   →  Create draft (V3)                    → standalone draft   (correct for cold email)
in_reply_to != ""   →  GET  /me/messages?$filter=internetMessageId eq '<id>'
                       POST /me/messages/{id}/createReply    → DRAFT reply on the thread
                       PATCH /me/messages/{draftId}          → replace body with LCC's HTML
```

The Graph calls go through the connector's **`Send an HTTP request`** action (`operationId:
HttpRequest`) — a passthrough that runs under the same user connection, so still no app
registration. The action's name contains "Send"; **it does not send email**, it issues an HTTP
request. That is the one place the word is not a red flag.

> **Why LCC resolves the id and Graph re-resolves it.** LCC stores the RFC `internetMessageId`
> (`email_bodies.internet_message_id`); Graph's `createReply` needs its own opaque message id. The
> `$filter` lookup is the bridge. It returns the newest match; if the message has been purged from
> the mailbox the array is empty and the flow fails loudly rather than creating an untethered draft.

## Build steps (Power Automate designer)

1. **Import** `flow-lcc-create-outlook-draft.json` (My flows → Import → Package/definition).
2. **Bind the connection.** The `$connections` reference resolves on import — select Scott's
   existing **Office 365 Outlook** connection when prompted. Do not create a service account.
3. **Confirm the operation ids** against your tenant's connector version. Open each action; if the
   designer shows "unknown operation", re-select it from the picker:
   - `Create draft (V3)` → `CreateDraftMessageV3`
   - `Send an HTTP request` → `HttpRequest`
   Re-selecting rewrites the `operationId`; re-run the test suite afterwards, since it pins the set
   to `['CreateDraftMessageV3', 'HttpRequest']` and will fail on anything transmitting.
4. **Set the shared secret.** Flow parameter `LCC_FLOW_SHARED_SECRET` → a new random string. Leave
   it empty to disable the check (the SAS-signed URL is still required).
5. **Copy the HTTP POST trigger URL** and set it on Railway:
   - `PA_OUTLOOK_DRAFT_URL=<the SAS invoke URL>`
   - `PA_OUTLOOK_DRAFT_SECRET=<the same string as step 4>`
6. **Confirm LCC sees it:** `GET /api/diag?kind=env` should report the draft-flow URL as set.
   Until then every POST returns `PA_OUTLOOK_DRAFT_URL not configured` — an honest no-op, not a
   silent failure.

## Acceptance test — run this BEFORE flipping `DRAFT_ASSIST`

The flag gates the save, so the dry-run works with the flag off. Do the reads first.

```bash
# 1. Dry-run — writes nothing, flag-independent. Confirms corpus + retrieval + threading target.
curl -s -H "X-LCC-Key: $LCC_API_KEY" \
  "$LCC/api/draft-assist?purpose=follow_up&intent=confirm+we+received+the+needs+list&recipient=<a real counterparty>" \
  | jq '{corpus: .retrieval.corpus_size,
         excluded_personal: .retrieval.excluded_personal_or_unclassified,
         bucket, exemplars: .retrieval.exemplar_count,
         reply_to, voice_confidence, flagged: .fact_validation.flagged}'
```

Assert, before going further:
- `corpus` is in the high hundreds and `bucket` matches the purpose;
- `excluded_personal` is **non-zero** — that is the P124 guard doing its job;
- `reply_to` is non-null **and** `reply_to.in_reply_to_subject` is a thread you recognise;
- `voice_confidence` claims **full-body** grounding (the corpus is 100% full bodies as of
  2026-08-21 — a preview-era caveat here means something regressed);
- `fact_validation.flagged` is empty.

```bash
# 2. Flip the flag (registry is enough — no redeploy):
#    UPDATE feature_flags_registry SET state='on' WHERE flag='DRAFT_ASSIST';
# 3. Save exactly one draft.
curl -s -X POST -H "X-LCC-Key: $LCC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"purpose":"follow_up","intent":"…","recipient":"…","save":"true"}' \
  "$LCC/api/draft-assist" | jq '{saved, outlook_draft, save_error, reply_to}'
```

**Then verify in Outlook by eye — this is the part no test can do for you:**

| check | expected |
|---|---|
| The draft is in **Drafts** | ✅ |
| **Sent Items has nothing new** | ✅ — the single most important check |
| Opening the draft shows the **quoted thread** beneath | ✅ (proves `createReply` threaded it) |
| The subject reads `RE: <original>` | ✅ |
| Voice: terse, no sign-off on an internal thread | per profile v3 |
| Voice: `Best regards,` on an LOI/offer thread | per profile v3 (69.8%) |

If Sent Items gained a message, **stop, turn the flag off, and treat it as a P0** — it would mean an
operation was re-selected to a transmitting variant in step 3.

## Known gaps (stated, not hidden)

1. **`bcc` and attachments are mapped on the standalone path only.** The `createReply` branch
   PATCHes body + `toRecipients`; it does not set `bccRecipients` or upload attachments.
   Draft-assist uses neither, so this is not a blocker for activation — but the
   **offer-submission skill does use both**, so if that skill is ever routed through the threaded
   branch, extend the PATCH first.
2. **`conversation_id` is resolved but unused.** The flow selects it for diagnostics; threading is
   carried entirely by `createReply`. Kept because a future "reply to the newest message in this
   conversation" lookup is the natural next refinement.
3. **The `$filter` picks the newest match for an `internetMessageId`.** That id is unique in
   practice; if a duplicate ever appeared the flow would reply to the newer copy.

## Reversal

- **Stop saving drafts:** `UPDATE feature_flags_registry SET state='off' WHERE flag='DRAFT_ASSIST';`
  — takes effect on the next request, no redeploy. GET dry-runs keep working.
- **Cut the seam entirely:** unset `PA_OUTLOOK_DRAFT_URL` on Railway. Every POST then returns an
  honest "not configured" and creates nothing.
- **Revert threading only:** set `in_reply_to: ''` in `api/draft-assist.js`. Drafts become
  standalone again; nothing else changes.
