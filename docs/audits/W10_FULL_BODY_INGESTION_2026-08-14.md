# W10 — Fuller email-body ingestion (past the ~255-char bodyPreview cap) (2026-08-14, Prompt 110)

**Status: SHIPPED (consumer code + this doc).** The ingestion CODE was already
ready — `api/intake.js` accepts `body_text`/`body_html`, clamps them (100K/200K),
and prefers them over `bodyPreview`. The fields are empty only because the Power
Automate flows post `bodyPreview` only. This unit (a) documents the forward-only
PA flow change that is the actual unlock (Part A, Scott's step), (b) wires the
consumers to PREFER the full body when present and fall back to the preview
cleanly (Part B, code), and (c) scopes — does not build — the historical
backfill (Part C).

## The finding (grounded live, 2026-08-14)

The correspondence store keeps only Graph's `bodyPreview` (~255-char cap);
`email_bodies.body_text` / `body_html` are empty on ~all rows. This caps three
things:

- **draft-assist RAG** (`api/draft-assist.js`) — retrieves openings, not full
  precedent.
- **the voice profile** (`BRIGGS-WRITING-VOICE.md`) — sign-off / long-form
  fidelity is a Stage-1 LOW-confidence finding (the signal is ~31-word openings).
- **the harvest signature-phone arm** (`api/_shared/reachability-harvest-planner.js`)
  — can't see full signatures, so fewer signature phones become visible.

**Key discovery — the endpoint is already ready.** `api/intake.js`
(`handleOutlookMessage`, ~lines 609–630, 1040–1041) already reads
`payload.body_text` / `payload.body_html`, clamps them, and persists them; the
bridge writer `api/_shared/bridge-handlers-outlook.js` (~128–131) already writes
`email_bodies.body_text`/`body_html` from the Graph `body` object. So this is a
**forward-only flow change + a small consumer-wiring change — NOT a rebuild.**

---

## Part A — Power Automate flow change (Scott's manual step — the actual unlock)

Mirror the W9.4 display-name doc. Apply to every flow that POSTs to
`/api/intake?_route=outlook-message`, `?_route=outlook-sent`, and any bridge flow
posting the same shape: the **flagged-inbound** flow, the **Sent-Items** flow, and
any **bridge** flow.

### Exact click-path

1. **Add a "Get email (V3)" action** (Office 365 Outlook connector) immediately
   after the trigger:
   - **Message Id** = the trigger's message id (dynamic content: "Message Id" /
     `triggerOutputs()?['body/id']`).
   - **Include Attachments** = **No** (we only want the body here; attachments ride
     the existing OM path).
   - Ensure the body is returned as **HTML** (the default) — LCC stores it as
     `body_html` and the readers strip the tags. Text is also accepted.

2. **In the HTTP "POST to LCC" action's JSON Body**, keep every existing field and
   add ONE of these (both is fine):
   - `"body_html": <Get email (V3) → Body>` — the full HTML body, **or**
   - `"body_text": <Get email (V3) → Body>` — only if your flow already converts
     to plain text (e.g. an `html-to-text` step). ⚠️ **Do NOT use the trigger's
     "Body Preview"** — that is the ~255-char cap this unit exists to get past. Use
     the **full Body** from the Get email (V3) step.

   Example body fragment (added alongside the existing fields):
   ```json
   {
     "...": "existing fields unchanged",
     "body_html": "@{outputs('Get_email_(V3)')?['body/body']}"
   }
   ```

3. **Save.** No LCC redeploy is needed for the endpoint to accept these — it
   already does. (The Part-B consumer wiring ships on the next Railway redeploy of
   merged `main`; it is forward-compatible either way.)

### One-line verification

After saving, send/flag ONE test email, then confirm a NEW row carries a full
body (run on **LCC Opps**):

```sql
SELECT internet_message_id, length(body_preview) AS preview_len,
       length(body_text) AS text_len, length(body_html) AS html_len
FROM email_bodies
ORDER BY COALESCE(received_at, sent_at) DESC NULLS LAST
LIMIT 5;
```

A working flow shows `text_len` or `html_len` well above the ~255 `preview_len`.
(Also confirm the endpoint is reachable/configured via `GET /api/diag?kind=env`.)

**Forward-only:** new mail carries full bodies from the moment the flow is saved;
historical rows are Part C.

