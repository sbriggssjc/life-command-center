# OCR1 — first real bake-off run (Scott's workstation, 2026-09-02 16:00–16:43 UTC)

**Reconciled by Cowork from `bakeoff/agreement.md` (local, git-ignored — it carries tenant names and
rents; this record carries findings only).** Sample: **15 real documents** (arm A 10 with a DocAI
baseline, arm B 5 over the cap) + 3 synthetic fixtures. **Engines that actually ran: tesseract
5.5 only.** Model: `invokeExtractionAI` → the box's Ollama, same on both sides.

## 1. What happened to the engines

| engine | result | cause | fix |
|---|---|---|---|
| surya 0.22.1 | FAILED ×18 | runs its VLM in a `surya-vllm` Docker container; Docker daemon not running; a CPU vLLM container would be very slow anyway | **run on GaryBuilt** (Linux + RTX), not the workstation |
| paddleocr 3.7.0 | FAILED ×18 | `paddlepaddle` (the engine) is not installed — `pip install paddleocr` pulls only the wrapper | `pip install paddlepaddle` |
| ocrmypdf | not installed | — | optional |
| tesseract 5.5 | ran on all 18 | — | — |

Two harness defects surfaced: it shows the FIRST 160 chars of stderr (a `RequestsDependencyWarning`)
instead of the failure at the end; and `--self-test` needs Python Pillow on Windows and says so
honestly but does not name the fix.

## 2. Arm A — tesseract vs DocAI, 10 real documents, 47 graded fields

**36 agree · 11 non-agree · 12 both-null (of 60).** Per document: 3/3, 3/5, 6/6, 3/6, 4/6, 3/3, 6/6,
2/5, 5/5, 1/2. Per field: `lease_type` 12/12, `leased_sf` 86%, `tenant_name` 75%, `lease_expiration`
75%, `year1_rent` 67%, `lease_commencement` 64%.

**⚠️ The 11 non-agreements were READ, not counted, and most are not OCR:**

- **2 are a comparator artifact** — tesseract emits a curly apostrophe (`’`) where DocAI emits `'`;
  the tenant name is otherwise identical. The comparator must normalize quotes.
- **2 are an empty-string-vs-null artifact** — DocAI-side model returned `""`, local returned `null`;
  scored `candidate_only`. Both mean "not found".
- **2 are MODEL arithmetic on identical source text** — both texts carry the same monthly rent
  figure verbatim (grepped); one side returned the monthly figure, the other an annualized-and-
  mis-added one that appears in neither text. The OCR was identical; the model was not.
- **4 date disagreements** (commencement/expiration off by days or months) — cause UNKNOWN without a
  model self-agreement control; the same model on the same text can pick a different date default.
- **1 genuine OCR error**, and it is on the synthetic NOISY fixture (`LLC` → `uc`), not a real document.

**Verdict on arm A: tesseract on CPU is plausibly at parity with DocAI on this sample — and that
claim is UNPROVABLE with the harness as built.** Without grading DocAI-text against a second run of
the same model on the same DocAI-text, there is no floor for "how much disagreement is the model,"
so the 77% raw rate has no interpretation. That control is the first thing OCR1c must add.

## 3. Arm B — beyond the cap, 5 real documents

Tesseract read **every page**: 59, 63, 141, 118, 59 (2,200 pages in the corpus of 42; this sample
440). Back-half clauses found: 3/4, 4/4, 4/4, 4/4, 1/4 — the 1/4 is doc 407, a title/docs bundle at
confidence 68 (a poor scan, not a lease). **The page cap is simply gone for a local engine — which
was the whole case, and it held.** Throughput **2.3–3.5 s/page on workstation CPU**; the 141-page
lease took 403 s.

## 4. What this decides, and what it does not

- ✅ **The page-cap argument is measured true.** A local engine read 141 pages in one pass with the
  back-half clauses legible. DOC18's partial ceiling and DOC14 are unnecessary *if* a local engine
  is adopted.
- ❓ **Quality parity is unproven either way.** The sample shows no clear tesseract loss on real
  documents once artifacts are removed, and cannot show a win without the self-agreement control.
- ❌ **Surya and PaddleOCR — the engines the decision was meant to rest on — produced 0 results.**
  The GPU engines have not been graded.
- **§5 row: none selected.** Nearest reading is row 2 ("close; grade the scans") pending OCR1c.

## 5. Next — OCR1c (harness) then re-run

1. Normalize quotes/apostrophes/whitespace and treat `""` as null before comparing.
2. Add `--control self`: run the model twice on the DocAI text and report self-agreement per field —
   the floor every engine rate is read against.
3. Show the LAST 300 chars of stderr on an engine failure; name the Pillow fix in `--self-test`.
4. `pip install paddlepaddle` on the workstation; surya on GaryBuilt.
5. Re-run `--engines tesseract,paddleocr --control self` on the same 15.
