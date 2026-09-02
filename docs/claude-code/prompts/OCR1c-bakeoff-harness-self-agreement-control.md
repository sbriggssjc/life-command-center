# OCR1c — the bake-off harness needs a model self-agreement control before any rate means anything

> **Harness-only. Wires nothing. Runs no real documents (the sandbox cannot).** The first real run
> (`responses/done/OCR1-run.response.md`) produced a 77% tesseract-vs-DocAI field-agreement rate on
> 10 documents — and reading the 11 non-agreements showed **at least 6 are harness or model
> artifacts, not OCR.** The rate has no interpretation until the harness can say how much
> disagreement the MODEL alone produces on identical text.

**Read first:** `responses/done/OCR1-run.response.md` (the run, §2 especially) ·
`scripts/ocr-bakeoff.mjs` (`scoreDocument`, the field normalizer, the engine adapters) ·
`test/ocr-bakeoff.test.mjs` · `docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md`.

## 1. Build — four changes, each with a guard

### 1a. Normalize before comparing (the two artifact classes that were measured)

- **Quotes/apostrophes/dashes/whitespace**: `’ ‘ ´` → `'`, `“ ”` → `"`, `– —` → `-`, collapse
  whitespace, trim, case-fold for `tenant_name`/`lease_type`. Two real "disagreements" were
  `Kohl's` vs `Kohl’s`.
- **`""`, `"null"`, `"N/A"`, `"—"` → null** before the both-null / candidate-only decision. Two
  real `candidate_only` rows were `""` vs `null`.
- Numbers: compare `year1_rent` and `leased_sf` after stripping `$ , sf` and rounding; keep the
  existing tolerance but **report the raw pair on every disagreement** (already done — keep).
- Guard: a test that feeds the exact pairs above and asserts `agree`; mutation-verify by removing
  each normalization.

### 1b. `--control self` — the floor every engine rate is read against

For each arm-A document, run `extractTenantFromLease` on **the DocAI text twice** (two independent
model calls, same prompt, same model) and score run-2 against run-1 with the SAME `scoreDocument`.
Report per field `self_agree / self_disagree / self_both_null` and a per-field **self-rate**, and
print it as its own table ABOVE the engine tables with the sentence: *"an engine's rate is only
meaningful relative to this row."* Then add a column to the engine table: `rate − self_rate`.
⚠️ Two calls, not `temperature=0` — the point is to measure the model AS THE HARNESS USES IT.
Cost: 10 extra model calls per run, on the box.

### 1c. Failure reporting

- On an engine failure show the **last 300 chars** of stderr, not the first 160 — the first 160 was
  a `RequestsDependencyWarning` on all 36 failures and hid both real causes (surya: Docker daemon
  not running; paddle: `paddlepaddle` not installed).
- `--self-test` on a machine without Pillow must print the fix (`pip install pillow`) with the
  honest skip.
- Engine availability probe: `paddleocr --version` succeeding does NOT mean the engine works —
  also `python -c "import paddle"`; report `wrapper only` when it fails. For surya, detect the
  Docker requirement (`surya_ocr --help` mentions vllm/llama.cpp server) and say **"runs a VLM
  server via Docker — intended for the GPU box"** in the ENGINES header rather than failing 18
  times.

### 1d. Read the arm-B model outputs, don't only count them

Arm B reports `fields found /6` and clause positions. Add the found VALUES to `agreement.json`
(they already exist in memory) so a human can read whether doc 407's `5/6 found` at confidence 68
is real or garbage. `agreement.md` stays values-free is NOT required — `bakeoff/` is git-ignored —
but keep `responses/` copies values-free.

## 2. Do not

- Do not change the both-null exclusion rule — it is what caught the C10-class defect.
- Do not rank on `char_len`. Do not add a "winner" line — §5 of OCR1 is the operator's call.
- Do not install torch/surya/paddle in the sandbox; probe them, don't run them.
- Do not touch `deps.freeOcr`, the drain, or any live path.

## 3. Report back

- The three guards, mutation-verified, comments stripped.
- A self-test run showing the new ENGINES header and the self-control table on the synthetic
  fixture (stub model — say so).
- The exact re-run command for Scott: `--engines tesseract,paddleocr --control self` on the staged
  15, after `pip install paddlepaddle`.
- ⚠️ State plainly that no real-document verdict changes in this prompt. Sample size on file is
  still 10 real arm-A documents, tesseract only.
