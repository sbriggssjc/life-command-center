# Prompt 124 — Activate draft-assist end-to-end (the payoff of the email-capture work)

**Status:** DRAFT 2026-08-21 (Cowork; the corpus + orchestration this depends on all went live 2026-08-20/21)

Grounding: `api/draft-assist.js` (route mounted `server.js:376`; `loadCorpus` drains `email_bodies` then
`activity_events`; `voice_confidence`; flag `DRAFT_ASSIST` via `_shared/feature-flag.js`; SAVE-NOT-SEND via
`createOutlookDraftViaPA` — no Graph `/sendMail` anywhere, keep it that way), the voice profile at repo-root
`BRIGGS-WRITING-VOICE.md` (currently v2.0.0), the distilled attributes `docs/os/voice/briggs-voice-attributes.json`
(GaryBuilt on-prem run, 760-sample), the UI hook (`app.js`/`detail.js`/`ops.js` "generate draft"). Doctrine:
verbatim-citation voice discipline (Prompt 100/117), honest `voice_confidence`, never send.

## Why now

Everything draft-assist reads from is finally real and current: the forward-capture sweep keeps `email_bodies`
current (both sent + received), the on-demand contact-history pull backfills a contact's full thread on demand,
and the intake→folder loop is closed. The corpus is no longer openings-only. So draft-assist can now compose a
reply grounded in the ACTUAL conversation history with a party, in Scott's measured voice — but it's still
gated off and its last mile (the Outlook-draft PA flow) isn't verified.

## The ask

1. **Fold the distilled v2 attributes into `BRIGGS-WRITING-VOICE.md`.** `briggs-voice-attributes.json` is
   synced in the repo now. Merge its evidenced per-context attributes (sign-off rates, paragraph shape,
   long-form structure, what he never does) into the profile, bump the version, keep the honest provenance
   header (corpus size, date window, thin buckets still flagged). **Do not invent** — only fold what the JSON
   evidences. This becomes the profile draft-assist reads; Scott reads/approves it before it's the default.
2. **Re-measure the corpus draft-assist actually loads** now that capture is live — report usable
   Scott-authored full-body count + per-bucket coverage, and confirm `email_bodies`-drained-first dedup still
   holds (no preview shadowing the full body). Confirm `voice_confidence` reflects the real per-draft full-body
   coverage.
3. **Verify/spec the `createOutlookDraftViaPA` last mile.** Confirm the seam's contract (what draft-assist
   POSTs, what the PA flow must do: create an Outlook **draft** in reply to the thread, never send). If the PA
   flow isn't built, produce a build sheet (like `move-queue-executor.md`) — Cowork will walk Scott through
   building it. Keep SAVE-NOT-SEND inviolable and asserted by a test.
4. **Dry-run before the flag.** With `DRAFT_ASSIST` off, generate draft-assist output for 3–5 real
   deals/contacts (grounded in their now-captured history) and surface them for review — voice quality +
   grounding accuracy + `voice_confidence` honesty — WITHOUT saving anything to Outlook.
5. **Then activation:** flip `DRAFT_ASSIST` (env + registry) after Scott approves the dry-run; test one real
   draft appearing in Outlook Drafts (not sent), in reply to a live thread, and confirm the loop.

## Verify
- Named-case voice check (not an aggregate): draft-assist on a real internal-coordination thread is terse/no
  sign-off; on an LOI/offer thread it's formal and signs off — matching the profile's measured per-bucket
  behavior. Draft lands in Drafts, never Sent. `voice_confidence` states the real grounding per draft.

## Close-out
- Handler/profile changes ship on the Railway redeploy of merged `main` → `npm run verify:deploy`. Update
  STATUS, `W10_VOICE_AND_DRAFTING_KICKOFF.md`, and the draft-assist design doc. Register the PA draft flow +
  `DRAFT_ASSIST` state in `feature_flags_registry`.
