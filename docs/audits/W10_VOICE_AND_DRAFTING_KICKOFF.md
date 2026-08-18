# Kickoff — Wave 10: Voice & Drafting (Scott's authored corpus → grounded BD/response drafts)

> Scott's directive (2026-08-13): "Now that we are fully ingesting a robust email history and
> documents like BOVs, we should have a complete corpus to train a writing voice from — to help
> generate/improve automatic templates for business development and other response drafting."
> Open a fresh chat with: **"Pick up Wave 10 from docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md"**.
> Companions: garybuilt-local-model.md §7 (phase 3), the existing `my-writing-style` /
> `setup-writing-style` skills, `BRIGGS-WRITING-VOICE.md` (referenced), the offer-submission skill
> doctrine (strategy stays VERBAL), correspondence-ingestion-design.md, W7 (comms attribution).

## The asset (grounded — verify counts live at build time)

- **Scott's SENT email** — the voice signal (his authored prose, NOT inbound; NOT
  quoted/forwarded/signature/boilerplate). This is the training corpus's core.
- **BOV narratives / OM prose / BD outreach** he authored (deal dossiers, offer-submission emails).
- The LCC deal spine (`bd_opportunities`, deal facts, comps) — the FACT source drafts pull from.

## Design doctrine (non-negotiable — inherits the whole platform's discipline)

1. **Never auto-send. Ever.** Every output is a DRAFT for human edit (Cowork's writing-style
   pattern + the offer-submission "saved as a DRAFT" model). The consumer is Scott's edit, not the
   recipient.
2. **Never fabricate facts.** Voice shapes HOW; the LCC spine supplies WHAT (deal name, cap rate,
   party names, dates pulled from the record — "Not on file" when absent). A draft never invents a
   number or a name. This is the same fill-blanks/never-fabricate rule the data waves enforced,
   applied to prose.
3. **Strategy stays verbal** (offer-submission doctrine) — the voice engine drafts factual/
   relational correspondence, NOT negotiation strategy or recommendations in writing.
4. **Corpus hygiene = a data-quality problem first.** Separate Scott-authored text from
   quoted/reply-chain/forwarded/signature/disclaimer/template boilerplate BEFORE it trains
   anything (a bad corpus teaches boilerplate voice). Client-confidential content: the corpus is
   Scott's own outbound, but redact third-party PII/deal-confidential specifics from any
   persisted style artifact.
5. **Human-graded, self-measuring** — like every wave: track edit-distance between the draft and
   what Scott actually sent (the accept/edit signal), feed it into U4.

## Staged build (each its own prompt + gate — start light, earn the heavy step)

**Stage 1 — Voice PROFILE (no training, cheap, reversible):** a deterministic corpus pass extracts
Scott's authored sent-email bodies (strip quotes/sigs/boilerplate), then a bounded local-LLM pass
distills a structured `BRIGGS-WRITING-VOICE.md` — greeting/sign-off patterns, sentence length,
formality register, hedging vs. directness, characteristic phrases, paragraph shape, per-context
variants (cold BD vs. warm follow-up vs. broker-to-broker vs. client update). This is the
`setup-writing-style` skill's job, run over the REAL corpus instead of a Q&A. Output is a
prompt-injectable profile. **Ship this first** — it makes every drafting surface (Cowork, the
morning brief, offer-submission) sound like Scott with zero training risk.

**Stage 2 — Retrieval-grounded drafting (RAG over the sent corpus):** for a given draft request
(recipient, context, purpose), retrieve Scott's 3–5 nearest PAST examples of that draft type
(embedding-KNN over the cleaned sent corpus) + the deal facts from the spine, and generate a draft
grounded in both — real precedent, real facts, his voice. A new `/api/draft-assist` or a Cowork
skill; drafts land in Outlook Drafts (the offer-submission seam already does this) or the Cowork
outputs, never sent. This is where the corpus earns its keep — the model isn't inventing a BD
email, it's adapting Scott's own best past one to the new situation.

**Stage 3 — Template library (the "automatic templates" ask):** cluster the sent corpus by
draft-type; for each recurring type (new-listing announcement, LOI acknowledgment, follow-up
cadence, holiday/relationship touch, BOV cover note), synthesize a Scott-voiced parameterized
template + the trigger that offers it (a new listing → offer the announcement draft; an LOI lands
→ the offer-submission skill already fires). Templates are DRAFTS with the deal facts slotted,
Scott edits and sends.

**Stage 4 (optional, the playbook's phase 3) — LoRA fine-tune on GaryBuilt** ONLY if Stages 1–2's
few-shot voice isn't tight enough (the playbook's exact stance). Heaviest step, most infra, last
resort — the profile+RAG approach likely suffices and is fully reversible.

## Existing machinery to build ON (never around)

