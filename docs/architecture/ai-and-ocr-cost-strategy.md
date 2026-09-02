# AI & OCR cost strategy — local vs Microsoft vs Google

> 📍 **THE canonical page for "what do our AI calls cost and where should they run."**
> Scott, 2026-09-02: *"I'd rather spend the time to build the long-term solution rather than the
> current subtask's best objective."* This page answers that for the whole OCR/AI surface, not just
> the lease backlog.
>
> **Sibling:** [`document-capture-ocr-and-deeds.md`](document-capture-ocr-and-deeds.md) — the
> pipeline itself. **This page is about WHERE the compute runs and what it costs.**
> **Inventoried 2026-09-02 from source; live flag state read from `feature_flags_registry`.**

---

## 0. ⚠️ THE HEADLINE — the free tier is designed, has a producer, and is NOT WIRED

**`api/_shared/document-text.js` documents a three-tier OCR chain: free local → cheap cloud (DocAI)
→ gpt-4o vision.** Tier 1 is injected as `deps.freeOcr` (`document-text.js` ~`:631` — grep `deps.freeOcr`; the line number quoted here drifted once already).

🔴 **`deps.freeOcr` HAS NO SERVER-SIDE PRODUCER. NOTHING PASSES IT. EVER.**

- There is **no default** — `ocrPdfToTextTiered` reads it straight off the caller's `deps` object.
  Absent ⇒ the entire Tier-1 block is skipped and execution falls through to paid.
- Both real server callers — the deed worker (`_handlers/document-text.js:196-221`) and the CRE tick
  (`cre-property-doc-text.js:198-218`) — **construct `deps` without it.**
- The **only** producer in the repo is `scripts/lease-ocr-backfill.mjs:379`, which takes a
  **filesystem path**, not `{buffer, mediaType}` — **an incompatible signature with the seam** — and
  runs on Scott's workstation, POSTing recovered text back through a separate endpoint.

**So every OCR call this system has ever made started at a paid tier.** The $0 tier exists in the
design, in the comments, and in a script — and has never once run in production.

~~⚠️ **AND THE DEED LANE NEVER TIERS AT ALL.** `document-text.js:502-505`: when `ocrTiered` is falsy it
calls `ocrPdfToText` → `invokeVisionExtractionAI` → gpt-4o directly. All 325 extracted deeds went to
the most expensive tier.~~ ⚠️ **REFUTED 2026-09-02 — read this instead.** The deed drain
(`api/_handlers/document-text.js:217`) passes **`ocrTiered: true` by default and no caller in `api/`
passes `false`**; the gpt-4o-direct branch (`document-text.js` ~`:860`) is reachable only by an
opt-out nobody uses. **The "325 to gpt-4o" number was a DATE artifact:** 154 of the 185 dated gov
deed extractions ran **2026-07-15 → 07-25, before DocAI went live on 2026-08-12** — the cheap tier did
not exist, so gpt-4o was the only OCR there was. The 30 extracted on 08-12/13 went through the
tiered chain. **The genuine defect is that gov `property_documents.extracted_data` carries NO OCR
provenance** (`deed_extraction` + `extracted_at` only — the handler computes `ocr_tier` /
`ocr_engine` / `ocr_pages` and returns them on the tick, then drops them), so the tier mix cannot be
audited after the fact — which is precisely how an unverifiable claim got written into three
documents. **OCR2 is re-scoped to that** (backlog row). ✅ **SHIPPED 2026-09-02** — the four fields now persist into `extracted_data.document_text` on both domains through `<dom>_merge_document_extracted_data`, the single owner of writes to that column, and the tier mix is readable on `v_gov_deed_ocr_provenance` / `v_dia_deed_ocr_provenance`.

- ⚠️ **The build found a second writer the re-scope had not named: `deed-parser.js` REPLACED the whole `extracted_data` column**, so a provenance key written beside `deed_extraction` was destroyed on every deed, and on every re-parse. Evidence it was real: gov's 185 rows carry **exactly** the two keys that write puts there, while dia carries 10 with a third (`r59_backfilled_at`) from the one call site that already merged. **Before adding a key to a shared jsonb column, enumerate its writers and check whether any of them REPLACES rather than merges.**
- ⚠️ **The gpt-4o-direct branch is GONE, and the hazard was the DEFAULT, not any live caller.** `extractDocumentText`'s signature read `ocrTiered = false`; both production callers passed `true`, so nothing reached gpt-4o directly — the risk was that a NEW caller inherits the 6–14× tier by writing nothing at all. The default is `true`, an explicit `false` is refused by name, and `ocrPdfToText` now has **exactly one call site**: tier 3 inside `ocrPdfToTextTiered`.
- ⚠️ **NOTHING WAS BACKFILLED, and that is the verification.** 507 rows' tier is unknowable (the 154 pre-DocAI extractions plus 140 gov rows carrying no date at all). They read `unrecorded`; **`unrecorded` FALLING would mean somebody guessed a tier.**
- **Read `provenance_written` on the tick, never the `ocr_tier`/`ocr_engine` beside it** — those report what was COMPUTED, and the gap between computed and persisted was the entire defect.
  Writeup: `docs/audits/OCR2_DEED_OCR_PROVENANCE_2026-09-02.md`.

