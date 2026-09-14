# Prompt 110 — Fuller email-body ingestion (past the ~255-char bodyPreview cap)

**Status: DONE (2026-08-14).** Consumer code + docs shipped in one PR; Part A is
Scott's Power-Automate step; Part C is a scoped future unit. See
`docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md`.

## The finding

The correspondence store keeps only Graph's `bodyPreview` (~255-char cap);
`email_bodies.body_text`/`body_html` are empty on ~all rows. Caps draft-assist RAG,
the voice profile's sign-off/long-form fidelity, and the harvest signature arm.

**Key discovery — the ingestion CODE is already ready.** `api/intake.js` already
reads `payload.body_text`/`body_html`, clamps them (100K/200K), and writes them to
`email_bodies`, preferring them over `bodyPreview`. Empty only because the PA flows
don't send them yet. Forward-only flow change + small consumer wiring — NOT a rebuild.

## What shipped

- **Part A (Scott's manual step).** Documented copy-paste PA click-path (mirrors the
  W9.4 doc): "Get email (V3)" action → add `body_html` (full body) to the POST to
  `/api/intake?_route=outlook-message` / `?_route=outlook-sent` / bridge. Verification
  query on `email_bodies`.
- **Part B (code).** `pickBestBody`/`htmlToText` in `api/_shared/voice-corpus-clean.js`;
  draft-assist `loadCorpus` + harvest signature arm prefer the full body, fall back to
  the preview cleanly. Tests: voice-corpus-clean (+9), draft-assist (29), harvest (50).
- **Part C (scoped, NOT built).** Recommended: a bounded/resumable PA "Get email (V3)
  by message-id" backfill loop keyed on `internet_message_id`, forward-only-first.

## Acceptance

- [x] Part A documented as a copy-paste PA click-path with a one-line verification query.
- [x] Part B: consumers prefer full body when present, fall back to preview cleanly; no
  regression to draft-assist's 29 tests / voice cleaner.
- [x] Part C: feasibility note + recommended approach; no build.
- [x] Docs: ROLLOUT_STATUS Wave 10 line + STATUS entry + W10 kickoff (deferred note
  retired). Prompt → `done/`.
