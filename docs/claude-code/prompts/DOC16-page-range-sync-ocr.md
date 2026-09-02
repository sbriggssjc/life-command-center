# DOC16 — process long leases by PAGE RANGE on the sync path, and skip GCS entirely

> ⛔ **CLOSED 2026-09-02 — REFUTED AT ITS OWN §2 GATE. DO NOT EXECUTE THIS PROMPT.**
> The page selector exists on the sync path exactly as §2 hoped (`processOptions.individualPageSelector`
> / `fromStart` / `fromEnd`, verified against the live v1 discovery document, revision `20260820`).
> **But the 30-page imageless cap is "only applicable when processing pages contiguously starting from
> page 1"**, so §3's second call — pages 31–50 — cannot claim it. That call is the whole argument;
> without it the route yields ~30 pages ≈ 54,000 chars against a 90,000-char consumer window, and §4's
> "lossless on the consumer's terms" claim fails. **Neither §2 branch fired: the cap is not measured
> against the document total, and it is not measured against an arbitrary selection either.**
> Full reading, the one question left unmeasured, and why it was not guessed at:
> `docs/architecture/document-capture-ocr-and-deeds.md` → **DOC16 GATE**.
> **DOC14 is the route again.** Population re-measured: **42 rows (not 40), 18 at 31–50pp, 24 at >50pp.**

> ⛔ **This SUPERSEDES `DOC14-long-lease-ocr-async.md` as the next step.** DOC14 is not wrong — it is
> **blocked on a confidentiality decision that this route makes unnecessary.** Keep it staged; if
> DOC16's premise fails verification (§2), DOC14 is the fallback.

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — the CURRENT STATE block and
the DOC14 entry · the DOC14 response in `docs/claude-code/responses/` (it verified the batch contract
and found the prerequisite gap) · `CLAUDE.md` on the DocAI footguns.

---

## 1. Why the expensive route is probably unnecessary

**`bov-extract.js:147` slices lease text at 90,000 characters before prompting:**

```js
String(leaseText || '').slice(0, 90_000),
```

**Measured on our own corpus: 1,799 chars/page average (median 1,727) → 90,000 chars ≈ 50 pages.**
So **the consumer never reads past roughly page 50 of any lease, no matter how it was extracted.**

**Against the 40 documents currently marked `over_docai_page_cap`:**

| band | docs | pages | what a FULL extract buys the consumer |
|---|---:|---|---|
| **31–50pp** | **16** | 31–49 (avg 39) | all of it — genuinely used |
| **51+pp** | **24** | 51–141 (avg 63) | ⚠️ **nothing past ~page 50 — the consumer discards it** |

⚠️ **So for 60% of the population, the GCS batch build — an input bucket AND an output bucket, IAM,
a Document AI service-agent grant, a lifecycle rule, an upload path for every SharePoint byte-stream,
an LRO job table, and a decision to persist confidential client lease text in cloud storage —
delivers text that `extractTenantFromLease` throws away.**

**And the confidentiality delta is narrower than it first appeared.** ⚠️ **Google DocAI ALREADY
receives the complete PDF bytes today** — `document-text.js:262` sends
`content_base64: Buffer.from(buffer).toString('base64')` of the whole file, and the deployed
`docai-ocr` v24 passes it straight through as `rawDocument`. **Every under-cap lease has already been
sent to Google in full.** What batch adds is **persistence at rest in a GCS bucket** — a real
decision, but a different and narrower one than "should Google see our leases."

## 2. ⚠️ VERIFY THIS FIRST — the whole prompt rests on one unverified assumption

**Does DocAI's synchronous `process` accept a page selector, and does the selection count against the
30-page imageless cap, or does the cap apply to the document's total page count?**

- **Read the live v1 discovery document** — `https://documentai.googleapis.com/$discovery/rest?version=v1`.
  Look for `ProcessOptions`, `individualPageSelector`, `pageRange`, `fromStart`, `fromEnd`.
