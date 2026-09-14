# Prompt 100 — W10 Stage 1: Voice Profile from Scott's authored sent corpus (no training)

**Grounding (read first):** `docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md` (the full wave design),
the existing `setup-writing-style` / `my-writing-style` skills (this IS that skill, corpus-fed
instead of Q&A-fed), `garybuilt-local-model.md` §7 phase 3, the offer-submission skill (never-send
+ deal-facts-pull doctrine), W7 correspondence store (where sent mail lives). **This is Stage 1
ONLY — the cheap, no-training, reversible profile. RAG drafting (Stage 2) + templates (Stage 3) +
optional LoRA (Stage 4) are separate later prompts.**

## Doctrine (non-negotiable)

Never auto-send anything. Never fabricate facts (this stage produces a STYLE profile, no
recipient-facing prose). Corpus-cleaning is a data-quality step FIRST — a profile trained on
boilerplate teaches boilerplate. Run the distill pass ON-PREM via the ollama seam
(`invokeExtractionAI`, surface `clean_assist` or a new `voice` surface) — Scott's decade of client
mail never leaves the box. Reversible: the profile is a doc, versioned, regenerable.

## Do

1. **Locate + scope the corpus (ground live first):** find where Scott's SENT email bodies live
   (W7 `activity_events` source_type `outlook_sent` / the correspondence store — verify the exact
   table/column). Filter to **Scott-authored outbound only**: sent by Scott, and the ORIGINAL
   body — NOT the quoted reply chain, forwarded content, signature block, or legal disclaimer.
   Report the corpus size (rows, date range, post-cleaning word count).
2. **Deterministic body-cleaning (no LLM):** strip reply chains (`On <date>, X wrote:` and `>`
   quote markers), signatures (delimiter `-- ` / the known Briggs sig block), disclaimers,
   forwarded headers. Keep only Scott's freshly-typed prose. A `voice-corpus-clean.js` pure module
   + tests on fixture emails (reply-chain stripped, sig stripped, real body kept).
3. **Stratify by context** (the kickoff's per-context recommendation): bucket cleaned emails by
   draft-type using deterministic signals + a light LLM classify — cold BD outreach, warm
   follow-up, broker-to-broker, client/seller update, LOI/offer correspondence, relationship
   touch. Report counts per bucket (some may be thin — honest).
4. **Distill the profile (bounded ollama pass over a stratified SAMPLE, not the whole corpus):**
   per context bucket, the model extracts STRUCTURED style attributes — greeting + sign-off
   patterns, sentence length distribution, formality register, directness vs. hedging,
   characteristic phrases/transitions, paragraph shape, em-dash/list habits, what he NEVER does.
   Grounded: every attribute cites example excerpts from the corpus (the verbatim discipline —
   a claimed pattern must be evidenced, not invented). Redact third-party PII / deal-confidential
   specifics from the persisted excerpts.
5. **Write `BRIGGS-WRITING-VOICE.md`** (or update if it exists) — a prompt-injectable profile:
   an overall voice section + per-context variant sections, each with rules + 2-3 anonymized
   example snippets. Also save it as the `my-writing-style` skill profile so every Cowork drafting
   surface (offer-submission, morning brief, ad-hoc drafts) picks it up automatically.
6. **Self-measurement seam (Stage-2 ready):** note in the doc how draft-vs-sent edit-distance will
   feed U4 once Stage 2 drafting exists — don't build the drafting, just leave the hook.

## Acceptance

- Corpus located + cleaned; honest size/bucket counts reported (thin buckets flagged, not faked).
- `BRIGGS-WRITING-VOICE.md` written with evidenced per-context rules + anonymized examples;
  installed as the `my-writing-style` profile.
- Cleaning module + classify tests green; the distill pass ran ON-PREM (no cloud egress of corpus).
- Scott reviews the profile — does it sound like him? — before any Stage 2 build. NO drafting
  surface changes in this prompt.
- ROLLOUT_STATUS Wave 10 row (Stage 1); kickoff status; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
