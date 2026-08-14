# Prompt 110 — Fuller email-body ingestion (past the ~255-char bodyPreview cap)

Grounding (read first): `api/intake.js` (~lines 609–630, 1018–1041 — the body-storage path, which ALREADY
accepts `body_text`/`body_html` and prefers them over `bodyPreview`), `api/_shared/bridge-handlers-outlook.js`
(~128–131, the bridge writer — also handles `body_text`/`body_html`), the W9.4 display-name PA-flow doc
(`docs/audits/W9_4_display_name_capture_2026-08-12.md` — the exact same *forward-only PA flow change* shape),
`api/draft-assist.js` (`loadCorpus` ~86–112 — reads `body_preview`), `api/_shared/voice-corpus-clean.js` (built
around the ~255-char preview), the reachability-harvest signature arm, `BRIGGS-WRITING-VOICE.md` (Stage-1 profile).

## The finding (grounded live, 2026-08-14)

The correspondence store keeps only Graph's **`bodyPreview` (~255-char cap)**; `email_bodies.body_text` /
`body_html` are empty on ~all rows. This caps three things: **draft-assist RAG** (retrieves openings, not full
precedent), the **voice profile's** sign-off/long-form fidelity (Stage-1 LOW-confidence finding), and the
**harvest signature-phone arm** (can't see full signatures).

**Key discovery — the ingestion CODE is already ready.** `api/intake.js` already reads `payload.body_text` /
`payload.body_html`, clamps them (100K / 200K), and writes them to `email_bodies` (lines 1040–1041); the comment
at ~610 says exactly this — "*If the flow attaches a full body via a 'Get email (V3)' step (passed as body_text),
prefer it.*" So the fields are empty **only because the Power Automate flows don't send them yet** (they post
`bodyPreview` only). This is a forward-only *flow change* + a small consumer-wiring change — NOT a rebuild.

## Part A — Power Automate flow change (Scott's manual step — the actual unlock)

Document the EXACT click-path (mirror the W9.4 doc's format) for the **flagged-inbound**, **Sent-Items**, and any
**bridge** flow that POSTs to `/api/intake?_route=outlook-message` / `?_route=outlook-sent`:

1. After the trigger, add a **"Get email (V3)"** action (Office 365 Outlook) → Message Id = the trigger's
   message id; set **Include Attachments = No**, and ensure the body is returned as **HTML** (or text).
2. In the HTTP "POST to LCC" body, add two fields alongside the existing ones:
   - `"body_html": <Get email V3 → Body>` (the full HTML body), and/or
   - `"body_text": <Get email V3 → Body Preview is NOT it — use the full Body; if only HTML is available, LCC
     will store it as body_html and the readers strip tags>`.
3. Save. **No LCC redeploy needed for this** — the endpoint already accepts these fields (verify with
   `GET /api/diag?kind=env` / a single test send: a new row should show non-empty `email_bodies.body_text`
   or `body_html`). Forward-only: new mail carries full bodies; historical rows are Part C.

## Part B — consumer wiring (code: prefer full body when present)

Right now the consumers read the capped `body_preview` even where a full body would be available. Make them
**prefer `body_text` (full) → else `body_html` (tag-stripped) → else `body_preview` (capped)**, forward-compatible
(falls back cleanly while bodies are still empty):

1. **draft-assist `loadCorpus`** (`api/draft-assist.js` ~86–112): `select` and push `body_text`/`body_html` and
   prefer them over `body_preview`; the RAG retrieval + exemplar text then use full bodies as they arrive.
2. **`voice-corpus-clean.js`**: its cleaner already strips reply chains/sigs — feed it the full body when present
   (the cleaning matters MORE on full bodies). Update the module's cap comment; keep the deterministic cleaning.
3. **reachability-harvest signature arm**: prefer the full body for signature-phone extraction (more signatures
   become visible). Keep the verbatim validator.
4. Note the downstream upgrade path in `BRIGGS-WRITING-VOICE.md` / the W10 kickoff: once full bodies accrue, the
   voice **distill can be re-run** for real sign-off/long-form fidelity (Stage-1's LOW-confidence buckets), and
   draft-assist's `voice_confidence` note should reflect full-body coverage where present.

**Guardrail:** full bodies contain third-party PII / deal-confidential content — the same corpus-hygiene doctrine
applies (Scott's own outbound; strip quoted/forwarded chains before any persisted style artifact; never egress to
a cloud model — on-prem only). No behavior change to who can read what.

## Part C — historical backfill (scope only; don't over-build)

The ~23K existing rows have empty bodies. `email_bodies.internet_message_id` is stored, so a backfill is possible
via a **PA "Get email (V3) by message-id" loop** (the durable path — same shape as the doc-bytes backfill) OR a
Graph-API server-side fetch (needs delegated Graph auth — likely Scott's infra, may not be reachable from Railway,
same session-bound caveat as CoStar). **Scope the feasible option, don't build it here** — recommend the PA
backfill loop keyed on `internet_message_id`, bounded/resumable, forward-only-first. Flag as its own future unit.

## Acceptance
- Part A documented as a copy-paste PA click-path (like the W9.4 doc), with the one-line verification query.
- Part B: consumers prefer full body when present, fall back to preview cleanly (tests: a row with `body_text`
  uses it; a row with only `body_preview` still works). No regression to draft-assist's 29 tests / voice cleaner.
- Part C: a short feasibility note + recommended approach; NO build.
- Docs: ROLLOUT_STATUS Wave 10 (a "full-body ingestion" line) + STATUS entry + W10 kickoff (retire the
  "deferred" note, point to this unit); prompt → `done/`.

Commit with the repo Co-Authored-By + Claude-Session trailer. One PR (Part B code + docs); Part A is Scott's
Power-Automate step, Part C is a scoped follow-on.