- ⚠️ **The repo currently sends NO `processOptions` at all** (verified: `docai-ocr/index.ts:286-291`
  sends only `skipHumanReview`, `rawDocument`, and the top-level `imagelessMode`). There is a comment
  there explicitly noting `imagelessMode` is top-level and **not** under `processOptions.ocrConfig` —
  ⚠️ **that comment is about a DIFFERENT field and is NOT evidence about where a page selector goes.
  Do not reason from it.**
- **If the cap applies to the document's TOTAL pages regardless of selector, STOP.** Say so plainly
  and hand back to DOC14. **A page selector that does not lift the cap makes this route impossible**,
  and that is a legitimate outcome for this prompt.

**DOC8's lesson applies exactly here:** `imagelessMode` turned out to be a **top-level boolean**, and
a plausible-looking nesting would have been a **silent no-op**. **Read the schema; do not infer the
shape from this prompt.**

## 3. What to build, if §2 verifies

**Two sync calls per over-cap document — pages 1–30 and 31–50 — concatenated in order into one
`raw_text`.** That yields ~50 pages ≈ 90,000 characters: **exactly what the consumer can use, for
every document in the population, with no GCS and no new data-at-rest exposure.**

⚠️ **THIS IS NOT THE "CHUNKING" DOC14's §6 FORBADE, and the distinction is the point.** That warning
was against splitting the *analysis* — running `extractTenantFromLease` over pieces and reassembling
its answers, which changes what the model reasons over. **This chunks the OCR CALL and produces one
contiguous text.** The consumer sees a single `raw_text` byte-identical in structure to what a full
extract would have given it, truncated at the same 90,000 chars it truncates at anyway.

- **Reuse the existing sync path** (`ocrCloudCheap` → `docai-ocr`). No new worker, no new lane, no
  job table, no LRO.
- **`ocrCloudCheap` accepts only `{buffer, mediaType, fetchImpl}`** and the edge handler reads only
  `content_base64`/`mime_type` — **both need a page-range parameter threaded through.** An extra body
  field is currently **ignored silently** by the edge function.
- **Mark the result honestly.** A 141-page lease extracted to page 50 is a **partial**, and the row
  must say so — a new reason/flag such as `partial_extract_page_capped`, with the page range recorded.
  ⚠️ **It must NOT count as a ceiling marker and must NOT re-admit forever**: it is *complete for the
  consumer's purposes*, which is a third state distinct from both "done" and "needs retry."
- **Cost check:** at ~$1.50/1k pages (⚠️ **the repo's carried rate, still unverified**) this is
  ~2,000 pages ≈ **$3** for the population — the same order as batch, so cost decides nothing.

## 4. ⚠️ The honest cost of this route — state it, do not bury it

**The 24 documents over 50 pages lose nothing the consumer would have read.** **The 16 documents at
31–50 pages lose pages 51+ only if they have them — they do not.** So on the *consumer's* terms this
is lossless.

⚠️ **But `raw_text` is not only read by `extractTenantFromLease`.** The `abstract` block asks for
**renewal options, early termination, default cure, holdover and key lease risks** — clauses that
routinely sit in the **back half of a long lease**. For a 141-page document, pages 51–141 are simply
not captured, and **a future consumer that reads more than 90,000 chars would find them missing.**
**Record that as a known ceiling on the row**, and do not let a `partial_extract` row read as
complete coverage in any count.

## 5. Predicted deltas

| | today | expected |
|---|---:|---:|
| `over_docai_page_cap` rows | **40** | **→ 0, converted to partial extracts** |
| leases with usable text | — | **+40, and ~87 as the backlog drains** |
| gpt-4o OCR events | 0 | **0 — unchanged** |
| GCS buckets / IAM / new vendor surface | 0 | **0 — the point of this route** |
| `bov_ready` | **37** | rises |

## 6. Report back

- **The page-selector contract as READ from the discovery document**, and — decisively — **whether
  the 30-page cap applies to the selection or to the document total.**
- If it applies to the total: **stop, say so, and hand back to DOC14.**
- **`char_len` for the first converted long leases**, and ⚠️ **read 3 of them at the page-30 boundary**
  to confirm the two ranges concatenate cleanly with no duplication or gap.
- The count of documents where 50 pages still truncates below their real length, so the residual
  ceiling is sized rather than assumed.
