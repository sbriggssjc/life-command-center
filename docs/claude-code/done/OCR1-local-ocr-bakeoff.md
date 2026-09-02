# OCR1 — bake off a local OCR engine against DocAI, then decide

> **This is an EXPLORATORY prompt. Its deliverable is a MEASUREMENT and a recommendation.**
> **Build nothing beyond what the bake-off needs.** Wiring Tier 1 into the live path is OCR1b, and it
> should only be written after this measures a winner.

**Read first:** `docs/architecture/ai-and-ocr-cost-strategy.md` — **the whole page** ·
`docs/architecture/document-capture-ocr-and-deeds.md` — the CURRENT STATE block ·
`docs/UW4_LEASE_OCR.md` (the original Tier-1 design, which names the engines) ·
`CLAUDE.md` on the DocAI footguns.

---

## 0. ⚠️ READ THIS BEFORE ANYTHING — cost is NOT the justification

**Measured live 2026-09-02 across the whole CRE sidecar (362 rows):**

| method | tier | docs | avg chars | **billed pages** |
|---|---|---:|---:|---:|
| `pdf_text` — digital layer, **free** | — | **140** | 38,664 | 34 |
| `office_text` — docx/xlsx, **free** | — | **45** | 32,935 | 0 |
| **`ocr`** | **DocAI** | **91** | **13,801** | **574** |
| `ocr` | gpt-4o | 20 | 1,511 | — |
| marker / no extract | — | 66 | 0 | 0 |

**185 of 362 documents (51%) already extract for FREE.** Only **111 needed OCR at all**, and the
total DocAI spend to date is **574 billed pages ≈ $0.86.** The whole-lease-corpus estimate in
`UW4_LEASE_OCR.md` is **$23–53**.

🔴 **So do NOT build this to save money. It would save under a dollar on the work done so far, and
tens of dollars at corpus scale.** ⚠️ **If your writeup argues from cost, it is arguing from a number
that does not support it — say so instead.**

**The three arguments that DO hold, in order of strength:**

1. 🟢 **NO PAGE CAP.** ⚠️ **Every hard problem in this arc — DOC8, DOC14, DOC16, DOC17, DOC18 — has
   been about Google's page limit, not about money.** Five prompts, a refuted design, a blocked GCS
   build and a live probe, all to work around **15/30 pages per call**. A local engine has **no cap
   at all**, and it dissolves the entire class of problem. **This is the real prize.**
2. 🟢 **Confidentiality.** Today the complete PDF of every under-cap lease is sent to Google
   (`ocrCloudCheap` in `document-text.js` → the `docai-ocr` edge fn → `rawDocument` in the
   ProcessRequest). Local means **client lease text never leaves the
   building** — which is also the concern that blocked DOC14.
3. 🔵 **Resilience.** No vendor credit balance, no retired-model 400s, no quota surface. ⚠️ **This
   session already lost time to a "credit balance too low" on the Anthropic path** (OCR3).

## 1. The seam already exists — and that is the surprising part

`api/_shared/document-text.js` reads `deps.freeOcr` as Tier 1 (the seam is at ~`:631-633`, the
design comment at ~`:204` — ⚠️ grep for `deps.freeOcr`, do not trust a line number), **and nothing
has ever passed it.** No default; both real callers build `deps` without it. **It is already stubbed in
`test/document-text.test.mjs`** (lines 161, 178, 246, 258, 268), so the contract is known and tested.

⚠️ **The existing producer cannot be reused as-is.** `scripts/lease-ocr-backfill.mjs:379`
`freeOcr(pdfPath)` takes a **filesystem path**; the seam passes **`{buffer, mediaType}`**. It shells
out to `surya` / `paddleocr` / `tesseract` + `pdftoppm` / `ocrmypdf` and was written for the
workstation. **Read it — it is the reference implementation for engine choice and flags — but the
server-side shape is different.**

## 2. What to measure

**Run local engines and DocAI over the SAME real documents from our corpus and compare.**

