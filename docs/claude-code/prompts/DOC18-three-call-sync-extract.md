# DOC18 — the three-call sync route: reach the consumer's whole window, with no GCS

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — the CURRENT STATE block and
the **DOC17 PROBE** entry (it measured every number below) · the DOC17 response in
`docs/claude-code/responses/DOC17-page-selector-probe.response.md` — **§3's four traps are what this
build will hit** · `CLAUDE.md` on the DocAI footguns.

---

## 1. The measured contract — this is settled, do not re-verify it

DOC17 probed a real **316-page** document through `docai-ocr`'s credentials. Seven arms:

| selection | imageless | result |
|---|---|---|
| whole document, no selector | off | ❌ `30 got 316` |
| **`[31..45]` — 15 pp** | off | ✅ **200 · pages `[31..45]` · 65,297 chars** |
| **`fromStart:15` — positive control** | off | ✅ **200 · pages `[1..15]`** |
| `[31..61]` — 31 pp | off | ❌ `30 got 31` — **refused for being 31, not for being part of 316** |
| `[31..60]` — 30 pp | off | ❌ `non-imageless mode exceed the limit: **15** got 30` |
| `[31..60]` — 30 pp | **on** | ❌ **`At most 15 pages in one call please.`** |
| `fromStart:30` | on | ✅ 200 · pages `[1..30]` · 151,776 chars |

**THE RULE: 30 pages per call contiguously from page 1 (imageless); 15 pages per call anywhere
else.** The document's total page count never enters the arithmetic.

**So a 50-page window is 3 calls:** `fromStart:30` (imageless) + `[31..45]` + `[46..50]`.
**Our deepest document (141 pp) is 9 calls.** At ~$1.50/1k pages (⚠️ **still the repo's carried rate,
unverified**) that is **~21¢ for the 141-page lease and ~$3.30 for the whole 42-document backlog.**

## 2. What to build

**Replace `over_docai_page_cap` with a multi-call sync extract**, concatenating the ranges **in page
order** into one contiguous `raw_text`.

- **Target the consumer's window, not the document.** `bov-extract.js:147` slices at **90,000 chars**
  and our corpus runs **~1,800 chars/page**, so **~50 pages is the whole useful window.** Extracting
  beyond it costs money and buys nothing. ⚠️ **Make the page target a named constant, not a literal
  50** — it is derived from the consumer's slice and must move if that slice moves.
- **Reuse the existing sync path** (`ocrCloudCheap` → `docai-ocr`). ⚠️ **`ocrCloudCheap` accepts only
  `{buffer, mediaType, fetchImpl}` and the edge handler reads only `content_base64`/`mime_type` — a
  page-range parameter must be threaded through BOTH, and an extra body field is currently ignored
  SILENTLY.**
- **Mark the result honestly.** A 141-page lease extracted to page 50 is a **partial**. Record the
  page range covered and the document's true page count. ⚠️ **This is a THIRD state — complete for
  the consumer, incomplete for the document.** It must **not** be a ceiling marker and must **not**
  re-admit forever.
- **Idempotency:** a partially-completed multi-call extract must not restart from call 1 on every
  tick, and must not double-charge. ⚠️ **9 calls per document against a 22 s tick budget will not fit
  in one tick** — decide deliberately whether a document spans ticks or gets its own budget, and say
  which you chose.

## 3. ⚠️ The four traps DOC17 measured — all four will bite this build

1. **`metadata.page_limit` REPORTS THE MAXIMUM ACHIEVABLE LIMIT, NOT THE ONE IN FORCE.** The 30-page
   non-imageless failure returns `page_limit: "30"` while the applicable limit is **15**.
   ⚠️ **`pageLimitFromError` prefers the structured field over the prose BY DESIGN (DOC8), and here
   the structured field is the misleading one.** A caller that sizes a retry from it **retries a
   30-page selection forever.**
2. **The `At most 15 pages in one call please.` shape carries NO `details[]` at all**, so
   `pageLimitFromError` returns `{limit:null, got:null}` — **and the prose fallback misses it too**
   (it matches neither `exceed the limit: N got M` nor `got N`). **A third error shape exists and
   both halves of the parser are blind to it.** Harmless today; **load-bearing here.**
3. **The base limit is 15, and the baseline arm reported 30.** Reading only that arm — the obvious
   single measurement — concludes the base cap is 30 and produces a route that fails on **every**
   non-page-1 call. ⚠️ **One error's metadata is not a limits table.**
4. **`docai-ocr` resolves one shared secret with `||`, so the first env var set SHADOWS the others.**
   DOC17's first call 401'd holding a valid key. Not a defect in the live path (Railway sends the one
   it holds) but it makes the function unreachable from `pg_net` — **which is the only channel a
   sandbox has.** Expect it if you probe from SQL.

## 4. ⚠️ What this must NOT do

- ⛔ **Never fall back to gpt-4o** — measured at 9.3× less text.
- **Do not build GCS, batch, or an LRO lane.** That is DOC14, and this route exists to make it
  unnecessary. ⚠️ **Do not touch `docai-ocr`'s behaviour for the ordinary drain** — under-cap
  documents must keep working exactly as they do (100% DocAI, zero gpt-4o, 22+ events).
- **Do not remove the `over_docai_page_cap` marker until the replacement is proven** on real
  documents; it is the correct state for anything this route cannot reach.
- ⚠️ **Do not extract past the consumer's window "for completeness."** It costs money per page and
  `extractTenantFromLease` discards it.
- **Do not re-verify §1.** It is measured; spend the effort on §3 instead.

## 5. ⚠️ The honest ceiling — record it, do not let it read as complete

**Pages beyond ~50 are still not captured.** The `abstract` block asks for **renewal options, early
termination, default cure, holdover and key lease risks** — clauses that routinely sit in the **back
half of a long lease**. For a 141-page document, pages 51–141 remain unread.

**That is a real and permanent limitation of this route**, and it is acceptable only because the
consumer truncates at 90,000 chars anyway. ⚠️ **If a future consumer reads more than that, this
ceiling becomes a defect — say so on the row**, and never let a partial-extract row count as complete
coverage in `bov_ready` or any other honest-count surface.

## 6. Predicted deltas

| | today | expected |
|---|---:|---:|
| `over_docai_page_cap` rows | **42** | **→ ~0, converted to partial extracts** |
| leases with usable text | — | **+42, growing as the backlog drains** |
| gpt-4o OCR events | **0** | **0 — unchanged** |
| GCS buckets / IAM / vendor surface | **0** | **0 — the entire point** |
| `bov_ready` | **39** | rises |
| under-cap drain behaviour | 100% DocAI | **unchanged** |

## 7. Report back

- **`char_len` for the first converted long leases**, and ⚠️ **read 3 of them AT THE PAGE-30 AND
  PAGE-45 BOUNDARIES** to confirm the ranges concatenate with **no duplication and no gap**. A
  plausible total length is not evidence the seams are clean.
- **Which of §3's four traps actually fired**, and how each was handled.
- **The tick-budget decision** (§2) and what a partially-extracted document looks like between ticks.
- **Measured cost** for the first few documents against the ~$3.30 estimate.
- The residual: **how many documents still exceed the window**, so the ceiling is sized not assumed.