- `my-writing-style` / `setup-writing-style` skills (the profile IS this, corpus-fed).
- The offer-submission skill (draft-to-Outlook-Drafts seam, deal-facts pull, save-not-send).
- GaryBuilt ollama seam (`invokeExtractionAI`, surface-gated) for the distill + generate passes —
  keeps Scott's corpus ON-PREM (a real privacy win vs. sending 10 years of client mail to a cloud
  API; call it out as a design advantage).
- W7 correspondence store (the cleaned sent corpus lives here) + the deal spine (facts).
- U4 self-measurement (draft-vs-sent edit distance).

## Open design questions for Scott (Stage 1 prompt resolves)

- Corpus scope: all sent mail, or a curated "best of" Scott flags? (Recommend all, auto-cleaned,
  with a value-gate on length/deal-relevance.)
- Voice granularity: one profile, or per-context variants (BD cold vs. client warm)? (Recommend
  per-context — his voice genuinely differs.)
- Where drafts surface: Outlook Drafts (like offer-submission), Cowork, or an LCC lane?

## Status
- 2026-08-13: kickoff written.
- 2026-08-13: **Stage 1 (Prompt 100) SHIPPED.** Corpus located live (~926 distinct Scott-authored
  sent emails; honest ~255-char `bodyPreview` cap surfaced). Pure cleaning module
  `api/_shared/voice-corpus-clean.js` + 19 tests, on-prem `scripts/voice-distill.mjs` (ollama-only,
  no cloud egress), and `BRIGGS-WRITING-VOICE.md` (overall voice + per-context variants, evidenced,
  cold-BD bucket flagged THIN). No drafting surface changed. Scott read + approved the profile
  ("a good start, accurate representation", 2026-08-13). See ROLLOUT_STATUS Wave 10.