- **Sample:** at least **10 documents that actually needed OCR** (`method='ocr'`,
  `ocr_tier='cloud_cheap'`) — ⚠️ **not `pdf_text` rows, which never touch OCR and would flatter both
  sides.** Include **at least 3 leases over 30 pages**, since those are the population that matters.
- **We already hold DocAI's output for every one of them**, so the comparison is against a real
  baseline rather than a fresh spend.
- ⚠️ **`char_len` IS NOT A QUALITY METRIC.** A garbled OCR produces plenty of characters. **This
  repo has already been burned by exactly that** — the gpt-4o rows averaged 1,511 chars and passed
  every count-based check while being useless.

**The metric that matters is whether the CONSUMER gets the same answer.** Run
`extractTenantFromLease` (`bov-extract.js`) over both texts for the same document and compare the
extracted fields — `tenant_name`, `lease_commencement`, `lease_expiration`, `year1_rent`,
`leased_sf`, `lease_type`. **Field agreement is the deliverable. Character counts are context.**

**Also report:** wall-clock per page, GPU vs CPU, and whether the engine handles our actual inputs
(scanned faxes, stamped recorder pages, multi-column DD reports).

## 3. Where it would run

**The GaryBuilt box, behind the EXISTING named Cloudflare tunnel + CF Access service tokens.** The
precedent is the **SOS fetch proxy** (government-lease `CLAUDE.md` §25) — a locked-down HTTP service
on that box, reached from Railway with a dedicated service token. **The box already has an RTX and
runs Ollama**, so GPU inference is proven there.

⚠️ **Use a DEDICATED CF Access service token, never the ollama one.** The SOS proxy documents this
explicitly, and `contact-acquisition-engine.js:74` carries the same warning.

⚠️ **The box is a single point of failure and it is not always on.** Tier 1 must **fail soft to
DocAI**, exactly as the tier chain already intends — a local engine being unreachable must never
turn into a stalled lane or a silent zero. **State how you would detect "the box is down" as
distinct from "the document has no text."**

## 4. ⚠️ What this must NOT do

- **Do not wire Tier 1 into the live path in this prompt.** Measure first. If local wins, the wiring
  is OCR1b with its own predicted deltas.
- **Do not touch the live drain.** 42 `over_docai_page_cap` markers and the DOC18 work are in flight;
  **nothing in the CRE or deed lane should move.**
- ⛔ **Do not reach for gpt-4o** in any arm. It is measured at ~9× less text than DocAI.
- **Do not install anything on the Railway host.** Tier 1 is out-of-process by design.
- ⚠️ **Do not conclude from a small sample that local "matches" DocAI.** If the sample is 10
  documents, say 10 — this arc has had **three** rates move materially when the sample grew.

## 5. What the answer decides

| result | consequence |
|---|---|
| **local matches DocAI on field agreement** | 🟢 **Write OCR1b: wire `deps.freeOcr`.** Routine OCR becomes $0 and **the page cap disappears** — DOC18's partial-extract ceiling and DOC14 both become unnecessary. |
| **local is close but weaker on scans** | 🟡 **Tier 1 as a born-digital / clean-scan pre-filter, DocAI as the escalation.** Still removes the cap for the documents it handles. Say which documents it can and cannot take. |
| **local loses badly** | 🔴 **Say so plainly and stop.** DocAI stays the workhorse, DOC18 stands, and this is recorded so it is not re-proposed. **That is a legitimate and useful outcome.** |

## 6. ⚠️ EXECUTION REALITY — added 2026-09-02 after re-measuring; overrides §2 where they conflict

**6a. The sample §2 asks for does not exist, by construction.** "≥3 leases over 30 pages with a
DocAI baseline" is impossible: the 30-page cap is *why* longer documents have no DocAI text.
Measured 2026-09-02, the longest `cloud_cheap` baseline is **exactly 30 pages** (doc 336), then
26/26/25/25. So the bake-off has TWO arms with different deliverables:

