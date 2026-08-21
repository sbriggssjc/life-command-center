# Flow — LCC Create Outlook Draft (the last mile of draft-assist)

Last updated: 2026-08-21 (P125)
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
| Imported into the tenant | ✅ a build is imported (a real save succeeded 2026-08-21) |
| `PA_OUTLOOK_DRAFT_URL` set on Railway | ✅ — the save reached the flow and returned a draft id |
| A real draft observed in Outlook Drafts | ✅ **2026-08-21** — right contact, Sent folder empty |
| That draft **threaded into the conversation** | ❌ **NO** — it opened as a standalone message |
| Definition re-imported after the P125 fixes | ❓ **PENDING — this is the remaining gate** |

**The P125 flow changes below have NOT been exercised against the live tenant** (the sandbox has no
egress to Railway, Graph, or Power Automate). Treat every `operationId` as *needs confirming in the
designer* — normal for a Logic App definition, which only resolves `$connections` on import.

### P125 — why the first real save produced an UNTHREADED draft

The save on 2026-08-21 succeeded end-to-end (`saved:true`, correct recipient, nothing sent) and
draft-assist had resolved the right thread
(`<MN2PR07MB6623B102A09A360B6640F3BCE4A42@…>`, the Villages "First Amendment to PSA" thread —
confirmed live in `email_bodies`). The seam did forward `in_reply_to`. Yet the draft was a new
message.

Three defects were found in the definition by reading the action graph. Each is fixed here; none
had been possible to *observe* from the outside, which is the more important finding:

1. **Two Response actions ran on the reply path.** `Respond_Reply_Created` sat inside the reply
   branch while `Respond_Success` ran `runAfter: Is_Reply: [Succeeded]` — i.e. after **both**
   branches. On the reply path the run therefore answered twice, and the second responder read
   `body('Create_draft')`, which is null there. Each path now carries exactly **one** responder
   (`Respond_Success` moved inside the standalone branch).
2. **`Set_reply_body` PATCHed `toRecipients` onto a reply draft.** A draft created by `createReply`
   already carries the thread's recipients; re-asserting them from the flow input bought nothing
   and is the one PATCH field Graph can reject on a reply draft. The PATCH now touches `body` only.
3. **An empty `$filter` result built a malformed URI.** When `Find_thread_message` returns no rows
   (message moved, purged, or in a mailbox this connection cannot see),
   `body(...)?['value'][0]?['id']` is null and the URI became `/me/messages//createReply`. A
   `Thread_Message_Found` guard now falls back to a standalone draft and **reports it**.

**And the reason this took a live save to notice: nothing in the response distinguished a threaded
draft from a fresh one.** `{ok, draft_id, web_link}` is identical either way. Every response now
echoes `threaded` (plus `conversationId` on the reply path); the seam surfaces it as
`outlook_draft.threaded` / `.conversation_id` / `.conversation_matches_thread`, and a save that
asked for a reply and did not get one returns a `threading_warning`. `threaded` is `null` — not
`false` — when the flow does not report it at all, because "an older import" and "it did not thread"
are different facts.

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
// reply path (threaded)
{ "ok": true, "draft_id": "AAMkAG…", "web_link": "https://outlook.office365.com/…",
  "threaded": true, "conversation_id": "AAQkAG…" }

// standalone path, or the in_reply_to-did-not-resolve fallback
{ "ok": true, "draft_id": "AAMkAG…", "web_link": "…", "threaded": false,
  "thread_note": "in_reply_to did not resolve to a message in this mailbox — created a standalone draft." }
```

`threaded` is **required** on every response (P125). Without it a standalone draft is
indistinguishable from a threaded one at the seam — which is exactly how the 2026-08-21 defect
survived a successful save.

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
                       → Respond_Success            {threaded:false}
in_reply_to != ""   →  GET  /me/messages?$filter=internetMessageId eq '<id>'
   ├─ 1+ rows       →  POST /me/messages/{id}/createReply    → DRAFT reply on the thread
   │                   PATCH /me/messages/{draftId}          → replace BODY only (never toRecipients)
   │                   → Respond_Reply_Created      {threaded:true, conversation_id}
   └─ 0 rows        →  Create draft (V3)                     → standalone fallback
                       → Respond_Unthreaded_Fallback {threaded:false, thread_note}
```

