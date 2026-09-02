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
→ gpt-4o vision.** Tier 1 is injected as `deps.freeOcr` (`document-text.js:328-347`).

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

⚠️ **AND THE DEED LANE NEVER TIERS AT ALL.** `document-text.js:502-505`: when `ocrTiered` is falsy it
calls `ocrPdfToText` → `invokeVisionExtractionAI` → **gpt-4o directly**, gated only on
`OPENAI_API_KEY`. **All 325 extracted deeds went to the most expensive tier**, on a path that never
consults DocAI at all.

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
2. **🟢 THE DURABLE ITEM — `OCR1`, and it is a BAKE-OFF FIRST, not a build.** ⚠️ **Justify it on the PAGE CAP and confidentiality, NOT on cost (§4a).** Stand an OCR endpoint on the GaryBuilt box
   (Surya / PaddleOCR / ocrmypdf-Tesseract, all already named in the design) behind the **existing**
   tunnel + CF Access, and inject `deps.freeOcr` at the two server call sites. **The seam already
   exists and is tested** (`test/document-text.test.mjs` stubs it). This makes routine OCR **$0/page
   permanently** and leaves DocAI as the escalation, which is what the design always said.
3. **🔴 Fix the deed lane's un-tiered gpt-4o call (`OCR2`).** `document-text.js:502-505` bypasses
   DocAI entirely. **That is the 6–14× tier as the DEFAULT for deeds** — a live, current, fixable
   waste independent of everything else.
4. **🔵 Verify the edge→Claude path (`OCR3`).** If it is 400ing, ~10 un-flagged call sites are on an
   unchosen fallback. **Measure before assuming either way.**
5. **🔵 Collapse the four Ollama clients into one (`OCR4`).**

### ⚠️ The honest risk in the local route — name it, do not assume past it

**Local OCR quality on executed leases is UNMEASURED.** The only tier comparison we have is
**DocAI 14,687 avg chars vs gpt-4o 1,579** — that says gpt-4o is bad, **not** that Surya matches
DocAI. **A bake-off on real leases is part of OCR1, not an afterthought**: run both engines over the
same 10 documents and compare `char_len` and readability at the midpoint. **If local loses badly,
Tier 1 becomes a pre-filter for born-digital PDFs only and DocAI stays the workhorse** — still a
large saving, and an honest one.

⚠️ **And the ~$1.50/1k rate itself is unverified** (the pricing page is egress-blocked from every
environment we have tried). **Confirm it before quoting a saving to anyone.**
