# Prompt 117 — Re-distill the voice profile on the now-full-body corpus (Stage-1 upgrade)

**Status:** DONE 2026-08-18 · branch `claude/voice-profile-full-body-pk0j72`

Grounding: `BRIGGS-WRITING-VOICE.md` (Stage-1 profile — opening-only, LOW-confidence on sign-offs/
long-form), `scripts/voice-distill.mjs` (on-prem ollama-only distiller, Prompt 100),
`api/_shared/voice-corpus-clean.js` (`pickBestBody` + reply-chain/sig/disclaimer stripper),
`api/draft-assist.js` (`loadCorpus` → `voice_confidence`), the W10 kickoff.

## The ask

1. Confirm the cleaner handles full bodies; add fixtures on real full-body shapes; report how much of a
   typical full body is Scott's own prose vs stripped.
2. Extend the distiller for the newly-available signal: sign-offs, paragraph shape, long-form structure,
   transitions, what he never does at length. Keep the Prompt-100 discipline (verbatim citation, redaction,
   bounded stratified sample, ollama-only, refuse without `OLLAMA_URL`).
3. Regenerate `BRIGGS-WRITING-VOICE.md` with corpus-evidenced sign-off/long-form sections, an honest
   provenance header, thin buckets still flagged, versioned.
4. Update draft-assist `voice_confidence` to reflect full-body coverage per bucket.
5. Land the mechanism + a verification; the heavy distill run is Scott's on-prem step.

## What shipped

See `docs/audits/W10_VOICE_AND_DRAFTING_KICKOFF.md` (2026-08-18 entry) and
`docs/claude-code/STATUS.md` (Milestone 2026-08-18) for the full write-up. Headlines:

- **`BRIGGS-WRITING-VOICE.md` v2.0.0** — sign-off, paragraph-shape and long-form sections are now COUNTED
  off whole emails. Corpus basis: **609 distinct Scott-authored messages after guards — 399 full bodies
  (2026-05-04 → 2026-08-17) + 210 preview-only openings (2022-11-14 → now)**; 129 long-form, 55 ≥900 chars.
- **Three premise corrections** (all live-verified, all material): the prompt's "7,851 Scott-authored sent"
  counts `is_sent=true` rows that are overwhelmingly inbound newsletters (Scott-from full bodies = 654);
  `from_email` is not authorship (118 self-addressed, 74 of them the app's OWN briefings; ~107 inbound filed
  under his address); and every full body ALSO exists as a 255-char preview in `activity_events` while both
  loaders deduped preview-first — which would have silently cancelled the entire upgrade.
- **Cleaner**: structural quote-boundary sentinel (`appendonsend`/`divRplyFwdMsg`/`gmail_quote`/
  `blockquote[type=cite]`) with a min-lead guard, `<head>` drop, numeric-entity decode, extra sig anchors,
  `cleanEmailBodyDetailed` (keeps the sign-off measurable), `voiceCorpusExclusion`, `bodyShape`,
  `redactExcerpt`. **Retention measured: 7,537-char raw body → 1,303 kept (17.3%).**
- **Distiller**: deterministic no-model layer (`--stats-only`), `--dry-run`, stratified length+recency
  sampling, separate long-form pass, mechanical verbatim enforcement + redaction, helpers made importable.
- **draft-assist**: `voice_confidence` derived from the retrieved exemplars' real body lengths
  (full / mixed / preview-only); corpus guard added to retrieval.

## Verification run here

- `node --test test/voice-corpus-clean.test.mjs test/voice-distill.test.mjs test/draft-assist.test.mjs`
  → **93 pass, 0 fail** (45 + 15 + 33).
- Corpus forensics run live against LCC Opps (`xengecqvemvfknjvbvrq`); every number in the profile and the
  status entries is a measured count, not an estimate.
- The ollama distill itself was NOT run (no `OLLAMA_URL` here, by design — the script refuses).

## Scott's step (on-prem)

```bash
node scripts/voice-distill.mjs --stats-only     # deterministic evidence, no model, safe anywhere
node scripts/voice-distill.mjs --dry-run        # see the prompts that would be sent
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:14b node scripts/voice-distill.mjs
```

Then read v2 and answer: **does this sound like me now, sign-offs and all?** It should not become the
default voice source until you have.
