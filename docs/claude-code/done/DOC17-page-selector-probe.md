# DOC17 — one API call decides between "no GCS at all" and a full GCS build

> **This is a PROBE, not a build.** Its entire deliverable is a measured answer to one question.
> **Do not build the extraction lane in this prompt**, whichever way the answer falls.

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — the CURRENT STATE block and
the DOC16 entry · the DOC16 response in `docs/claude-code/responses/` (it read the contract and
found the constraint) · `CLAUDE.md` on the DocAI footguns.

---

## 1. Where this stands

**DOC16 was refuted — but not through the branch its own STOP clause predicted.** The sync path
**does** accept a page selector (`ProcessRequest.processOptions` → `ProcessOptions` with
`individualPageSelector {pages}`, `fromStart`, `fromEnd`; the proto scopes that oneof to *"online
processing with ProcessDocument"*). The constraint is elsewhere. Google's Limits page:

> *"To extend the maximum page limit for online and synchronous requests up to 30, enable
> `imageless_mode`… **This extended limit is only applicable when processing pages contiguously
> starting from page 1.**"*

**So the 30-page extended cap applies to the SELECTION, but only when that selection starts at page 1
and is contiguous.** DOC16's second call — pages 31–50 — cannot claim it **by construction**, and
that second call was the load-bearing half: it is the whole difference between **~30 pages ≈ 54,000
chars** and **~50 pages ≈ 90,000 chars**, and 90,000 is what DOC16's "lossless on the consumer's
terms" argument rested on.

⚠️ **And the consequence INVERTS that claim rather than shrinking it.** A 30-page-only route drops
pages 31–50 for **all 42** over-cap documents — **~36,000 chars, about 40% of the consumer's
90,000-char window** — and that is content `extractTenantFromLease` genuinely reads.

## 2. The one unsettled question

**Is a NON-page-1 selection measured against the SELECTION or the DOCUMENT TOTAL?**

Concretely: on a 141-page PDF, does `individualPageSelector: {pages: [31..45]}` — **15 pages, within
the BASE limit, no imageless mode** — succeed, or does it fail because the document has 141 pages?

- **Google's documentation says nothing about it.** The Limits page addresses only the *extended*
  limit's page-1 condition.
- **The only error we hold does not discriminate:** DOC8's
  `"Document pages exceed the limit: 30 got 40"` with metadata `{page_limit: 30, pages: 40}` was
  taken with **no selector at all**.
- **The discovery document states no page limits** — it is a schema, not a quota surface. ⚠️ **That
  zero is a property of the instrument, not evidence** (Class 11).

**It cannot be settled by reading. It needs one live call.**

## 3. What to do

**Make the call. Read the answer. Record it. Stop.**

- **The credentials live in the `docai-ocr` edge function on LCC Opps** (`*.supabase.co` is blocked
  from the sandbox, so this runs where the function runs). The function currently sends **no
  `processOptions` at all**, so a selector must be threaded through for the probe.
- **Use a real over-cap document we already hold** — there are **42**, up to 141 pages. Pick one
  comfortably over 50 pages so the answer is unambiguous.
- **Run both arms, because one result alone is not an answer:**
  1. `individualPageSelector {pages: [31..45]}`, **no** imageless — 15 pages, base limit.
  2. **A positive control:** `fromStart: 15`, no imageless, on the **same document**. This must
     SUCCEED. ⚠️ **If it fails too, the selector is being ignored or misplaced and arm 1's failure
     means nothing** — that is the DOC8 silent-no-op shape, and without this control you cannot tell
     "not allowed" from "not read."
- **Report the exact error body on any failure**, including `details[].metadata` — DOC8's
  `{page_limit, pages}` is what made that diagnosis possible.

⚠️ **Keep the probe reversible and out of the live path.** Do not change `ocrCloudCheap`'s behaviour
for the drain, do not alter `CRE_OCR_PAGE_CAP`, and do not leave a `processOptions` field being sent
on the normal path. **42 documents are currently marked and stable; nothing should move.**

## 4. What the answer decides

| result | consequence |
|---|---|
| **arm 1 SUCCEEDS** | 🟢 **A multi-call sync route reaches ~50 pages with NO GCS, NO IAM, no new vendor surface and no confidentiality decision.** Roughly 1–30 imageless + 31–45 + 46–50 base. Write it up as DOC18. |
| **arm 1 FAILS, control succeeds** | 🔴 The cap is measured against the document total. **Sync tops out at 30 pages. Fall back to DOC14** — and Scott's GCS/confidentiality decision becomes genuinely necessary, ⚠️ **now with the honest alternative priced: 30 pages captures ~60% of the consumer's window.** |
| **both fail** | ⚠️ The selector is not being read. **Fix the placement and re-run** — do not conclude anything about limits. |

## 5. ⚠️ What this must NOT do

- **Do not build the extraction lane**, whichever way it falls. This prompt's deliverable is a
  measured fact and a recommendation.
- **Do not fall back to gpt-4o** under any outcome (9.3× less text, measured).
- **Do not weaken or remove the `over_docai_page_cap` marker.** It is the correct state today.
- ⚠️ **Do not infer the selector's placement from the repo's `imagelessMode` comment** — that is a
  different field, and DOC16 already established the correct placement from the schema.
- **Do not read a single failure as the answer** without the positive control (§3).

## 6. Report back

- **The two arms' results, with exact error bodies and `details[].metadata`.**
- **Which row of §4 fired, and the recommendation that follows.**
- ⚠️ **If the answer is "document total": say plainly that sync caps at 30 pages and that ~40% of the
  consumer's window is unreachable without GCS.** That is the number Scott needs to weigh his
  decision against, and it should not be softened.
