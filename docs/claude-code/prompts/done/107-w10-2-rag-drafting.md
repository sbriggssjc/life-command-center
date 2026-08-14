# Prompt 107 — W10 Stage 2: retrieval-grounded drafting (`/api/draft-assist`)

Grounding (read first): `docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md` (Stage 2 design), `BRIGGS-WRITING-VOICE.md`
(the Stage-1 profile — the voice), `api/_shared/voice-corpus-clean.js` (the cleaner + `classifyDraftType`), the
**offer-submission skill** (the proven draft-to-**Outlook Drafts** seam — save-not-send; grep how it writes a
Draft), the deal spine (`entities-handler.js::buildDealPacket` / `lcc_deal_spine` / the `get_deal_dossier` MCP
tool — the FACT source), the Ollama seam `invokeExtractionAI` (on-prem generation), W7 correspondence store (the
sent corpus), U4 self-measurement. **Doctrine is non-negotiable and inherits the whole platform's discipline.**

## Doctrine (the guardrails — enforce structurally, not just by prompt)
1. **Never auto-send. Ever.** Every output is a DRAFT for Scott's edit — saved to Outlook Drafts (like
   offer-submission) or returned to Cowork. The consumer is Scott's edit, never the recipient. Assert this with a
   structural test (the path has no send call).
2. **Never fabricate facts.** Voice shapes HOW; the **deal spine supplies WHAT** (party names, cap rate, dates,
   deal name — pulled from the record). A field the spine doesn't have renders **"Not on file"** — a draft NEVER
   invents a number, name, or date. Same never-fabricate rule the data waves enforced, applied to prose.
3. **Strategy stays verbal** (offer-submission doctrine) — draft_assist writes factual/relational correspondence
   (follow-ups, intros, updates, acknowledgments), NOT negotiation strategy or recommendations in writing.
4. **On-prem generation.** The distill/generate pass runs through the Ollama seam (`invokeExtractionAI`) — Scott's
   corpus + deal facts never egress to a cloud model. If Ollama is unreachable, FAIL CLOSED (no cloud fallback for
   this surface), honest error.
5. **Honest about the corpus cap.** The sent corpus is opening-only (~255-char `bodyPreview`; `body_text` empty —
   the Stage-1 finding). So retrieval returns openings and the voice is strongest on greeting/opening/tone; the
   profile carries structure. Surface this honestly in the output (a `voice_confidence` note), don't pretend to
   full-body fidelity. (Fuller-body ingestion is a separate future unit; Scott chose to proceed capped.)

## Build — `/api/draft-assist`, house pattern

**Input** (a draft request): `{ recipient (entity/contact id or email), purpose (draft-type: cold_bd |
follow_up | broker_to_broker | client_update | loi_ack | listing_announcement | relationship_touch),
deal/property/entity id (optional, for facts), a one-line intent }`.

**1. Retrieve (RAG over the cleaned sent corpus).**
- Bucket by draft-type via `classifyDraftType`, then rank the nearest 3–5 PAST sent emails. **Ground the retrieval
  mechanism live first:** if an on-prem embedding model is available via Ollama (e.g. `nomic-embed-text`) use
  embedding-KNN over the cleaned openings; **else** fall back to a deterministic ranker (same draft-type bucket +
  same/similar recipient or recipient-domain + recency), which is perfectly serviceable on opening-length text.
  Return the retrieved examples (cleaned, anonymized of third-party PII) as few-shot exemplars + cite their ids.
- Value/relevance-gate: only retrieve Scott-authored outbound (the Stage-1 corpus definition); never quote inbound.

**2. Assemble facts (from the spine, never invented).**
- If a deal/property/entity id is supplied, pull the relevant facts via `buildDealPacket` / the deal-spine
  functions (parties, role, cap rate, key dates, property label). Every fact carries its source; absent → literal
  **"Not on file"**. Do NOT let the model fill a fact gap.

**3. Generate (on-prem, voiced).**
- `invokeExtractionAI` (Ollama, a new surface `draft_assist` or reuse `clean_assist`) with a prompt that injects:
  the `BRIGGS-WRITING-VOICE.md` profile (voice = HOW), the 3–5 retrieved exemplars (precedent), the spine facts
  (WHAT, with "Not on file" for gaps), and the intent. Output a DRAFT (subject + body) that adapts Scott's own
  past best email to the new situation — it is NOT inventing a BD email from scratch.
- Post-generate **fact validator** (mirror the U3/W7.4 verbatim discipline): any number/date/proper-name in the
  draft that is NOT in the supplied facts or the retrieved exemplars is flagged/stripped (a fabricated figure is
  the cardinal sin). Report what was flagged.

**4. Output — DRAFT only.**
- Reuse the offer-submission **Outlook Drafts** seam (save as a Draft in Scott's mailbox) AND/OR return the draft
  to Cowork. NEVER send. Include the retrieved-example ids, the facts used (+ "Not on file" gaps), and the
  `voice_confidence` note.

**5. Self-measure (U4 hook).**
- Leave the Stage-1 edit-distance hook wired: when Scott later sends an edited version, record draft-vs-sent
  edit-distance → U4 (the accept/edit signal). Don't build the send-side capture if it's heavy; leave the seam +
  a TODO.

**Mechanics:** flag `DRAFT_ASSIST` OFF in-migration (register in `feature_flags_registry`); `GET /api/draft-assist`
= dry-run (returns the assembled draft + retrieval + facts, writes nothing) / `POST` = save the Outlook Draft
(flag-gated). Mount in `server.js`. No fsp rows (no curated-field write). Honest counts + loud errors.

## Acceptance
- `GET /api/draft-assist?...` for a sample request (e.g. a `follow_up` to a known contact on a known deal) returns
  a Scott-voiced draft grounded in 3–5 real retrieved exemplars (ids shown) + real spine facts, with "Not on file"
  for any absent fact and a `voice_confidence` note reflecting the opening-only corpus. A request with NO deal id
  still drafts (relational voice) but asserts zero invented facts.
- Structural tests: never-send guard (no send call on the path), fact-validator drops a planted fabricated figure,
  Ollama-unreachable fails closed (no cloud egress), retrieval returns only Scott-authored outbound, flag-off ⇒
  dry-run only. Voice-profile injection present.
- A short sample sheet (2–3 generated drafts across draft-types) for Scott to judge "does this sound like me?"
- Docs: ROLLOUT_STATUS Wave 10 Stage 2 row + a STATUS entry + kickoff status; prompt → `done/`.

Operator flow: redeploy → `GET /api/draft-assist?...` review the sample drafts → Cowork flips `DRAFT_ASSIST` →
the offer-submission / morning-brief / ad-hoc surfaces can request a voiced draft. Commit with the repo
Co-Authored-By + Claude-Session trailer. One PR.
