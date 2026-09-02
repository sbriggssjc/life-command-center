# OCR1 — second real run, with the model self-agreement floor (Scott's workstation, 2026-09-02)

**Reconciled by Cowork from `bakeoff/agreement.md` (local, git-ignored). Findings only.** Sample:
**10 real arm-A documents + 5 arm-B + 3 fixtures. Engines that ran: tesseract 5.5 only** —
paddleocr 3.7 now had `paddlepaddle` installed and failed on every document with a PaddlePaddle
runtime error (`ConvertPirAttribute2RuntimeAttribute … onednn_instruction.cc`) — a oneDNN/PIR
defect in paddlepaddle 3.x on Windows CPU, not a harness fault; surya correctly reported "runs a
VLM server via Docker — intended for the GPU box" once instead of failing 18 times.

## 1. The floor — the number everything else is read against

Same model, same prompt, same DocAI text, two independent calls, same comparator:

| field | self-rate |
|---|---:|
| `tenant_name` | 100% |
| `lease_commencement` | 90% |
| `lease_expiration` | 71% |
| `year1_rent` | 89% |
| `leased_sf` | 100% |
| `lease_type` | 100% |
| **all** | **93%** (52 agree / 4 disagree / 16 both-null over 12 docs) |

**The extraction model disagrees with ITSELF on 7% of decided fields — 29% on `lease_expiration`.**
That is the noise floor; no engine can be read as better than it.

## 2. Tesseract vs DocAI, read against the floor

| field | tesseract rate | rate − self |
|---|---:|---:|
| `tenant_name` | 83% | −17 pp |
| `lease_commencement` | 70% | −20 pp |
| `lease_expiration` | 71% | 0 |
| `year1_rent` | 67% | −22 pp |
| `leased_sf` | 83% | −17 pp |
| `lease_type` | 100% | 0 |
| **all** | **80%** (45 / 8 disagree / 3 docai-only / 16 both-null) | **−13 pp** |

**Read on named rows, the 11 non-agreements split:**

- **Model arithmetic, not OCR (2):** doc 255 `year1_rent` — both texts say the same monthly rent
  verbatim; the DocAI side returned the monthly figure and the tesseract side an annualization that
  matches neither 12× nor the text (**89,496 this run, 84,464 last run — the model invents the
  annual figure differently each call**). Doc 425 rent differs by **$1** (132,430 vs 132,431) —
  rounding is deliberately not a tolerance, so it counts, and it is the model.
- **Date-default noise (4):** 255 / 425 / 327 `lease_commencement` and 425 `lease_expiration`, off by
  a day or a month — the same class the self-control shows at 10–29%.
- **Genuine tesseract-side misses (3):** 327 `leased_sf` and 386 `lease_expiration` found by DocAI
  and not from the tesseract text; **431 `tenant_name` returned a PERSON'S name** from the tesseract
  text where DocAI's text yielded the company — the one disagreement that reads as an OCR/layout
  effect (reading order or a guarantor block promoted).
- **Fixture (2):** the synthetic noisy page, as designed.

## 3. Arm B — unchanged from run 1

Tesseract read every page (59/63/141/118/59); back-half clauses 3/4, 4/4, 4/4, 4/4, 1/4 (the 1/4 is
the title bundle at conf 68). 2.2–3.5 s/page CPU. **The page-cap case stands.**

## 4. Verdict against OCR1 §5 — for TESSERACT, on this sample

**Row 2: "local is close but weaker on scans."** Tesseract on CPU reads **~13 points below DocAI
above a 93% model floor**, on 10 documents; three of its eleven misses are real, the rest are the
model. It is a legitimate **free pre-filter / fallback and it removes the page cap**, but it is not
a DocAI replacement on field quality. ⚠️ **The engines the decision was meant to rest on — surya
and PaddleOCR — have still produced ZERO results, and both are now known to be un-runnable on the
Windows workstation** (Docker-hosted VLM; a paddlepaddle CPU runtime bug). **The deciding run is on
the GaryBuilt box (Linux + RTX), and it has not happened.**

## 5. A finding that is not about OCR at all

The self-control exposed the extraction model as the larger error source on two fields:
`year1_rent` is annualized in the model's head, inconsistently; `lease_expiration` self-disagrees
29%. **`extractTenantFromLease` should return the rent WITH its basis (monthly/annual as stated in
the lease) and let code annualize**, and dates should be returned as quoted, not defaulted. That
improves BOV extract regardless of which OCR wins → backlog **EXT1**.

## 6. Next

1. **GaryBuilt run** (Scott): surya + paddle + tesseract, `--control self`, same 15 documents — the
   run that decides OCR1b. Surya needs Docker on the box; paddle needs the Linux wheel.
2. **EXT1** (CC, independent of OCR): rent basis + quoted dates in the extractor, with the
   self-agreement floor as the before/after metric.
3. OCR1b stays unwritten until (1) reports.
