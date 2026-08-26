# Prompt 80 — Match-disambiguation pre-rank assist (unblock the 1,120-card dead lane)

**Grounding:** `docs/setup/garybuilt-local-model.md` §7 mid-term item: `match_disambiguation` has
**1,120 open cards and ZERO ever decided** — the lane is unworkable as-is (each card demands
un-aided judgment across candidates). An Ollama first-pass ranking might finally make it workable.
This is an ASSIST (annotations), not a new producer: the cards already exist; we're adding a
consumption aid. W8 doctrine: LLM annotates, human decides, nothing auto-applies.

## Do

1. **Nightly annotation pass (flag `MATCH_DISAMBIG_ASSIST` OFF, bounded ~20/night, resumable):**
   for each open match_disambiguation card, Ollama ranks the candidates (best-match first) with a
   one-line reason + confidence per candidate, grounded on the same fields the card shows (names,
   addresses, identifiers) + relationship counts. Store as an annotation on the decision row
   (`metadata.assist = {ranking, model, at}`) — NEVER a verdict.
2. **Lane ordering + display:** the lane sorts by the assist's top-confidence (high-confidence
   easy calls first — momentum), each candidate shows its assist rank/reason inline, and an
   "assist agrees" one-click confirm applies the SAME human verdict path that exists today.
3. **Self-measuring:** every human verdict records agree/disagree vs the assist's top pick
   (`metadata.assist_agreed`) — the U4 report gains an assist-accuracy metric per month; if
   accuracy is high after a real sample, a future prompt MAY propose auto-resolving the
   top-confidence band (NOT this one — no LLM in auditable gates until measured).
4. **Tests:** annotation-never-verdict structural guard, ordering, agree/disagree recording.

Acceptance: dry-run shows 20 annotated cards with sane rankings; Scott works a few and the lane
finally moves; agreement metric visible. Commit with the repo trailer.