- 2026-08-14: **Stage 2 (Prompt 107) DRAFTED — Scott chose to proceed on the current capped corpus** (rather
  than gate on fuller-body ingestion first). Spec: `/api/draft-assist` — RAG retrieval over the cleaned sent
  corpus (embedding-KNN via on-prem Ollama embed if available, else deterministic bucket+recipient+recency) +
  deal-spine facts (never invented, "Not on file" for gaps) + the Stage-1 voice profile → on-prem Ollama
  generation → a DRAFT to Outlook Drafts / Cowork, NEVER sent. Structural never-send + fact-validator +
  fail-closed-if-no-Ollama guards; flag `DRAFT_ASSIST` OFF; `voice_confidence` note surfaces the opening-only
  cap honestly; U4 edit-distance hook left wired. Prompt `docs/claude-code/prompts/107-w10-2-rag-drafting.md`.
  ~~**Deferred to a future unit:** fuller email-body ingestion (past the ~255-char `bodyPreview` cap).~~
  **DONE (Prompt 110, 2026-08-14):** fuller email-body ingestion — the shared enabler for long-form drafting
  + the voice profile's sign-off fidelity + the harvest signature arm. The intake endpoint already accepted
  `body_text`/`body_html`; the consumers (draft-assist RAG, voice cleaner, harvest signature arm) now PREFER
  the full body via `pickBestBody` and fall back to the preview cleanly. The actual unlock is a forward-only
  Power-Automate "Get email (V3)" flow change (Scott's step) + a scoped historical backfill (future unit).
  See `docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md`.
- 2026-08-14: **Stage 2 (Prompt 107) SHIPPED.** `/api/draft-assist` built (core `api/_shared/draft-assist-core.js`,
  handler `api/draft-assist.js`, on-prem seam `invokeOnPremGeneration`/`invokeOnPremEmbeddings` in `api/_shared/ai.js`,
  mounted in `server.js`, flag migration `20260901120000_lcc_w10_2_draft_assist_flag.sql`, 21 tests). GET dry-run
  live; POST Outlook-draft save gated on `DRAFT_ASSIST` (OFF). Structural guards proven by test: never-send,
  fact-validator strips a planted fabricated figure, Ollama-unreachable fails closed (no cloud egress), retrieval =
  Scott-authored outbound only, flag-off ⇒ dry-run, voice-profile injection present. Sample sheet
  `docs/audits/W10_STAGE2_SAMPLE_DRAFTS.md`. Prompt → `done/`.
- 2026-08-14: **Full-body ingestion (Prompt 110) SHIPPED (consumer code + doc).** The intake endpoint was
  already ready (`api/intake.js` accepts/clamps/prefers `body_text`/`body_html`); the fields are empty only
  because the PA flows post `bodyPreview` only. Wired the consumers (draft-assist `loadCorpus`, harvest
  signature arm) to prefer the full body via the new `pickBestBody`/`htmlToText` in `voice-corpus-clean.js`,
  falling back to the preview cleanly. The actual unlock is a forward-only PA "Get email (V3)" flow change
  (Scott's step, documented) + a scoped historical backfill (future unit, recommended: PA loop keyed on
  `internet_message_id`). Doc: `docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md`. Prompt → `done/`.
- 2026-08-15: **⚠ Corpus-fill correction (Prompt 114) — how `email_bodies` ACTUALLY fills.** Grounded live:
  the voice corpus `email_bodies` is written by **exactly one path** — the bridge handler
  `handleOutlookMessageExtract`, reached via `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages`
  → worker drain (reads the full Graph `body`, merge-duplicates upsert). **`intake.js` does NOT write
  `email_bodies`** (it writes `staged_intake_items`/`activity_events`), so Prompt 110's Part-A flow change
  (posting `body_html` to `/api/intake?_route=outlook-message`/`outlook-sent`) fed the wrong table — the
  corpus never filled from it (all 23,169 rows still empty-body). Root blocker: the `outlook.messages`
  ingest **allowlist stripped `body`** before enqueue; fixed by
  `supabase/migrations/20260905120000_lcc_p114_outlook_body_allowlist.sql` (applied live). The correct
  fill path is documented in **`docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md`** (backward+forward Graph→bridge
  sweep). Corpus scope = tracked-contact mail (Option A, no writer change). Prompt → `done/`.
- 2026-08-18: **Stage-1 profile RE-DISTILLED on full bodies (Prompt 117) — `BRIGGS-WRITING-VOICE.md` v2.0.0.**
  The sign-off / paragraph-shape / long-form sections that Stage 1 honestly flagged LOW-confidence are now
  **counted off whole emails** instead of inferred. Corpus basis, verified live 2026-08-18: **609 distinct
  Scott-authored messages after guards — 399 with a FULL body (2026-05-04 → 2026-08-17) + 210 preview-only
  openings (2022-11-14 → 2026-08-18)**; 129 long-form (≥400 chars), 55 ≥900.
  **⚠ Three grounded corrections to the prompt's premise, all material:**
  1. **"7,851 Scott-authored sent" is not Scott's.** That number is `email_bodies` rows with `is_sent=true`
     carrying a body — but `is_sent` is unreliable here: the top senders on it are inbound newsletters
     (govtribe 1,346 · seekingalpha 1,105 · salesforce notifications 1,773), and only **1** of the 654
     Scott-from full bodies has `is_sent=true`. **Scott-from full bodies = 654**, of which **399** survive
     the authorship guards.
  2. **`from_email` is NOT proof of authorship on this store.** 118 of 654 are addressed only to Scott
     (74 are the app's **own LCC Morning Briefing / Weekly Deep Dive** output — training on them teaches the
     briefing template) and ~107 open by addressing Scott (inbound filed under his address). New
     `voiceCorpusExclusion()` gates both, in the distiller **and** in draft-assist retrieval (which could
     otherwise have quoted the app's own briefing back at him as an exemplar of his voice).
  3. **The upgrade would have silently cancelled itself.** All 654 full bodies ALSO exist in
     `activity_events` as ~255-char previews, and both corpus loaders deduped **preview-first** — so every
     full body would have been dropped as a duplicate. Fixed: `email_bodies` is drained first in both.
  **Cleaner (`voice-corpus-clean.js`) verified on real full-body shapes:** 24% of full bodies carried no
  TEXT reply marker because Outlook's quote boundary is a div (`id="appendonsend"`/`divRplyFwdMsg`) —
  `htmlToText` now emits a sentinel there (min-lead guarded so an empty div on a fresh compose can't empty
  the body: 52 emptied → 0). **Retention measured over the 654: raw body averages 7,537 chars → 1,303 kept
  (17.3%) — ~83% of a typical full body is quoted chain + signature + disclaimer.**
  **Headline voice findings (new, corpus-evidenced):** 86.7% of his emails have **no sign-off at all**;
  **"Best regards," is the only closer he uses** (13.3% overall) and it is an EXTERNAL marker (24.7% external
  follow-up / 31.3% LOI vs 2.3% internal); **"Thanks," never appears as a closing line** (v1 guessed it did).
  Buckets upgraded: LOI/offer **LOW → MEDIUM-HIGH** (83 full bodies), cold-BD still thin in count (18) but now
  full-length (median 2,640 chars). Listing-announcement (n=1) stays flagged LOW.
  **Distiller extended** (`scripts/voice-distill.mjs`): deterministic layer-1 shape stats (`--stats-only`,
  no model, no egress), stratified length+recency sampling, a separate long-form pass, and **mechanical
  verbatim enforcement** (a cited excerpt that is not a literal substring of the sample is dropped) +
  redaction of anything written to disk. Still ollama-only, still refuses without `OLLAMA_URL`.
  **draft-assist `voice_confidence`** now reports FULL-BODY coverage per draft from the retrieved exemplars'
  real lengths (full / mixed / preview-only), instead of asserting the retired corpus-wide 255-char cap.
  **Scott's step:** run the on-prem distill on GaryBuilt, then read v2 — "does this sound like me now,
  sign-offs and all?" — before it becomes the default voice source. Prompt → `done/`.