---

## Part B — consumer wiring (code: prefer full body when present)

Single shared resolver `pickBestBody({ body_text, body_html, body_preview, body })`
(+ dependency-free `htmlToText`) added to `api/_shared/voice-corpus-clean.js`:
**full `body_text` → tag-stripped `body_html` → capped `body_preview`/`body` →
`''`**. Forward-compatible — falls back to the preview exactly as before while
bodies are still empty. On-prem only (regex tag-strip, no parser dep, nothing
egresses).

1. **draft-assist `loadCorpus`** (`api/draft-assist.js` ~86–115): the `email_bodies`
   `select` now pulls `body_text,body_html`; both loops route the raw body through
   `pickBestBody` before `cleanEmailBody`. RAG retrieval + exemplar text use the
   full body as it arrives; the ~255-char preview is still used when that's all a
   row has.
2. **`voice-corpus-clean.js`**: the deterministic cleaner is UNCHANGED (it already
   strips reply chains / sigs and matters MORE on a full body). Added `htmlToText`
   + `pickBestBody`; updated the grounding/cap comment for the full-body era.
3. **reachability-harvest signature arm** (`api/admin.js` `harvestBuildCommsIndex`,
   ~line 4968): `signatureRegion` now reads `pickBestBody({ body_text, body_html,
   body })` from `metadata` first, then the row's preview `body` — so the whole
   signature block is visible when the flow forwarded it. The verbatim-quote
   validator is unchanged.
4. **Downstream upgrade path** (noted in `BRIGGS-WRITING-VOICE.md` + this doc): once
   full bodies accrue, re-run the on-prem voice distill (`scripts/voice-distill.mjs`)
   for real sign-off / long-form fidelity (Stage-1's LOW-confidence buckets), and
   let draft-assist's `voice_confidence` note reflect full-body coverage where
   present.

**Guardrail (unchanged doctrine):** full bodies contain third-party PII /
deal-confidential content. Same corpus-hygiene rules apply — Scott's own outbound
only; strip quoted/forwarded chains + signatures before any persisted style
artifact (the cleaner does this); never egress to a cloud model (on-prem Ollama
only). No change to who can read what — visibility/private scoping is untouched.

### Tests

`test/voice-corpus-clean.test.mjs` (+9: `htmlToText` tag-strip/entity-decode/
script-drop/empty; `pickBestBody` text-preferred / html-fallback / preview-fallback
/ snippet-key / empty / full-body-cleans-to-prose). `test/draft-assist.test.mjs`
(29) + `test/reachability-harvest-planner.test.mjs` (50) + `test/outlook-recipients.test.mjs`
still green. A row with `body_text` uses it; a row with only `body_preview` still
works.

---

## Part C — historical backfill (feasibility only — NOT built)

The ~23K existing `email_bodies` rows have empty bodies. `internet_message_id` is
stored on every row, so a backfill IS possible. Two options:

- **PA "Get email (V3) by message-id" loop (RECOMMENDED).** The durable path —
  same shape as the doc-bytes backfill (`?_route=doc-bytes-backfill`): a bounded,
  resumable (keyset-cursor on `internet_message_id`) PA flow that, for each row
  with an empty body, calls Get email (V3) by the stored message id and POSTs the
  full body back to a small backfill seam. Forward-only-first (verify Part A lands
  on new mail before draining history). Uses the SAME Graph/PA egress Scott already
  runs — no new infra, no session-bound-link problem.
- **Graph-API server-side fetch.** Needs delegated Graph auth from Railway, which
  is likely Scott's infra and may not be reachable from the Railway datacenter
  (same session-bound caveat as the CoStar CDN fetch). Higher lift, more fragile.

**Recommendation:** the PA backfill loop keyed on `internet_message_id`,
bounded/resumable, forward-only-first. **Flag as its own future unit** — do not
build here.

---

## Rollout order

1. Scott applies the Part A PA flow change (per-flow) — the actual unlock.
2. This code (Part B) ships on the next Railway redeploy of merged `main` (forward-
   compatible; safe to deploy before or after the flow change).
3. After a few days' accrual, re-run the voice distill on the box and re-check
   draft-assist retrieval quality on a real thread.
4. Part C (historical backfill) is a separate future unit.
