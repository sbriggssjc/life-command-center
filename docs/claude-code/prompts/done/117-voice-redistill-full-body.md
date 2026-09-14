# Prompt 117 — Re-distill the voice profile on the now-full-body corpus (Stage-1 upgrade)

Grounding (read first): `BRIGGS-WRITING-VOICE.md` (the Stage-1 profile — currently opening-only, LOW-confidence on
sign-offs/long-form), `scripts/voice-distill.mjs` (the on-prem distiller, ollama-only, built in Prompt 100),
`api/_shared/voice-corpus-clean.js` (`pickBestBody` + the reply-chain/sig/disclaimer stripper), `api/draft-assist.js`
(`loadCorpus` → `voice_confidence`), the W10 kickoff. This is the payoff of the body-capture work: the corpus went
from ~255-char openings to **8,631 full bodies / 7,851 Scott-authored sent (Nov 2022 → present)** — the profile can
now learn what the openings never showed.

## Why now

Stage-1 (Prompt 100) honestly flagged its ceiling: the corpus was Graph `bodyPreview` (~255 chars), so the profile
was strong on greeting/opening/tone but **LOW-confidence on sign-offs, paragraph shape, and long-form cadence** —
they simply weren't in the data. As of 2026-08-18 the Sent-Items + Archive sweep landed **full HTML bodies** for
7,851 of Scott's sent emails. Re-distilling now upgrades those buckets from "profile-inferred" to "corpus-evidenced."

## Do

1. **Confirm the cleaner handles full bodies (critical).** `voice-corpus-clean.js` strips reply chains
   (`On <date>, X wrote:` / `>` quotes), the inline Briggs signature block, disclaimers, forwarded headers — this
   matters FAR more on a full body than a 255-char preview (a full reply carries the whole quoted thread + sig).
   Add/confirm fixtures on real full-body shapes (a long reply with a quoted chain → only Scott's fresh prose
   survives; the HTML→text path via `pickBestBody` feeds clean text to the distiller). Report how much of a typical
   full body is Scott's own vs stripped.
2. **Extend the distiller for the newly-available signal.** `voice-distill.mjs` — per context bucket, now distill
   the attributes the openings couldn't show: **sign-off / closing patterns**, **paragraph shape & length**,
   **long-form structure** (how he builds a multi-paragraph update / BOV cover note / negotiation-adjacent note),
   **transitions**, and **what he never does** at length. Keep the Prompt-100 discipline: every claimed attribute
   cites verbatim (anonymized) excerpts from the corpus; redact third-party PII / deal-confidential specifics;
   bounded stratified SAMPLE per bucket (don't feed 7,851 bodies wholesale); **on-prem only** (ollama; refuse if
   `OLLAMA_URL` unset — the decade of client mail never egresses).
3. **Regenerate `BRIGGS-WRITING-VOICE.md`** — same overall + per-context structure, but the sign-off/long-form
   sections are now corpus-evidenced (retire the "LOW-confidence / opening-only" caveats where full bodies now
   cover them; keep any bucket still genuinely thin flagged honestly — e.g. cold-BD was only 14 at Stage 1, check
   the full-body count). Note the corpus basis (full-body count + date range) at the top so the profile's
   provenance is legible. Version it (the profile is a regenerable doc).
4. **Update draft-assist's `voice_confidence`.** The note currently says the corpus is opening-only (~255 cap) —
   update it to reflect **full-body coverage where present** (per-bucket, based on the retrieved exemplars' actual
   body lengths), so a drafted email honestly reports "grounded in full-body precedent" when it is.
5. **Note the mechanism, run is Scott's.** The heavy distill pass runs on GaryBuilt (ollama). Claude Code lands
   the script/cleaner/profile-structure changes + a dry-run/verification; the actual re-distill over the live
   corpus is Scott's on-prem operator step (same pattern as Prompt 100).

## Acceptance
- `voice-corpus-clean` verified on full-body fixtures (reply chains + sigs stripped, Scott's prose kept); tests green.
- `voice-distill.mjs` extended for sign-off/long-form/paragraph-shape extraction, on-prem-only, bounded sample.
- `BRIGGS-WRITING-VOICE.md` regenerated with corpus-evidenced sign-off/long-form sections + honest provenance
  header (full-body count, date range); thin buckets still flagged.
- draft-assist `voice_confidence` reflects full-body coverage.
- Docs: W10 kickoff status (Stage-1 upgraded to full-body), STATUS entry; prompt → `done/`.
- Scott reads the regenerated profile — "does this sound like me now, sign-offs and all?" — before it's the
  default voice source.

Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. The on-prem distill run is Scott's step;
report what the script + dry-run produced.
