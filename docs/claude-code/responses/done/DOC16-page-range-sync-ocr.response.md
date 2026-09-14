# DOC16 — response: the §2 gate REFUTES the route, and not by the branch the prompt predicted

**Date:** 2026-09-02 · **Outcome:** ⛔ **closed, hand back to DOC14** · **Code changed: none.**

---

## 1. The page-selector contract, as READ from the live discovery document

`https://documentai.googleapis.com/$discovery/rest?version=v1`, **revision `20260820`**, fetched
2026-09-02.

**Does the synchronous `process` accept a page selector? YES.**

- `GoogleCloudDocumentaiV1ProcessRequest` carries **`processOptions`** →
  `GoogleCloudDocumentaiV1ProcessOptions`, *"Inference-time options for the process API"*.
- `ProcessOptions` carries:
  - **`individualPageSelector`** → `{ pages: int32[] }`, *"Indices of the pages (starting from 1)"*
  - **`fromStart`** (int32) — *"Only process certain pages from the start. Process all if the
    document has fewer pages."*
  - **`fromEnd`** (int32) — *"Only process certain pages from the end, same as above."*
- The proto (`googleapis/.../documentai/v1/document_processor_service.proto`) groups those three in
  a `oneof page_range` and states the block **"only applies to online processing with
  ProcessDocument"** — the selector is *designed for* the sync path.

**Where it goes, read rather than inferred:** `processOptions` is a sibling of `rawDocument` and of
the top-level `imagelessMode` boolean. The two are different fields at different levels. ✅ As the
prompt instructed, the existing `imagelessMode` comment in `docai-ocr/index.ts` was **not** used as
evidence for the selector's placement.

## 2. ⚠️ The decisive half — the cap applies to the SELECTION, but ONLY from page 1

**The discovery document states no page limits at all.** It is a schema, not a quota surface;
grepping it for page-limit language returns nothing, and that zero is a property of the instrument,
not a finding. The limit lives on Google's **Limits** page:

> *"To extend the maximum page limit for online and synchronous requests up to 30, enable
> `imageless_mode` in `ProcessRequest`. **This extended limit is only applicable when processing
> pages contiguously starting from page 1.**"*

⚠️ **§2 asked a binary — selection or total — and the answer is neither.** The cap is **not**
measured against the document total (the branch §2 said would kill the route), and it is **not**
measured against an arbitrary selection. It is measured against a selection **that begins at page 1**.

| §3 call | selection | contiguous from p1? | extended 30pp cap |
|---|---|---|---|
| **1** | pages 1–30 (`fromStart: 30`) | yes | ✅ applicable |
| **2** | **pages 31–50** | **no** | ❌ **explicitly not applicable** |

**Call 2 is the entire argument.** Call 1 alone gives ~30 pages ≈ **54,000 chars against the
consumer's 90,000-char window**, and for the 18 documents at 31–50 pages it discards pages 31–50 —
which §4 itself names as where renewal, early termination, default cure and holdover clauses sit.
§4's *"on the consumer's terms this is lossless"* holds only if call 2 exists.

**So: stop, and hand back to DOC14.** The confidentiality decision DOC14 needs is **live again** — it
was deferred on the strength of a premise that does not hold.

## 3. What is left unmeasured, and why it was not guessed at

**For a selection that does NOT start at page 1, is the base 15-page online limit measured against
the selection or the document total?** Google states nothing about it. If it were the selection, a
`1–30` + `31–45` pair would reach ~45 pages ≈ 81,000 chars and DOC16 would be revivable in modified
form.

⚠️ **Not assumed in either direction.** Only a live probe settles it, and one is not available here:

- **No GCP/DocAI credentials in the environment** — nothing to authenticate a direct call.
- **Deployed `docai-ocr` v24 sends no `processOptions` at all**, so it cannot answer the question
  without a production redeploy — outside this task's scope.
- **`docs.cloud.google.com` is blocked by the egress proxy**, so the Limits text above was
  triangulated across three independent searches rather than fetched from the primary page.

⚠️ **The DOC8 marker's own number settles nothing here:** the live error
`"Document pages exceed the limit: 30 got 40"` / `metadata = { page_limit: "30", pages: "40" }` came
from a request with **no selector**, where selection and total are the same value.

## 4. Population re-measured — §5's baseline was stale

`lcc_cre_property_document_text where reason = 'over_docai_page_cap'`, live 2026-09-02:

| | prompt said | measured |
|---|---:|---:|
| rows | 40 | **42** |
| 31–50pp | 16 | **18** |
| >50pp | 24 | **24** |
| page range | 31–141 | **31–141 (avg 52)** |

**The chars/page basis reproduces:** across 85 rows with text and a page count, **mean 1,808 /
median 1,732 chars per page** — so the ~50-page consumer window is confirmed, and the residual
ceiling §6 asked to be sized is: **at 30 pages, all 42 documents truncate below their real length;
at 50 pages, 24 still would.**

## 5. Not built, deliberately

A single `fromStart: 30` call is technically available and converts all 42 rows with no GCS. It was
**not** built: ~54,000 of 90,000 usable chars makes it lossy for the *entire* population rather than
lossless for any of it — a materially different deliverable from the one DOC16 argued for, and a
call for Scott rather than a default.

**This change is documentation only. No behaviour changed, no `processOptions` was added, no edge
function was deployed.**
