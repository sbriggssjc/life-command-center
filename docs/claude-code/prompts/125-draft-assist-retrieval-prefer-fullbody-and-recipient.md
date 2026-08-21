# Prompt 125 — draft-assist retrieval must prefer FULL-BODY and RECIPIENT-matched exemplars

**Status:** DRAFT 2026-08-21 (Cowork-diagnosed live during the P124 acceptance dry-run)

Grounding: `api/draft-assist.js` (`loadCorpus`, `retrieveExemplars`/deterministic retrieval, `voice_confidence`),
`email_bodies` (carries `body_text`/`body_html` full bodies + `body_preview`; `internet_message_id`,
`from_email`, `to_emails`). Follows P124 (classifier + fold), and the contact-history pull flow (P/W built
2026-08-20) which is now proven to backfill a contact's full thread.

## The defect (measured live 2026-08-21)

Ran the contact-history pull for `susan.holdsworth@davita.com`, then dry-ran draft-assist with
`recipient=susan.holdsworth@davita.com`. Live corpus state after the pull:

- Scott-authored `email_bodies`: **910 total, 718 full-body, 192 preview-only** (`body_text=0 AND body_html=0`).
- Scott-authored **to Susan specifically: 55, ALL 55 full-body**, newest 2026-08-20.

Yet the dry-run's retrieval returned the **same 5 exemplars as before the pull — all preview-only, and none of
them to Susan** (they're Scott's Villages follow-ups to the buyer's team / title / lender). `voice_confidence`
still reads *"preview-era OPENINGS only (~255-char cap)"*, and `corpus_size` reports **395** (< the 718
full-body rows that exist). So retrieval is (a) selecting preview-only rows while full-body rows exist, and (b)
ignoring the 55 emails Scott actually wrote to this very recipient. Per P124's own acceptance bar, a preview-era
caveat when the corpus is full-body means retrieval regressed.

## The ask

1. **Prefer full-body exemplars.** A row with `body_text=0 AND body_html=0` (preview-only) must be used ONLY as
   a last resort when no full-body exemplar exists for the bucket. With 718 full-body rows available, the
   deterministic retrieval should not be surfacing preview-only rows. Rank full-body ahead of preview, and
   report the split in `voice_confidence` honestly.
2. **Prefer recipient-matched exemplars.** When `recipient` is provided, weight Scott's own emails to/with that
   recipient most heavily — they are simultaneously the best VOICE sample and the best RELATIONSHIP-CONTEXT
   sample. Susan has 55 full-body Scott-authored emails; those should dominate the exemplar set for a draft to
   Susan, not generic same-bucket rows from other threads.
3. **Reconcile `corpus_size`.** The deployed loader reports 395 while 718 full-body Scott-authored rows exist
   and P124 measured 614/100%-full-body. Determine whether `loadCorpus` is under-loading (paging cap? PostgREST
   1000-row cap?), over-filtering, or still admitting preview rows against the P124 dedup claim — and make the
   loaded corpus match the measure. This is the same `email_bodies`-first / preview-shadow class P117/P124 hit.
4. **Re-verify by the live dry-run.** After the fix, `recipient=susan.holdsworth@davita.com` returns exemplars
   that are full-body AND from Susan's thread, and `voice_confidence` claims full-body grounding. Assert on the
   actual exemplar rows' body lengths, not a tally.

## Also observed in the same live save (2026-08-21) — fix these too

The first real save succeeded end-to-end (`saved:true`, draft in Drafts, right contact, Sent empty), but two
defects showed:

5. **The draft was a FRESH email, not a threaded reply.** draft-assist DID resolve `reply_to.internet_message_id`
   (`<MN2PR07MB6623…@namprd07…>`, the Villages "First Amendment to PSA" thread) and the seam
   (`createOutlookDraftViaPA`) is supposed to pass `in_reply_to`. Yet the created draft (`draft_id
   …AAUc9a1DAAA=`) opened as a standalone message, not a reply on that conversation. Trace whether the seam
   actually sends `in_reply_to`, and whether the PA flow's `Is_Reply` branch runs `createReply` — the earlier
   failing runs erred *inside* `Create_draft_reply`, so the reply branch WAS taken; determine why the resulting
   draft isn't threaded (createReply id vs the PATCH, or `Set_reply_body` PATCHing `toRecipients` onto a reply,
   which Graph can reject/mangle — a reply draft already carries its recipient, so likely PATCH **only** `body`,
   not `toRecipients`). The flow definition is `flow-lcc-create-outlook-draft.json`; a fix there means a
   re-import (Cowork will re-package + walk Scott through it). Verify: the saved draft's `conversationId`
   matches the source thread's.
6. **No deal context.** `facts.source` was `no_entity_relational` and `facts.used` empty — draft-assist
   attached NO deal/property facts, so the body couldn't reference the actual deal (it stayed generic). It
   should resolve the deal/property behind the thread (the Villages / 1050 Old Camp Road asset) and ground the
   draft in real, on-file facts (status, next step, open items) — never fabricated (strip to "[Not on file]",
   as it already does). Determine why entity/deal resolution returned nothing for a known active deal and wire
   the grounding.

## Close-out
- Handler changes ship on the Railway redeploy of merged `main` → `npm run verify:deploy`. A flow-definition
  fix (item 5) is a re-import, coordinated by Cowork. Update STATUS + the draft-assist design doc +
  `W10_VOICE_AND_DRAFTING_KICKOFF.md`. No `field_source_priority` change.
