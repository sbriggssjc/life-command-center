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
  cold-BD bucket flagged THIN). No drafting surface changed. **Awaiting Scott's read** of the profile
  before Stage 2 (RAG drafting). See ROLLOUT_STATUS Wave 10.