| arm | documents | what is measured |
|---|---|---|
| **A — head-to-head** (DocAI baseline exists) | `lcc_cre_property_document_text` where `method='ocr' and ocr_tier='cloud_cheap' and not needs_ocr`, take the 10 longest: doc ids **336, 425, 431, 255, 327** (leases 30/26/26/25/25pp), **386, 343, 228** (DDs 20/16/15pp), **436, 299** (leases 16pp) | field agreement, local vs DocAI, per §2 |
| **B — beyond the cap** (NO DocAI baseline) | over-cap leases **319 (141pp), 320 (118pp), 200 (63pp), 61 (39pp)** | does local return coherent `extractTenantFromLease` fields from the WHOLE document, and are the back-half clauses (renewal / early termination / default cure / holdover) legible? Once DOC18's partials land, pages 1–50 of these gain a DocAI baseline — compare that slice too. |

Arm B is the one that decides the page-cap argument, and it has no baseline to agree with —
**say so, and grade it on consumer-field coherence and a human read of named clauses, not on a
number.**

**6b. The sandbox cannot reach the inputs.** DOC17 and DOC18 both measured `http=000` to
`*.supabase.co` and Railway from Claude Code's sandbox; the PDFs are SharePoint server-relative
refs fetched only through the Power Automate flow (`SHAREPOINT_FETCH_URL`, a Railway env var), and
the DocAI baselines live in `lcc_cre_property_document_text.raw_text`. **So the deliverable
splits:**

1. **You build the harness**: `scripts/ocr-bakeoff.mjs`. Input: a folder `bakeoff/<document_id>/`
   holding `source.pdf` and, for arm A, `docai.txt`. It probes the engines on PATH (the
   `lease-ocr-backfill.mjs` probe order — `surya`, `paddleocr`, `ocrmypdf`, `tesseract`+`pdftoppm`;
   ⚠️ **which of those the sandbox actually has is a measurement — report it**), writes
   `local.<engine>.txt`, runs `extractTenantFromLease` over every text with the SAME injected
   `deps.invokeExtractionAI`, and emits `agreement.json` + `agreement.md` (per document, per field,
   per engine, plus wall-clock per page and engine version). **Prove it in-sandbox on a synthetic
   fixture** — render a PDF of known text (and a deliberately degraded copy) so the harness's own
   plumbing is verified before it meets a real lease.
2. **Scott runs it** on the workstation or the GaryBuilt box, where the PDFs, Ollama and the GPU are.
   Give the harness a `--fetch-baselines` step that pulls `raw_text` for the arm-A ids from
   `lcc_cre_property_document_text` (PostgREST, `extractor_version='unit1_v1'`, the LCC Opps service
   key from the local env) into `bakeoff/<id>/docai.txt` — the workstation can reach Supabase, the
   sandbox cannot. Scott supplies only the PDFs. ⚠️ `bakeoff/` is git-ignored: it holds client
   lease text and must never be committed.

**6c. `extractTenantFromLease` needs a MODEL.** It calls `invokeExtractionAI` (`bov-extract.js:39`,
`:249`). The field comparison is only fair if both texts go through the **same** model and prompt
— record the model in the report. In the sandbox that means a stub; the real run uses the box's
Ollama. ⚠️ The §4 gpt-4o ban is about OCR arms; the extraction model is a separate choice, but
**it must be identical across arms**.

**6d. Line numbers in this prompt have already drifted once** (see §1) — anchor on symbol names.

## 7. Report back

- **The field-agreement table** — per document, per field, local vs DocAI. This is the deliverable.
- **Which engine(s)** you ran, versions, and GPU/CPU, with per-page wall-clock.
- **The documents it FAILED on**, and what kind they were. ⚠️ **A failure mode is more useful than an
  average.**
- **Your recommendation against §5**, and — if it is row 1 or 2 — what OCR1b would need, including
  the fail-soft detection from §3.
- ⚠️ **State the sample size in every claim**, and **do not restate the cost case** — §0 already
  measured it and it does not support this build.
