# Prompt 116 — Fix: `email_bodies` body upsert 409s on existing rows (the real reason the corpus won't fill)

Grounding (read first): `api/_shared/bridge-handlers-outlook.js` (`handleOutlookMessageExtract`, the
`email_bodies` upsert ~line 121 + the Prompt-115 `body_persist_error` capture), the live schema
(`email_bodies_ws_msg_uidx` UNIQUE on `(workspace_id, internet_message_id)`; also non-unique
`ix_email_bodies_message_id` on the same cols + `email_bodies_pkey` on `id`), `api/_shared/*` opsQuery/PostgREST
helper, Prompt 115 (the body-persist fix + null-erasure guard). This is the LAST blocker on the voice corpus —
the PA sweep and the job payloads are now correct; the handler just can't write the body onto an existing row.

## The bug (traced live, 2026-08-17, LCC Opps `xengecqvemvfknjvbvrq`)

The backward Sent-Items sweep is working: **full bodies are in the job payloads** (`payload.body =
{contentType:'html', content:<8K–250K chars>}`, `from` object, tracked contacts resolve, timeline attaches).
But `email_bodies.body_html`/`body_text` stay NULL, and the Prompt-115 error field shows why:

> **544 of 557 recent body-carrying jobs recorded `result.body_persist_error = 'upsert_409'`** (only 13 ok).

Every affected `internet_message_id` **already has an `email_bodies` row** (from earlier bodyless ingestion),
so the POST to `email_bodies?on_conflict=workspace_id,internet_message_id` with `Prefer:
resolution=merge-duplicates` is returning **HTTP 409 Conflict instead of doing ON CONFLICT DO UPDATE**. The row
is never updated → the body is dropped. **The only 24 rows that ever got bodies came from the one-time backfill
migration (direct SQL), not the live handler** — which is why re-sweeping the 23K existing rows fills nothing.

## Do

1. **Diagnose why merge-duplicates 409s (verify live).** Reproduce the exact opsQuery POST the handler issues
   (same URL, `Prefer` header, body) against one existing `internet_message_id` and read the raw PostgREST
   response. Likely causes to check in order:
   - Is the `Prefer: resolution=merge-duplicates` header **actually being sent**? (Grep the opsQuery wrapper —
     if it overrides/merges `Prefer` with `return=minimal` and drops `resolution`, PostgREST does a plain INSERT →
     409 on the existing unique row. This is the prime suspect.)
   - Does PostgREST infer the conflict target from `on_conflict=workspace_id,internet_message_id`? It needs a
     UNIQUE index on exactly those cols — `email_bodies_ws_msg_uidx` exists, but confirm PostgREST resolves it
     (the extra non-unique `ix_email_bodies_message_id` on the same cols can confuse inference on some versions).
   - Report the exact 409 body/message.
2. **Fix so an existing row's body is UPDATED (fill-blanks).** Whichever the cause:
   - Ensure the upsert sends `Prefer: resolution=merge-duplicates` (and doesn't lose it to a `return=` merge),
     and the `on_conflict` matches the unique index. OR
   - If merge-duplicates can't be made reliable here, do an explicit **UPSERT-or-PATCH**: on conflict/409, issue
     a `PATCH email_bodies?workspace_id=eq.&internet_message_id=eq.` that sets `body_text`/`body_html`/
     `body_format`. **Respect the Prompt-115 null-erasure guard: only WRITE body when `content` is present, and
     do NOT null a body that's already populated** (fill-blanks — update body columns only when the incoming
     content is non-empty; never overwrite a non-empty stored body with null).
   - Keep the `body_persist_error` logging; a fixed write clears it.
3. **Backfill the already-swept jobs (no re-sweep needed).** Hundreds of `outlook.message.extract` jobs already
   hold full bodies in `enrichment_jobs.payload` but their `email_bodies` rows are empty (the 409s). Re-drive
   them through the fixed writer (re-enqueue, or a one-shot that reprocesses recent `outlook.message.extract`
   jobs whose `body_persist_error='upsert_409'`) so the corpus fills from the payloads already captured —
   mirror the Prompt-115 backfill migration pattern. Idempotent, reversible.

## Acceptance
- Live: after the fix + re-drive, `select count(*) from email_bodies where coalesce(length(body_html),0)>255 or
  coalesce(length(body_text),0)>255` climbs from 24 toward the distinct-swept count (currently 66 and rising as
  the sweep walks back); a spot-check on a previously-409'd `internet_message_id` now shows the full `body_html`
  + `body_format='html'`; new sweep jobs record no `body_persist_error`. Report the exact numbers.
- The root-cause finding (what actually caused the 409) recorded in the fix + `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md`.
- Structural test in the bridge suite: an upsert to an EXISTING `(workspace_id, internet_message_id)` with a
  non-empty body UPDATES `body_html` (not 409); an existing row with a populated body is NOT nulled by a later
  bodyless touch (null-erasure guard intact); a brand-new id still inserts.
- Docs: STATUS entry (this was the systematic blocker — 544/557 writes were 409ing) + note that the PA sweep was
  correct all along. Prompt → `done/`.

Small, targeted, reversible. Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the
post-fix live body count.