Exactly one `Respond_*` per path — `test/draft-assist.test.mjs` asserts that, because two on one
path is what the pre-P125 definition had.

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
         corpus_full_bodies: .retrieval.corpus_full_bodies,
         truncated: .retrieval.corpus_truncated,
         excluded_personal: .retrieval.excluded_personal_or_unclassified,
         bucket, exemplars: .retrieval.exemplar_count,
         full_body_exemplars: .retrieval.full_body_exemplars,
         preview_only_exemplars: .retrieval.preview_only_exemplars,
         recipient_matched: .retrieval.recipient_matched_exemplars,
         exemplar_shape: [.retrieval.exemplars[] | {full_body, cleaned_chars, to_recipient}],
         reply_to, deal: .facts.deal_resolution, voice_confidence,
         flagged: .fact_validation.flagged}'
```

Assert, before going further:
- `corpus` is in the **thousands** — Scott's whole outbound corpus, not a window of it. Live
  2026-08-21 the source rows are 1,188 (`email_bodies`) + 951 (`activity_events`) = **2,139**
  before cleaning/exclusions. A figure in the hundreds means the P125 author-filter regressed;
- `corpus_full_bodies` is the number to trust, **not `corpus`** — a corpus that halved in real
  bodies still looks healthy by row count (the P124 dedup lesson, applied to the loader);
- `truncated` is `false`;
- `excluded_personal` is **non-zero** — that is the P124 guard doing its job;
- `preview_only_exemplars` is **0** whenever full bodies exist for the bucket — preview is a last
  resort, and P125 makes that a partition rather than a weight;
- when you passed a `recipient` you have real history with, `recipient_matched` should be at or
  near `exemplars` — those are simultaneously the best voice and best context samples;
- **`cleaned_chars` will often be small (median 160 live) and that is CORRECT.** Read `full_body`,
  never the length. Scott's real emails clean down to a couple of lines; the retired length
  heuristic misfiled 62% of them as previews;
- `voice_confidence` claims **full-body** grounding — a preview-era caveat over a full-body corpus
  means something regressed;
- `reply_to` is non-null **and** `reply_to.in_reply_to_subject` is a thread you recognise;
- `facts.deal_resolution.source` names a rung. `deal_match_message` / `deal_match_thread` means the
  deal was found; `thread_not_attributed_to_a_deal` means the hourly matcher has not attributed
  this conversation yet (a real, statable gap — **not** "no deal exists").

```bash
# 2. Flip the flag (registry is enough — no redeploy):
#    UPDATE feature_flags_registry SET state='on' WHERE flag='DRAFT_ASSIST';
# 3. Save exactly one draft.
curl -s -X POST -H "X-LCC-Key: $LCC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"purpose":"follow_up","intent":"…","recipient":"…","save":"true"}' \
  "$LCC/api/draft-assist" | jq '{saved, outlook_draft, threading_warning, save_error, reply_to}'
```

**The threading gate, checkable without opening Outlook (P125):**
- `outlook_draft.threaded` is `true`;
- `outlook_draft.conversation_matches_thread` is `true` — the created draft's `conversationId`
  equals the source thread's. This is the assertion the 2026-08-21 defect needed and did not have;
- `threading_warning` is `null`.

If `threaded` is **`null`**, the tenant is still running a pre-P125 import — re-import
`flow-lcc-create-outlook-draft.json` before trusting any threading claim. If it is `false` with a
`thread_note`, the message id did not resolve in the mailbox and the flow correctly fell back.

**Then verify in Outlook by eye — this is the part no test can do for you:**

| check | expected |
|---|---|
| The draft is in **Drafts** | ✅ |
| **Sent Items has nothing new** | ✅ — the single most important check |
| Opening the draft shows the **quoted thread** beneath | ✅ (proves `createReply` threaded it) |
| The draft appears **inside the conversation**, not as a new message | ✅ — the P125 regression check |
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
