# Prompt 85 — W8 U1: deterministic-certainty junk bypasses the LLM + the guard

**Grounding (live manual POST, 2026-08-08 post-84):** the 84 mechanics all work (windowed scan,
scoring budget honored, 20 scored, cursors advanced) but the batch was REFUSED
`suspect_distribution` — 20/20 dismiss, share 1.0 > 0.9. The 20 were the **blank-name dia
contacts** (the pool is 199 of them): 100% dismiss on literally-blank names is CORRECT, not model
runaway. And since refused batches aren't marked scored (by design), the nightly will re-score the
same 20 blanks and refuse forever — a livelock costing ~5 GaryBuilt min/night for zero output.

## Do (small)

1. **Deterministic-certainty classes skip the LLM entirely:** `blank_name` and `all_non_alpha`
   (and `token_junk` exact placeholders like "Test Test"/"Tbd"/"Unknown" if the class is
   exact-match, not fuzzy) become DETERMINISTIC dismiss proposals — no model call, evidence = the
   verbatim (empty/non-alpha) value, `model_provider:'none'`, confidence 1.0, reason
   "deterministic: <class>". Mirrors U5's deterministic-rename arm. They persist as normal
   proposals to the human lane (verdicts stay human) and mark scored.
2. **The dismiss-share guard measures ONLY LLM-judged verdicts** (consonant_run/no_vowel/
   too_short and other judgment classes). Deterministic dismissals are excluded from the
   denominator — the guard's purpose is catching a runaway MODEL; it has no business vetoing
   arithmetic. Surface both counts (`deterministic_dismissed`, `llm_scored`, `llm_dismiss_share`).
3. **Batch composition:** fill the per-invocation batch with deterministic candidates first
   (cheap, drains the 199 fast — allow a higher deterministic cap ~100/night), then spend the LLM
   budget on judgment classes only.
4. **Tests:** class-routing (blank → deterministic, consonant_run → LLM), guard-denominator,
   livelock regression (a 100%-deterministic batch persists and marks scored).

Acceptance: a manual POST drains ~100+ blank-name proposals into the junk lane with zero LLM
calls spent on them, no suspect_distribution, cursors + scored-markers advance; a judgment-class
batch still gets LLM scoring under the guard. Commit with the repo trailer.