## 1. Microsoft is not the answer, and the repo already established why

| claim | evidence |
|---|---|
| **M365 Copilot has no batch-OCR API** | `docs/UW4_LEASE_OCR.md:46-48` |
| **Microsoft's OCR product is Azure Document Intelligence — SEPARATELY METERED, not in the M365 subscription** | same |
| ⚠️ **Northmarq IT BLOCKS Azure AD app registrations** | `api/sync.js:2509` · `api/_shared/todo-completion.js:6` · `docs/architecture/flows/todo-completion-poll.md:50` — three independent places |

**There is no Azure AI client anywhere in the codebase.** `azure_di` appears only as a *string label*
in `cloudOcrProviderMode()` (`document-text.js:227,241,319`) that maps to the generic webhook path —
**no `AZURE_*` OCR env var, no `cognitiveservices`/`formrecognizer`/`documentintelligence` call.**
All 18 Power Automate flow definitions use only Office365/OneDrive/Outlook/Teams/ToDo connectors —
**no AI Builder, no Azure OpenAI, no Document Intelligence action.**

**Conclusion: routing OCR to Microsoft would mean a NEW paid vendor reached through an auth path IT
blocks, for no quality or price advantage over DocAI.** ⚠️ **Do not re-propose it** — and note the
existing standing instruction in `document-capture-and-ocr-status.md:22-24`: *"Do NOT re-provision,
re-wire, or recommend Azure/other OCR from scratch."*

## 2. What runs locally today, and what does not

**The GaryBuilt box already carries the infrastructure this needs:** a named Cloudflare tunnel,
CF Access service tokens, Ollama on an RTX, and **a working precedent for a locked-down HTTP service
on that box — the SOS fetch proxy** (government-lease §25).

**Live flags, read from `feature_flags_registry` 2026-09-02** (⚠️ **the migration seeds say `off`;
the DB says otherwise — the seeds are authoring-time snapshots and deliberately do not update
`state` on conflict, so ONLY the DB is authoritative**):

| flag | state |
|---|---|
| `OLLAMA_EXTRACTION` · `OLLAMA_CLEAN_ASSIST` · `PROPERTY_TWIN_ASSIST` · `MATCH_DISAMBIG_ASSIST` · `W9_3_SF_ASSIST` · `OWNERSHIP_CHAIN_DRAFT` · `DRAFT_ASSIST` · `BRIEFING_ANALYST_TAKE_ONPREM` · `OCR_CLOUD_DOCAI` | **on** |

**So the LLM side is already substantially local.** `qwen2.5:14b` on the box serves extraction,
cleaning assists, ranking and drafting. ⚠️ **But OCR is not an LLM task and Ollama does not do it** —
conflating the two is the trap here.

⚠️ **Four separate reimplementations of the same Ollama HTTP call exist** —
`invokeOllamaExtraction`, `invokeOnPremGeneration`, `invokeOnPremEmbeddings` (all `ai.js`), plus a
**fully inline copy** in `admin.js:931-964` that bypasses `ai.js` entirely, and `invokeOllamaChat`
which uses a *different endpoint shape* and **omits the CF-Access headers**. That is the
normaliser-drift pattern this repo documents everywhere else, in the AI client.

## 3. ⚠️ The default cloud path may be FAILING, not spending

`invokeChatProvider` defaults to `AI_CHAT_PROVIDER='edge'` → the `ai-copilot` edge function →
**Anthropic `claude-sonnet-4-20250514`** (`handlers-a.ts:53`). Two independent records say that path
is broken:

- `api/_shared/share-extractor.js:9-11` — that snapshot *"which Anthropic has retired — calls return
  400."*
- `CLAUDE.md` and `briefing-analyst-take-onprem.md` — a live *"Your credit balance is too low"* 400.

