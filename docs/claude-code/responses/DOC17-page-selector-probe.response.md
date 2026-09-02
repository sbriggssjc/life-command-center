# DOC17 — response: the cap is measured against the SELECTION. Arm 1 SUCCEEDED.

**Date:** 2026-09-02 · **Outcome:** 🟢 **§4 row 1 — a multi-call sync route needs NO GCS** ·
**Nothing was built. Nothing moved. `docai-ocr` is byte-identical.**

---

## 1. The answer

**For a page selection that does NOT start at page 1, Document AI's synchronous page limit is
measured against the SELECTION, not the document total.**

Measured on a **316-page** PDF: `individualPageSelector { pages: [31..45] }` returned **HTTP 200
with pages 31–45 and 65,297 characters.** The positive control (`fromStart: 15`, same document,
same request) also succeeded. Both arms passing is what makes the result an answer rather than a
coincidence — a single success proves nothing about a selector that might have been ignored, which
is why the **page NUMBERS** are the evidence and not the page count.

⚠️ **And the refinement is the engineering number, not a footnote.** Two further arms establish that
the *size* of that selection depends on where it starts:

| # | selection | imageless | result |
|---|---|---|---|
| 0 | whole document, **no selector** | off | ❌ `Document pages exceed the limit: 30 got 316` · `{page_limit:"30", pages:"316"}` |
| **1** | **pages 31–45 (15 pp)** | **off** | ✅ **200 · pages `[31..45]` · 65,297 chars · 10.2 s** |
| **2** | **`fromStart: 15` — POSITIVE CONTROL** | **off** | ✅ **200 · pages `[1..15]` · 64,747 chars · 19.3 s** |
| 3 | pages 31–61 (31 pp) | off | ❌ `Document pages exceed the limit: 30 got 31` · `{page_limit:"30", pages:"31"}` |
| 4 | pages 31–60 (30 pp) | off | ❌ `Document pages **in non-imageless mode** exceed the limit: **15** got 30. Try using imageless mode…` · `{page_limit:"30", pages:"30"}` |
| 5 | pages 31–60 (30 pp) | **on** | ❌ **`At most 15 pages in one call please.`** — no `details[]`, no metadata |
| 6 | `fromStart: 30` | on | ✅ 200 · pages `[1..30]` · 151,776 chars |

**So: 30 pages per call contiguously from page 1 (imageless), 15 pages per call anywhere else.**
Row 5 is Google's Limits sentence — *"only applicable when processing pages contiguously starting
from page 1"* — confirmed behaviourally, on a third error string nobody had seen.

**Row 3 is what settles §2.** A 31-page selection out of a 316-page document is refused for being
**31**, not for being part of 316. The document total never enters the arithmetic.

## 2. What this decides (§4)

**🟢 Row 1 fires.** A multi-call sync route reaches the consumer's whole ~50-page window with **no
GCS bucket, no IAM, no service-agent grant, no lifecycle rule, no LRO job table, and no new
data-at-rest exposure** — the confidentiality decision DOC14 needs does not have to be made.

For a 50-page window: **3 calls** — `fromStart:30` (imageless) + `[31..45]` + `[46..50]`.
For the deepest document we hold (141 pages): **1 + 8 = 9 calls.** Per-page cost is unchanged
(~$1.50/1k pages), so a 141-page lease costs about **21 cents** and the whole 42-document backlog
(2,182 pages) is roughly **$3.30**. That is the entire price of the thing DOC14 wanted a GCS build for.

⚠️ **DOC16's refutation was correct and is now only half the story.** Its call 2 (pages 31–50) *is*
available — just at 15 pages per call rather than 30, so the design needs three calls where it
assumed two. The refutation stands on its own terms; the *consequence* does not.

⚠️ **The 60%-of-window loss quoted in the DOC16 GATE is no longer the alternative to a GCS build.**
It was the honest number for a one-call route. It should not be carried into Scott's decision.

## 3. Traps found on the way — all four are things the next build will hit

- **⚠️ `metadata.page_limit` REPORTS THE MAXIMUM ACHIEVABLE LIMIT, NOT THE ONE IN FORCE.** Row 4
  fails because the applicable limit is **15**, and its structured metadata says **`page_limit:
  "30"`**. `pageLimitFromError` prefers the structured field over the prose *by design* (DOC8:
  *"a detector keyed only on wording is one Google copy-edit away"*) — and here the structured field
  is the one that misleads. **Both are true statements about different things**; a caller that acts
  on `page_limit` alone will retry a 30-page selection forever.
