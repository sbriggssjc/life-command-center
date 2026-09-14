# Prompt 67 — W8 U1 final polish: recalibrate distribution guard + surname guard

**Grounding:** Scott's fourth live `?score=1` run (2026-08-07, post-66). Bounded scoring works
(6 scored / 241 remaining / budget honest), and the 64 rubric is proven live on ollama —
`CCMCRHS 850 CANAL LLC` → keep with correct SPE reasoning; `CO` orphans → dismiss citing "no
relationships or identities". Two residuals:

1. **Distribution guard blocks the now-correct outcome.** 5/6 dismiss (83%) > 0.5 threshold →
   `suspect_distribution`, POST apply would be REFUSED. The 0.5 threshold was calibrated for the
   pre-65 broad pool; post-65 the pool is PRE-FILTERED true junk, so a high dismiss share is the
   expected result. As-is the nightly cron would refuse every batch — flag flip is pointless.
2. **Surname false positive:** `CLOVER/WALDSCHMITT, L.L.C.` → dismiss 1.0. WALDSCHMITT is a German
   surname; consonant_run fired inside it. Surnames (Germanic/Slavic: -schmitt, -schmidt, Krzyz-,
   etc.) are a predictable false-positive class for consonant-run.

## Do (small)

1. **Make the dismiss-share threshold configurable + recalibrate:** `JUNK_DISMISS_GUARD_THRESHOLD`
   env (default **0.9** for the tightened pool). Keep the guard — it still catches a runaway model
   (100%-dismiss pathology stays refusable at ≥ the ceiling... use: refuse only when dismiss_share
   > threshold; 0.9 default). Surface the active threshold in the response (already shown).
2. **Surname guard (deterministic, cheap):** consonant_run candidates whose run occurs inside a
   token that looks like a personal/firm surname — token is title-case or the name contains a
   personal-name shape (`First Last`, `X/Y, LLC` partnership pattern, `&`-joined names) — require a
   second junk signal (zero connections already guaranteed post-65 + e.g. non-ASCII garbage or
   digit-in-word) or downgrade to the LLM with an explicit rubric line: "consonant runs inside
   capitalized surname-like tokens (WALDSCHMITT, SCHMIDT) are usually REAL family/partnership
   names — keep unless other junk signals exist." Add `CLOVER/WALDSCHMITT, L.L.C.` as a regression
   fixture (expected: keep or absent).
3. **Tests:** threshold-env test, surname-guard fixtures, existing 76+ stay green.

## Acceptance

- Re-run `?score=1&n=6`: no `suspect_distribution` on a true-junk-dominated batch;
  WALDSCHMITT-class names keep-or-absent; OCR-garbage/CO-class still dismiss.
- After merge+redeploy, Scott flips `W8_U1_JUNK_PRESCREEN` and the nightly cron drains ~25/night
  into the Decision Center lane.

Commit with the repo Co-Authored-By + Claude-Session trailer.