⚠️ **`invokeExtractionAI`'s fallback chain would absorb that silently into OpenAI `gpt-4o-mini`.** So
roughly **ten** un-flagged call sites in `operations.js` (briefings, drafts, dossiers, pipeline
intelligence) may be quietly running on a fallback nobody chose. **This is unverified and is the
first thing to measure** — see §5.

## 4. What it actually costs — and why the answer is "not much, yet"

⚠️ **There is NO pricing constant, no rate variable, and no spend budget anywhere in executable
code.** The `~$1.50/1k pages` figure is **comment-only**, in four places. `ocr_pages` is recorded as
"what we were billed for" and **never priced**. The only guards are time budgets and byte caps.

**The one whole-corpus estimate in the repo** (`docs/UW4_LEASE_OCR.md:28-30`), for ~860 leases /
15k–35k pages: **Tier 1 $0 · Tier 2 (DocAI) ~$23–53 · Tier 3 (gpt-4o) ~$150–500.**

**So on today's volume Google is cheap and the decision is not urgent on cost.** Scott's argument is
about **compounding**: re-OCR for a second BOV, revisiting a lease, a growing corpus. **A $0 tier
compounds to $0; a $50 tier compounds.**

## 4a. 🔴 MEASURED 2026-09-02 — cost is NOT the case for local OCR, and saying so is the point

**Across the whole CRE sidecar (362 rows):**

| method | tier | docs | avg chars | **billed pages** |
|---|---|---:|---:|---:|
| `pdf_text` — digital layer, **free** | — | **140** | 38,664 | 34 |
| `office_text` — docx/xlsx, **free** | — | **45** | 32,935 | 0 |
| **`ocr`** | **DocAI** | **91** | **13,801** | **574** |
| `ocr` | gpt-4o | 20 | 1,511 | — |
| marker / no extract | — | 66 | 0 | 0 |

**185 of 362 documents (51%) already extract for FREE.** Only **111 ever needed OCR**, and total
DocAI spend to date is **574 billed pages ≈ $0.86.**

⚠️ **So the cost argument for Tier 1 does not survive contact with the numbers, and this page's §5
recommendation is corrected accordingly.** At corpus scale it is **$23–53**. **Anyone arguing local
OCR on savings is arguing from a number that does not support it.**

**The arguments that DO hold, in order of strength:**

1. 🟢 **NO PAGE CAP — this is the real prize.** ⚠️ **Every hard problem in this arc — DOC8, DOC14,
   DOC16, DOC17, DOC18 — was about Google's page limit, not money.** Five prompts, a refuted design,
   a blocked GCS build and a live probe, to work around **15/30 pages per call**. A local engine has
   **no cap**, and it dissolves the whole class of problem — including DOC18's partial-extract
   ceiling and DOC14 entirely.
2. 🟢 **Confidentiality.** Today the complete PDF of every under-cap lease goes to Google
   (`document-text.js:262`). Local means client lease text **never leaves the building** — the same
   concern that blocked DOC14.
3. 🔵 **Resilience.** No credit balance, no retired-model 400s, no quota surface. ⚠️ **This session
   lost time to exactly that on the Anthropic path** (OCR3).

## 5. 🟢 The recommendation

**Ship DOC18 now, then wire Tier 1 on GaryBuilt. Do not route OCR to Microsoft.**

1. **DOC18 (staged) — the three-call sync route.** ~$3.30 clears all 42 over-cap documents. **Do not
   hold it for the strategic work**; it is cheap, measured and unblocks the consumer today.