- **⚠️ ROW 5 RETURNS NO `details[]` AT ALL**, so `pageLimitFromError` yields `{limit:null, got:null}`
  — the prose fallback misses too (`At most 15 pages in one call please.` matches neither
  `exceed the limit: N got M` nor `got N`). **A third error shape exists and both halves of the
  existing parser are blind to it.** Harmless today (the live path sends no selector, so it can
  never produce this error) and load-bearing for DOC18.
- **⚠️ THE BASE LIMIT IS 15, AND THE BASELINE ARM SAID 30.** Row 0, with imageless OFF, reports
  `page_limit: 30`. Reading only that arm — the obvious single measurement — would have concluded
  the base cap had moved to 30 and produced a route that fails on every non-page-1 call. It took
  row 4 to show the base is still 15. **One error's metadata is not a limits table.**
- **⚠️ `docai-ocr` RESOLVES ONE SHARED SECRET WITH `||`, SO THE FIRST ENV VAR SET SHADOWS THE
  OTHERS.** The probe's first call 401'd holding a perfectly valid key: two of the three secrets are
  set on this project and `lcc_cron_post(..., 'edge')` sends the third. Not a defect in the live
  path (Railway sends the one it holds), but it makes the function unreachable from pg_net, which is
  the only channel a sandbox has.

## 4. How it was measured, and the one honest gap

**The probe is `supabase/functions/docai-page-probe` — a SEPARATE edge function, deployed to LCC
Opps (v3).** `docai-ocr` was not touched, still sends no `processOptions`, and its behaviour for the
drain is unchanged. The probe **writes nothing** — its only three POSTs are Google's OAuth token
endpoint, the PA fetch flow, and DocAI `:process`; there is no PostgREST or storage write anywhere
in it. Nothing calls it: no cron row, no caller in `api/`. It follows the `docai-diag` precedent
(a one-off diagnostic, later neutered to a 410 stub) and can be neutered the same way.

⚠️ **THE PROBE DOCUMENT IS NOT ONE OF THE 42, AND THAT IS A REAL LIMITATION — STATED, NOT GLOSSED.**
All 42 `over_docai_page_cap` documents are SharePoint server-relative refs fetched through the
Power Automate "Get Artifact" flow, and **`SHAREPOINT_FETCH_URL` is a Railway env var, not a
Supabase edge secret** — the probe's own health check reports `sharepoint_fetch_url: false`. So the
bytes of those 42 are not reachable from where the credentials live. The probe used a **real
316-page document we hold** out of LCC Opps storage instead (an SEC filing, `lcc-om-uploads`), and
its page count was **established by the baseline arm rather than assumed**. What the question needs
is a document comfortably over 50 pages, which this is by a factor of six; nothing in the answer
depends on which document it was. **If someone wants the arms re-run against document 319 (the
141-page CVS lease), set `SHAREPOINT_FETCH_URL` as a Supabase secret and POST
`{"document_id":319, "arms":[…]}` — that path is already written and returns an honest
`SHAREPOINT_FETCH_URL unset` today rather than a silent empty result.**

**Transport:** the sandbox cannot reach `*.supabase.co` (`http=000`) or Railway, so every call went
`lcc_cron_post(endpoint, body, 'edge')` → `pg_net` → `net._http_response`. ⚠️ **A 30-page arm takes
longer than pg_net's 60 s and the response still landed** — read the response body, never the
caller's patience (P123).

## 5. Nothing moved

`over_docai_page_cap` **42** · 31–50 pp **18** · >50 pp **24** · max **141** — identical to the
figure in the CURRENT STATE block. `CRE_OCR_PAGE_CAP` untouched, the marker untouched, no
`processOptions` on the normal path. The 15 sidecar rows written during the window are the live
30-minute drain (11:30 / 12:00 / 12:30 / 13:00, crons 167/169) doing its ordinary work — the probe
has no code path that could have written any of them.

**Spend:** 5 arms reached the processor, 3 of them succeeded — 15 + 15 + 30 = **60 pages ≈ $0.09**.
The four failing arms processed nothing.

## 6. Recommendation

**Write DOC18: the three-call sync route.** `1–30` imageless + `31–45` + `46–50`, concatenated into
one `raw_text`, replacing the `over_docai_page_cap` marker for all 42 documents. It needs no GCS, no
new vendor surface and no confidentiality decision, and it is priced at about $3.30 for the whole
backlog.

**DOC14 should be closed rather than unblocked** — but not on this response's say-so. It is Scott's
call, and the input he needs has changed: the choice is no longer *"a GCS build or lose 40% of the
window"*, it is *"a GCS build or nine cheap sync calls"*.

⚠️ **Two things DOC18 must carry, both measured here:** the parser cannot read row 5's error at all,
and `metadata.page_limit` must not be used to size a retry. Neither is a defect in what runs today.
