# OCR1c — the harness now has a floor to read its rates against (2026-09-02)

**Harness-only. Nothing wired. No real document run.** ⚠️ **NO REAL-DOCUMENT VERDICT CHANGES IN
THIS PROMPT.** The sample on file is still **10 real arm-A documents, tesseract only**, and no row
of OCR1 §5 is selected. What changed is that the *next* run's number will be readable.

Full writeup: `docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md` **§8**.
Files: `scripts/ocr-bakeoff.mjs`, `test/ocr-bakeoff.test.mjs`.

## What shipped

| # | change | why the first run needed it |
|---|---|---|
| 1a | quotes/apostrophes/dashes/NBSP/whitespace normalized; `""` / `null` / `N/A` / `—` → null before the both-null decision; numbers strip a trailing `sf` and round | **4 of the 11 non-agreements were the comparator** (`Kohl's` vs `Kohl’s` ×2, `""` vs `null` ×2) |
| 1b | **`--control self`** — the model run TWICE on the same DocAI text, scored with the same `scoreDocument`; per-field self-rate printed ABOVE the engine tables; `rate − self` column added | 2 non-agreements were model arithmetic on identical text and 4 dates had **no attributable cause**; the 77% had no floor to be read against |
| 1c | `stderrTail` shows the LAST 300 chars; probe distinguishes *wrapper only* / *cannot check* / *needs a Docker VLM server*; `--self-test` names `pip install pillow` | all 36 failures printed the same `RequestsDependencyWarning` and hid BOTH real causes |
| 1d | arm B carries `graded_values` + `fields_found` into `agreement.json` and a *"Field values as read"* table | `5/6 found` at confidence 68 on doc 407 is unreadable as a count |

**Not done, per the brief:** both-null rule unchanged · no ranking on `char_len` · no "winner" line ·
torch/surya/paddle not installed in the sandbox (probed, not run) · `deps.freeOcr`, the drain and
every live path untouched.

## The three guards, mutation-verified

`test/ocr-bakeoff.test.mjs` — **30 tests, 0 fail; 25/25 new mutations RED, 0 survived.** Comments
stripped before every source assertion (the fix's own prose names `.slice(0, 160)` and every
sentinel spelling while explaining them).

Representative RED mutations: drop quote normalization · drop dash normalization ·
**widen `isNullSentinel` into a general "looks empty" test** (it must never null a real value; `0`
is a value) · **turn the round into a 1,000-unit bucket** (`412500` vs `412600` must stay a
disagreement) · count only `disagree` as `self_disagree` · put `both_null` back in the floor's
denominator · make an unrun control report a 100% floor · `deltaVsSelf` returns `0` instead of
`null` · stub the control's consumer call · delete the report's *NOT RUN* banner · `stderrTail`
shows the head · re-introduce `stderr.slice(0, 160)` · paddle wrapper-only reads available ·
UNVERIFIED collapses to unavailable · surya skipped even when Docker is up · Pillow fix unnamed ·
arm B stops carrying values · `fields_found` counts an `N/A`.

⚠️ **Two guard defects the mutation pass found, both worth carrying:**

1. **A CODE-shape detector must blank string literals, not only comments.** The rendered report
   says *"deliberately NOT `temperature=0`"* in a pushed string, so the anti-seed-pinning grep
   matched the sentence explaining the rule and went RED over correct code.
2. **Comments FIRST, then literals.** A bare apostrophe in prose (*"the engine's output"*) opens a
   string the blanker never closes and swallows real code behind it — which is how that
   assertion's own positive-control mutation **survived its first run**.

Full suite: **5,038 pass / 0 fail / 6 skipped** (5,044 tests, 908 suites).

## Self-test on the synthetic fixture — ⚠️ STUB MODEL, plumbing only

`tesseract 5.3.4 + poppler-utils` and Pillow were installed in the sandbox so this exercises a real
engine. **The extractor is the offline stub, which is deterministic — so the control reads 100% BY
CONSTRUCTION and is not a measurement of any model.** The self-test asserts that and says so.

```
=== ENGINES ===
  ✗ surya        — not installed
  ✗ paddleocr  paddleocr 3.7.0 (wrapper)  — wrapper only — `paddleocr` is on PATH but the
                                             `paddle` runtime is not: pip install paddlepaddle
  ✗ ocrmypdf     — not installed
  ✔ tesseract  tesseract 5.3.4

--- doc FIXTURE-clean (arm A, 1pp) ---
    baseline google_docai   512 chars  extract=ok
    self-control  run2 of the same model on the same text  agree=6/6 (both_null 0)
    tesseract    518 chars  1pp  2.5s  conf=96  wordlike=0.738  agree=6/6 (both_null 0)
```

The ENGINES line for paddleocr was produced with a **fake `paddleocr` on PATH that answers
`--version` and has no runtime** — i.e. the workstation's exact state, reproduced and now reported
instead of failing 18 times. That is a positive control of the probe WIRING, not just of the pure
classifier.

Report section (stub run, `--control self`):

```
## Model self-agreement control — the floor

The SAME model, the SAME prompt, the SAME DocAI text, run TWICE and scored with the
SAME comparator. **An engine's rate is only meaningful relative to this row.**

> 🔴 The stub extractor is DETERMINISTIC, so this control is 100% by construction.

| field | self-agree | self-disagree | both_null | **self-rate** |
|---|---:|---:|---:|---:|
| `tenant_name`        | 2 | 0 | 0 | **100%** |
| … (all six) …
| **all fields**       | 12 | 0 | 0 | **100%** |
```

and the engine table gained the column the whole prompt is about:

```
| field                | agree | disagree | … | rate | **rate − self** |
| `tenant_name`        | 1 | 1 | … |  50% | **-50.0 pp** |
| `lease_commencement` | 2 | 0 | … | 100% | **0.0 pp**   |
```

A run WITHOUT `--control self` now prints, in place of that table:

> 🔴 **NOT RUN** … There is no floor, so every engine rate below is UNINTERPRETABLE …

## 👤 Scott — the re-run

```
pip install paddlepaddle
node scripts/ocr-bakeoff.mjs --run --engines tesseract,paddleocr --control self
```

on the same staged 15. Read in this order: **the floor table** → each engine's `rate − self` →
the named disagreements → arm B's *"Field values as read"* (doc 407 is the one to eyeball).
Surya still belongs on GaryBuilt; the probe will now say so rather than failing per document.