2. **🟢 THE DURABLE ITEM — `OCR1`, and it is a BAKE-OFF FIRST, not a build.** ⚠️ **Justify it on the PAGE CAP and confidentiality, NOT on cost (§4a).**
   ✅ **FIRST REAL RUN DONE 2026-09-02 — 15 real documents, TESSERACT ONLY** (surya needs a Docker
   VLM server → GaryBuilt; paddle lacked `paddlepaddle`). **The page-cap case is MEASURED TRUE**: 141
   pages read in one pass, 4/4 back-half clauses legible, 2.3–3.5 s/pp CPU. **Quality parity is
   UNPROVABLE as built** — 36/47 fields agree, but ≥6 of the 11 non-agreements are harness/model
   artifacts (curly apostrophes, `""` vs null, model arithmetic on identical source text), and the
   harness has no model self-agreement floor. Record: `responses/done/OCR1-run.response.md`; next:
   **OCR1c** (harness) → re-run with paddle. *(History:)* harness built PR #2038, guards 9/9 RED; the
   bake-off was Scott's run — the sandbox has no egress to Supabase/Railway (`http=000`, re-measured) and the
   PDFs come through the Power Automate SharePoint flow, so it runs on the workstation or the
   GaryBuilt box. Command sequence + how to read the output:
   [`docs/audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md`](../audits/OCR1_LOCAL_OCR_BAKEOFF_2026-09-02.md) §6.
   - ⚠️ **AND ONE SCOPE CORRECTION THAT HOLDS WHICHEVER WAY IT LANDS: removing the OCR page cap does
     NOT give the consumer the whole lease.** `LEASE_TEXT_SLICE_CHARS = 90,000` still caps what
     reaches the model — ~52 pages at the corpus MEDIAN density (1,738 chars/page, measured per
     document over 87 OCR'd docs) and **~33 at p90**. An uncapped local engine removes the
     ACQUISITION ceiling (we would hold all 141 pages, free and re-readable); the CONSUMPTION ceiling
     moves to the extractor. **OCR1b must say which ceiling it is moving** — "dissolves the page-cap
     class of problem" is true of acquisition only. ⚠️ Note DOC18's "~1,800 chars/page ⇒ ~50 pages"
     **is correct at the median**; a sum-weighted aggregate reads 2,195 and answers a different
     question.
   - Arm B's population is **42 documents / 2,200 pages / 31–141pp / 24 of them over 50pp**, not the
     four the OCR1 prompt names.
   Stand an OCR endpoint on the GaryBuilt box
   (Surya / PaddleOCR / ocrmypdf-Tesseract, all already named in the design) behind the **existing**
   tunnel + CF Access, and inject `deps.freeOcr` at the two server call sites. **The seam already
   exists and is tested** (`test/document-text.test.mjs` stubs it). This makes routine OCR **$0/page
   permanently** and leaves DocAI as the escalation, which is what the design always said.
3. **🟡 `OCR2` — RE-SCOPED 2026-09-02: the deed lane DOES tier; what it lacks is PROVENANCE.**
   ~~`document-text.js:502-505` bypasses DocAI entirely; the 6–14× tier is the default for deeds~~ —
   refuted (§0). The build is: persist `method` / `ocr_tier` / `ocr_engine` / `ocr_pages` on the gov
   and dia deed rows (the handler already computes them and drops them), so the deed tier mix is
   auditable like the CRE sidecar's; and close the gpt-4o-direct opt-out so no future caller can
   reach it by omission. Prompt: `OCR2-deed-lane-ocr-provenance.md`.
4. **🔵 Verify the edge→Claude path (`OCR3`).** If it is 400ing, ~10 un-flagged call sites are on an
   unchosen fallback. **Measure before assuming either way.**
5. **🔵 Collapse the four Ollama clients into one (`OCR4`).**

### ⚠️ The honest risk in the local route — name it, do not assume past it

**Local OCR quality on executed leases is STILL UNMEASURED — the harness exists, the measurement
does not.** The only tier comparison we have is **DocAI 14,687 avg chars vs gpt-4o 1,579** — that
says gpt-4o is bad, **not** that Surya matches DocAI.

⚠️ **AND `char_len` IS THE WRONG YARDSTICK — this line used to propose it and that was wrong.**
Demonstrated on the harness's own fixture: a deliberately degraded scan produced **575 characters
against the clean read's 518 — MORE text, and 4-of-6 field agreement against 6-of-6.** A garbled OCR
is not short. **Grade on whether `extractTenantFromLease` gets the same ANSWER** (tenant, dates,
rent, SF, lease type); `ocr_confidence` and a wordlike-token ratio track quality, `char_len` did not.

⚠️ **The metric's own trap: a document that defeats BOTH engines returns null on every field, and
naive equality then reports 100% agreement over a total failure.** The harness excludes both-null
from the denominator by construction — and that rule immediately caught a real defect in the harness
itself (two graded fields were being read under the model's JSON key rather than the consumer's, so
they scored `both_null` forever; counting both-null as agreement would have rendered it as a perfect
6/6). Read `both_null` on every row before believing any rate. **If local loses badly,
Tier 1 becomes a pre-filter for born-digital PDFs only and DocAI stays the workhorse** — still a
large saving, and an honest one.

⚠️ **And the ~$1.50/1k rate itself is unverified** (the pricing page is egress-blocked from every
environment we have tried). **Confirm it before quoting a saving to anyone.**
