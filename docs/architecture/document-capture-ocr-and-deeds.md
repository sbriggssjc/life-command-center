# Document capture, OCR and deeds — THE canonical page

> 📍 **ONE door into a topic that has been rediscovered at least five times.** Capture → storage →
> OCR → consumption, what is built, what is running, what blocks it, and the honest ceilings.
>
> **Supersedes as the entry point:** `document-capture-and-ocr-status.md` (kept — it is the
> 2026-08-12 narrative and the DocAI runbook, but its top is four nested "superseded" boxes) ·
> `UW6_REV_document_byte_capture.md` (the design) ·
> `audit/data-flow-2026-05-30/AUDIT_document_intelligence_2026-06-20.md` (the original inventory) ·
> `CLAUDECODE_PROMPT_deed_capture_at_ingestion.md` (the fix prompt).
>
> **Live-verified 2026-08-31; §0 blocker FIXED and re-measured 2026-09-01 (DOC1); the spend
> escalation and the covered-fragment defect FIXED 2026-09-01 (DOC8 / DOC9 / DOC10 — §0d).
> DOC14 (the 31–59 page leases that get NO text) is 🛑 **BLOCKED on an operator prerequisite** —
> the async contract is verified, the GCS buckets and their IAM do not exist, and nothing was
> built. Read the DOC14 BLOCKED section before proposing anything about long-document OCR.**
>
> ⚠️ **Every number on this page is dated. Before quoting one, run §7b — the standing status check,
> with its 2026-09-01 baseline.**

---

## CURRENT STATE — read these ten lines first, then §0 for how we got here

**Measured live 2026-09-02 11:39 UTC.** ⚠️ §0 below is a dated worklog; **this block is the truth.**

| | |
|---|---|
| **domain store (deeds)** | ✅ **325/325 text — 100%, complete.** Cron 160, `doctype=deed`. ⛔ **Do NOT widen it** (DOC7). |
| **CRE registry drain** | undrained **771 → 426**, sidecar **345**, `scan_lowest_id` **2** — reaches the oldest document. |
| **consumer** | **`bov_ready` 5 → 37.** BOV extract is receiving real leases, DDs and OMs. |
| **OCR tier** | ✅ **22+ events since redeploy, 100% DocAI, ZERO gpt-4o.** The 9.3×-worse escalation is closed. |
| **🔴 the live gap** | **40 documents carry `over_docai_page_cap` and get NO text at all** — DOC14, blocked on an operator prerequisite. |
| **retry markers** | 17 (`thin_ocr_result` 14, `fetch_failed` 3). `retry_admitted` is **0 and that is correct** — see DOC13 below. |

**Open, in priority order: DOC14** (blocked on Scott — GCS + a confidentiality decision) ·
**DOC13-watch** (retry starvation, benign today) · **DOC2** (cross-repo stale docs) · **DOC3**
(gov firm-term chain not wired) · **DOC4/5/6**.

---

## 0. ⚠️ THE HEADLINE — a green cron returned `eligible: 0` over 695 waiting documents (FIXED, DOC1)

**There are TWO document stores, in two databases, with two workers. Conflating them is why this
topic keeps getting rediscovered.**

| | **domain store** | **CRE registry store** |
|---|---|---|
| table | `property_documents` (gov + dia domain DBs) | `lcc_cre_property_documents` (LCC Opps) |
| worker | **cron 160** `lcc-document-text-deeds` | **crons 167/169** `lcc-cre-doc-text-*` |
| has a bytes column? | ✅ `storage_path` + `storage_bucket` | ❌ **none — `source_url` only** |
| doctypes drained | `deed` only | `lease, dd, om` |
| **downstream consumer** | deed parser → BD spine | **BOV extract** → tenant/DD/OM |
| state | **deeds 325/325 text — 100% ✅** | **76 of 771 — the jam is FIXED, the backlog drains from 06-01** |

### ⚠️ The blocker, found AND fixed 2026-09-01 — `fetchEligibleCreDocs` had a fixed window and no cursor

**The code as it stood** (`api/_shared/cre-property-doc-text.js`, pre-DOC1):

```js
const reg = await q('GET', `lcc_cre_property_documents?...&order=id.desc&limit=${cap * 4}`);  // newest 60
const side = ...;                                    // which of THOSE 60 already have a sidecar
const rows = reg.data.filter((r) => !done.has(r.id)).slice(0, cap);
```

**It only ever looked at the newest 60 rows.** Measured live: **`newest60_already_done = 60`.** So the
diff was empty, `eligible` was **0**, and it would have been 0 forever — while **695 documents (ids 2
→ 2317) sat permanently unreachable.** Live cron responses, every 30 minutes, HTTP **200**:

```
{"mode":"eligible","doctype":"lease,dd,om","limit":15,"scanned":0,"eligible":0,"items":[]}
```

⚠️ **This was Dead-End Playbook Class 12 for the THIRD time** — P135 (property-twin, fixed window),
P136 (reachability harvest, re-checking the same 120 nightly), and now this. **Same signature every
time: green cron, honest-looking zero counters, nothing moving.**

⚠️ **And these are SharePoint paths, not CoStar** — `/sites/TeamBriggs20/Shared Documents/…`,
**100% of 1,066 rows**. They do **not** expire, are **not** session-bound, and need **no** residential
egress. **They are fetchable today.** The CoStar token problem does not apply to this store at all.

⚠️ **Re-measured before the fix, 2026-09-01: 771 / 76 / 695, ids 2 → 2317, `newest60_done = 60` —
identical to the diagnosis, and 100% SharePoint server-relative on BOTH halves** (undrained 416
lease / 235 dd / 44 om, ids 2 → 1118). So the undrained set is structurally the same kind of
document as the drained set; nothing about it made it unfetchable.

### ✅ The fix — an ascending keyset walk with a page budget, and a negative marker

`fetchEligibleCreDocs` now walks the registry **oldest-first** (`order=id.asc`) on a keyset cursor
(`id=gt.<last id seen>`, 200 rows/page, budget 12 pages ≈ 2,400 rows/tick against a 771-row
population), stopping as soon as it has `limit` rows. It returns `scan_pages` / `scan_rows` /
**`scan_capped`** / `scan_exhausted` / `scan_lowest_id` / `retry_admitted`, all surfaced on the tick.

- ⚠️ **`cap * 4` was NOT simply raised, deliberately.** A bigger constant moves the jam to row N+1
  and makes it more expensive to see — P136's explicit finding, and the third time this class has
  been met (P135 fixed window, P136 same-120-nightly).
- ⚠️ **THE §2 SELF-EXCLUSION PREMISE WAS HALF TRUE, AND THE OTHER HALF WOULD HAVE JAMMED
  OLDEST-FIRST ON ROW ONE.** The sidecar's `ocr_non_ok` / `over_ocr_cap` / `thin_ocr_result` rows do
  prove that *post-fetch* failures persist a row and self-exclude. They say nothing about the
  *pre-fetch* case, and **`extractDocumentText` has exactly ONE `ok:false` return — `fetch_failed`
  (`document-text.js:361`)** — which `runPropertyDocText` returned on **without writing anything**.
  Live confirmation of the mechanism: **zero `fetch_failed` rows have ever existed in the sidecar.**
  Since all 771 documents are SharePoint refs fetched through the PA flow, one unset
  `SHAREPOINT_FETCH_URL` would have parked the whole lane on the oldest document, forever.
  **Reading the table would have "confirmed" safety; reading the code path refuted it.**
- **So a fetch failure (and an extraction throw) now writes a DATED negative marker** —
  `needs_ocr = true`, `raw_text = null`, `reason = 'fetch_failed' | 'extract_error'`. It is invisible
  to **both** consumers (`gatherPropertyText` filters `needs_ocr=is.false&raw_text=not.is.null`;
  `v_lcc_cre_bov_ready` counts a doc covered only `AND NOT t.needs_ocr`), and **deliberately not
  terminal**: the scan re-admits it after `CRE_DOC_TEXT_RETRY_AFTER_HOURS` (24 h). Each retry
  refreshes `extracted_at`, which is what makes the cursor ADVANCE instead of re-trying the same head
  every 30 minutes. The `mode=jobs` lane is unaffected — `sidecarStatus` short-circuits only on
  `done`, so a marker row still re-extracts on demand.
- **The sidecar probe now FAILS CLOSED.** It previously treated an errored probe as *"nothing is
  done"* and handed every row to the drain — harmless behind a 60-row window, a re-OCR bill across a
  full-population scan. There is no spend guard that halts a tick; an unreadable probe must stop the
  scan, not widen it.
- **The `reason` column carries the marker kind only; the underlying `detail` rides the tick response
  and the cron's stored HTTP body.** A stated limitation, not an oversight — an exact `reason` is
  what lets the re-admission predicate be a set membership rather than a `like` pattern.
- Guard: `test/cre-doc-text-window-jam.test.mjs` (15 tests, **11 of 11 mutations verified RED**:
  descending order, keyset removed, `scan_capped` hard-coded false, either marker removed, the
  clobber guard removed, expiry removed, the retry-reason filter removed, the probe failing open, a
  page size above the PostgREST cap, and a reference to the domain store). Source assertions **strip
  comments first** — the fix's own prose names `id.desc` and `fetch_failed` repeatedly, so a raw
  grep would pass over the regression it exists to catch (the A5c / N18 / B1 lesson).

### 🟠 POST-DOC1 RE-MEASURE, 2026-09-01 15:15 UTC — the escalation pays 6–14× MORE for ~10× LESS (CAUSE FIXED, §0d)

DOC1's writeup called its spend finding *"sample size is one OCR row — mechanism confirmed, rate not."*
**Measured across every OCR row the lane has ever produced, the rate is 86% and the output is worse:**

| tier | rows | avg chars | **under 500 chars** | `thin_ocr_result` |
|---|---:|---:|---:|---:|
| **`cloud` (gpt-4o)** | **19** | **1,579** | **12 (63%)** | 5 |
| `cloud_cheap` (DocAI) | 3 | **14,687** | **0** | 0 |

**DocAI returns 9.3× more text than gpt-4o on this corpus** (min 11,723 chars vs a gpt-4o minimum of
**31**). This is not a marginal quality difference on a premium tier — **the expensive path is
failing**, and DOC8 explains why: DocAI 502s on `PAGE_LIMIT_EXCEEDED` above 15 sync pages, every
long document falls through, and gpt-4o returns a fragment.

**By doctype, all-time: lease 33 drained / 16 needed OCR (48%) — 14 gpt-4o vs 2 DocAI · dd 21 / 6
(29%) — 5 vs 1 · om 26 / 0.** ⚠️ **The undrained backlog is lease-heavy — 416 lease, 235 dd, 44 om
— so at the observed rates it carries roughly 200 more lease OCR events and ~57 dd, ~86% of which
route to the failing tier.** The 22 rows to date are a sample of the same population, not a
different one.

### 🟠 DOC10 — a 31-character "extraction" passed the consumer's filter and counted as COVERED (FIXED, §0d)

⚠️ **This is a correctness defect, not a cost one, and it is worse than failing.** `gatherPropertyText`
(`bov-extract.js:192-224`) admits on `needs_ocr=is.false&raw_text=not.is.null`, and
`v_lcc_cre_bov_ready` counts a document covered on `AND NOT t.needs_ocr`. **A 31-char gpt-4o
fragment satisfies both.** So 12 of 19 gpt-4o rows are handed to BOV extract as if they were the
lease, and the property reads *covered* — the document will never be retried, because nothing
distinguishes it from a real extraction.

**A thin OCR result on a multi-page document is not an extraction.** It should write DOC1's dated
negative marker (`needs_ocr = true`), which is invisible to both consumers and self-re-admits after
24 h — exactly the mechanism DOC1 already built. ⚠️ **`reason='thin_ocr_result'` is already being
SET on 5 of them and the consumers do not read it.** The label exists; nothing acts on it.

⚠️ **Fix DOC8 before DOC10's floor**, or the floor will correctly reject most long documents and the
backlog will park itself — the floor is only safe once the cheap tier can actually serve them.
✅ **That order was kept: DOC8's edge deploy landed first (15:50 UTC), then DOC9, then DOC10's floor
and backfill. §0d records what each one measured.**

### ✅ §0d — DOC8 / DOC9 / DOC10, shipped 2026-09-01 in that order (the order is load-bearing)

**DOC8 — the cheap tier's page ceiling, raised at the source.** `docai-ocr` now sets
**`imagelessMode: true`** on the ProcessRequest, which raises Google's SYNCHRONOUS cap **15 → 30**
pages on Enterprise Document OCR. **Deployed to LCC Opps as `docai-ocr` v23 at 15:50 UTC** — an edge
deploy, not a Railway one, so it is live independently of the PR.

- ⚠️ **The field was verified against the API, not taken from the brief.** `imagelessMode` is a
  **TOP-LEVEL boolean on ProcessRequest**, NOT under `processOptions.ocrConfig` — read from the live
  v1 discovery document (`documentai.googleapis.com/$discovery/rest?version=v1`, 2026-09-01):
  `GoogleCloudDocumentaiV1ProcessRequest.imagelessMode`, *"Optional. Option to remove images from the
  document."* `ProcessOptions` carries `ocrConfig`/`layoutConfig`/… and **no imageless field**, so
  nesting it there is a silent no-op that leaves the cap at 15. (A 2024 Ruby-client issue,
  googleapis/google-cloud-ruby#26951, reports the REST surface rejecting the field; it is present in
  v1 today, and the deploy carries a fallback for the case where a processor still refuses it.)
- **It suppresses the rendered page IMAGE only.** `Document.pages[].image` is a separate field from
  `pages[].layout` / `.tokens` / `.textAnchor`, which is everything `pageTextsFromDoc` (clause_ref
  page anchors) and `meanConfidence` read. Both are additionally wrapped so a shape surprise cannot
  turn a good OCR into a 502.
- **SAFE DEPLOY, not an assumption:** an INVALID_ARGUMENT body naming `imagelessMode` retries ONCE
  without it, so a processor that refuses the field degrades to today's behaviour instead of breaking
  every ≤15-page OCR. The detector is deliberately narrow — it must not swallow PAGE_LIMIT_EXCEEDED
  and re-bill a call that cannot succeed. `DOCAI_IMAGELESS_MODE=false` is the kill switch, and the
  GET health probe now reports `imageless_mode` + `page_cap` so the caller's pre-flight and the
  service can be checked against each other rather than assumed equal.
- **⚠️ 30 IS STILL A CAP, AND IT IS NOW A NAMED, DATED MARKER — never a silent fall-through.**
  `extractDocumentText` gained an opt-in `ocrPageCap`; above it the worker writes
  `reason='over_docai_page_cap'`, `needs_ocr=true`, `page_count=<n>` and **attempts no OCR at all**.
  The page count comes from a **pdf-parse pre-flight** (`pdfPageCountFromBuffer`), which works on a
  scanned PDF with no text layer — the only page count available before spending. This does **not**
  remove the gpt-4o tier: it stays the last resort everywhere under the cap where the cheap tier
  fails for any other reason. What it removes is the fall-through on the one class gpt-4o is
  *measured* to fail (avg 1,579 chars, 63% under 500, minimum 31), where the DOC10 floor would reject
  the fragment anyway.
  ⚠️ **The cap is OFF by default (`ocrPageCap: null`), so cron 160 and the deed lane are
  byte-identical.** Only the CRE worker opts in (`CRE_OCR_PAGE_CAP`, 30).
- **The over-cap marker is a CEILING, on the same mechanism with a different expiry.**
  `CRE_CEILING_RETRY_AFTER_HOURS` (720 h / 30 d) against the transient 24 h: re-admitting a
  known-unservable document every 30 minutes would park the 15-row batch on it forever, while never
  re-admitting it would make it a tombstone nobody revisits. Re-admission costs a byte fetch and a
  pdf-parse — **zero OCR spend**.
- ✅ **CONFIRMED LIVE ON THE FIRST POST-DEPLOY OCR EVENT, 2026-09-01 16:00:35 UTC — the processor
  ACCEPTS the field and the cap really did move.** Cron 167 reached document **24**
  (`ACMP EXEC Lease 10.9.14.pdf`) and `docai-ocr` v23 logged:

  ```
  [docai-ocr] Document AI 400 (processor=…/processors/5ecc6339861c88e1, imageless=true):
    "Document pages exceed the limit: 30 got 40"       reason: PAGE_LIMIT_EXCEEDED
    metadata { page_limit: "30", pages: "40" }
  ```

  **The limit Google reports is now 30, not 15**, and the phrase *"in non-imageless mode"* is gone —
  the imageless request was honoured, and the fallback did not fire. This is the deploy verified on
  behaviour rather than on a `/version`-style claim; the sandbox cannot reach
  `*.supabase.co` (proxy 403), so the edge log is the probe.
- ⚠️ **AND THE SAME LINE IS THE FIRST REAL 31+-PAGE OBSERVATION THIS LANE HAS EVER HAD: 40 pages.**
  It fell through to gpt-4o and returned **211 chars** — because the CALLER-side pre-flight is JS and
  had not shipped. That row is exactly the class `over_docai_page_cap` exists for, and (at 211 chars,
  under the 500 unknown-pages floor) it is also exactly the class DOC10 marks. **Both halves of the
  fix are correct and neither was deployed for it**, which is the honest reading.
- ⚠️ **HOW MUCH OF THE BACKLOG IS 31+ PAGES IS STILL NOT SIZED.** Neither store carries a page count:
  `lcc_cre_property_documents` has no size/pages column at all, and the sidecar's `page_count` is
  populated on 4 of 87 rows. Total page evidence that has ever existed: **8 observations** — six
  DocAI successes (1, 1, 5, 5, 6, 10), one over-cap at 19, one over-cap at **40**. **1 of 8 exceeds
  30, and it is the very first document the raised cap was tested on.** That is a sample of eight
  against a 406-lease / 235-dd backlog and a full original lease at 30+ pages is completely ordinary,
  so it is a reason to expect MORE, not a rate. What measures it: the tick's `over_page_cap` counter,
  `page_count` on every marker, and `v_lcc_cre_thin_ocr_watch`.
- **⚠️ THE ERROR'S WORDING HAS ALREADY CHANGED ONCE, SO THE PARSER READS THE STRUCTURED FIELD FIRST**
  (v24). Pre-DOC8 the message was *"…in non-imageless mode exceed the limit: 15 got 19"*; now it is
  *"Document pages exceed the limit: 30 got 40"*. `details[].metadata { page_limit, pages }` did not
  change (int64 → **string** in JSON). The prose regex stays as the fallback. **A detector keyed only
  on wording is one Google copy-edit away from silently returning null** — the same class as the
  P182 deparse trap.
  ⚠️ **DEPLOYED IS NOT EXERCISED: v24 has served no request yet.** The behavioural confirmation above
  is **v23**'s; v24 changes only `pageLimitFromError`, and no DocAI call has been made since it
  landed (`function_edge_logs` for `docai-ocr` is empty after 16:05 UTC). The next over-cap event is
  what proves it — read the tick's `page_count` on the `over_docai_page_cap` marker. Until then the
  claim is *"tested in the guard, deployed, unexercised"*, which is not the same as *"working"*.

**DOC9 — the spend counter was blind to the expensive path.** `bump()` accumulated only when
`ocr_pages > 0`, and gpt-4o returns no page count, so the 15:00 tick reported `ocr_by_engine: {}` and
`ocr_pages_total: 0` **while spending gpt-4o money**. The ENGINE is now counted **unconditionally**
(per document) and PAGES only when known.

- **⚠️ `ocr_by_engine` is REMOVED, not redefined.** It counted PAGES; reusing the name for a DOCUMENT
  count would silently change what every reader thinks it says. A reader of the old key now gets
  `undefined` — loud — instead of a plausible number meaning something else. Read
  **`ocr_docs_by_engine`** (documents), **`ocr_pages_by_engine`** / `ocr_pages_total` (priced pages)
  and **`ocr_pages_unknown`**.
- **⚠️ An unknown page count is NOT reported as 0** (P180). That is the whole defect: it zeroed
  exactly the tier being watched. `ocr_pages_total: 0` can no longer mean *"we OCR'd nothing"* when
  it means *"we could not price what we OCR'd."*
- **The same blindness is still live in `api/_handlers/document-text.js` and
  `api/_handlers/lease-backfill.js`** — identical `bump()` shape, other lanes. **Not fixed here**:
  `document-text.js` is the deed lane §5 says not to touch. Filed, named, not silently inherited.

**DOC10 — a thin OCR result no longer counts as COVERED.** The floor is **page-aware**:
`max(120, pages × 200)` when the page count is known, **500** meaningful chars when it is not. A thin
result now writes DOC1's dated marker (`needs_ocr = true`, `reason='thin_ocr_result'`), which is
invisible to both consumers and re-admits after 24 h.

- **The floor is keyed on what is actually available.** `page_count` is NULL on 79 of 80 sidecar rows
  and `ocr_pages` exists only once DocAI has already succeeded, so a rule keyed on either is inert
  precisely where it is needed. The forward path takes the count from the pdf-parse pre-flight; on
  the already-written rows there is none, which is why the **unknown-pages arm did all 12** of the
  repairs — measured, not assumed (all 19 gpt-4o rows carry NULL pages; all 6 DocAI rows clear the
  known-pages arm at 601–3,313 chars/page against a 200 floor).
- **500 sits inside a 3.9× gap the data actually has:** gpt-4o char_len runs
  31 · 44 · 44 · 48 · 49 · 68 · 116 · 163 · 186 · 187 · 188 · 200 — then jumps to 783 · 2,251 ·
  2,670 · 3,521 · 4,062 · 7,014 · 8,375. Nothing lands between 200 and 783.
- **⚠️ The unknown-pages floor is deliberately STRICTER than a known single page** (500 vs 200). On
  this lane, "we do not know how long this is" means DocAI never answered, i.e. we are on the tier
  measured to return fragments. The cost of being wrong is bounded: the document re-admits in 24 h,
  and after DOC8 the next attempt usually gets a page count.
- **The FRAGMENT TEXT IS KEPT, not nulled.** `needs_ocr=true` alone hides the row from both consumers
  (verified by grepping every read of the table: `gatherPropertyText`, `v_lcc_cre_bov_ready`,
  `ACTIVATE_unit4.sql` — all key on `needs_ocr`), and keeping it is what makes the repair auditable
  and reversible. DOC1's marker nulls `raw_text` only because a byte-fetch failure has no text.
- **BACKFILL APPLIED 2026-09-01 15:51 UTC** (migration `20260901120000`, batch `doc10_thin_20260901`,
  reversible via `_lcc_doc10_thin_ocr_backfill_backup`): **12 rows / 9 properties**, char_len 31–200,
  all unknown-pages. Re-run marks **0** (idempotent). The reversal was **RUN, not asserted** (P195) —
  a rolled-back round trip restored all 12 byte-identically, `mismatch = 0`.

| | before | after |
|---|---:|---:|
| `v_lcc_cre_bov_ready` | 7 | **4** |
| consumer-visible sidecars (`needs_ocr=false ∧ raw_text≠null`) | 77 | **65** |
| OCR rows reading COVERED | 25 | **13** |
| `v_lcc_cre_thin_ocr_watch` still reading covered | 12 | **0** |
| gov deeds with text (must not move) | 325/325 | **325/325** |
| cron 160 command · crons 167/169 active | `doctype=deed` · 2 | **unchanged · 2** |

- ⚠️ **`bov_ready` GOING DOWN IS THE FIX WORKING, and someone will read it as a regression.** Those
  three properties were never covered — they were "covered" by 31–200-character fragments, and BOV
  extract was receiving them as though they were the lease. **A covered count that includes fragments
  is not a smaller problem than a lower one; it is a wrong one.**
- ⚠️ **The 12 marked rows are hidden but NOT YET RETRIED.** Re-admission needs
  `thin_ocr_result` in `CRE_RETRY_REASONS`, which is JS and ships on the Railway redeploy of the
  merged PR. Until then they are correctly invisible and correctly untouched — which is the safe
  half of the order, since DOC8's page pre-flight is also JS.
- **NOT re-OCR'd:** nothing already extracted at good length. Only rows below the floor re-admit.

**Guard:** `test/doc8-doc9-doc10-page-cap-and-thin-floor.test.mjs` — 34 tests, **33 of 33 mutations
verified RED**, 0 skipped. Source assertions strip comments first (the fixes' own prose names
`imagelessMode`, `ocr_by_engine` and `thin_ocr_result` repeatedly). Two assertions were rewritten
after they **passed their own mutation**: `imageless: imagelessUsed` legitimately appears in both the
success and the error response, and `ocr_pages_unknown` appears in the result initializer as well as
the increment — both are now anchored on their BRANCH, not on presence (the B6c-dup lesson). The
edge module is imported with a `globalThis.Deno` stub so those tests RUN rather than silently skip.
`test/cre-doc-text-window-jam.test.mjs` changed one row deliberately: DOC1 pinned `thin_ocr_result`
as never-re-admitted, which was correct when a thin row counted as an answer and is exactly what
DOC10 refutes. ⚠️ Two further mutants survived the *first* metadata-parser test and the fix was to
add the DISCRIMINATING case, not to accept them: the live 400's `message` happens to repeat the same
two numbers as its metadata, so a test using only that body stays green with the structured path
deleted. The added case is a re-worded message with intact metadata — the scenario the change exists
for.

### ⚠️ CORRECTION — an earlier draft of this page recommended widening cron 160. That is REFUTED.

The reasoning was: 732 domain-store documents have bytes and no text, so widen `doctype=deed` to
`doctype=all` (which `document-text.js:87` already supports — a one-line `UPDATE cron.job`, no
deploy). **Do not do this.**

**`property_documents.raw_text` has exactly ONE consumer in the entire repo, and it is deed-only.**
`document-text.js:235-243` — `if (isDeed …)` → `processDeedDocument`. Every other doctype falls
through to `return { outcome: 'text_extracted' }` and **nothing ever reads the column again.**
Grep confirms: the only reads of `property_documents.raw_text` anywhere are inside
`document-text.js` itself. **Widening would spend DocAI/gpt-4o money on 732 documents to fill a
column no consumer reads.**

⚠️ **And the claim that this was blocking gov's firm-term gap was also wrong.**
`runLeaseExtraction` (`lease-extractor.js:953`) re-fetches bytes itself and is driven from
**`folder_feed_seen`**, a different table — **it never reads `property_documents.raw_text`.** The
gov docs assert a *"document-text-tick → lease-extractor chain"* that **is not wired**.

**The lesson: a drain is only worth widening where something consumes the result.** The measurement
that settles it is *"grep every read of the column,"* and it inverts the recommendation.

### 🔴 POST-DOC8 RE-MEASURE, 2026-09-01 16:21 UTC — the edge half is LIVE, the JS half is NOT DEPLOYED

**The tier split HAS flipped, and it is now measurable** — the DOC8 response said it was not, which
was true when written (15:30's DocAI rows landed minutes later). Every OCR event since 15:00:

| doc | tier | pages | chars | reason | `needs_ocr` |
|---:|---|---:|---:|---|---|
| 11 | gpt-4o | — | **116** | `thin_ocr_result` | **true** ✅ |
| 12 | **DocAI** | 5 | **7,572** | — | false ✅ |
| 15 | **DocAI** | 1 | 601 | — | false ✅ |
| 17 | **DocAI** | 1 | 2,094 | — | false ✅ |
| **24** | gpt-4o | — | **211** | `no_page_anchors_gpt4o` | 🔴 **FALSE** |

**Today: 3 DocAI vs 2 gpt-4o (all-time 6 vs 20).** The DocAI rows carry real page counts and real
text; **both gpt-4o rows carry no page count and 116 / 211 characters.** The pattern that produced
the 9.3× gap is visible in five rows.

⚠️ **THREE INDEPENDENT TELLS THAT THE RAILWAY REDEPLOY HAS NOT RUN** — the JS half of DOC8, all of
DOC9 and DOC10's floor are merged and inert:

1. **`over_docai_page_cap` has NEVER been written** (0 rows) — and a **40-page** document was hit at
   16:00:51. The post-fix behaviour is to stop with that marker and attempt no OCR; instead it fell
   through to gpt-4o, which is the pre-fix path.
2. **The 16:00 tick body still carries `ocr_by_engine`** — DOC9 **removed** that field. A deployed
   build would report `ocr_docs_by_engine` / `ocr_pages_unknown`.
3. **Document 24 was written `needs_ocr = false` at 211 characters.** DOC10's floor (500 when the
   page count is unknown) would have marked it.

🔴 **Document 24 is the DOC10 defect recurring live, four minutes after DOC10 shipped.** 211
characters, `needs_ocr = false`, so it satisfies `gatherPropertyText` and
`v_lcc_cre_bov_ready` — **BOV extract will receive 211 characters as a lease, and the row can never
be retried.** *Merged is not running*, demonstrated on the exact defect the merge was meant to close.

⚠️ **And one thing to verify AFTER the redeploy, not assumed:** document 24's reason is
`no_page_anchors_gpt4o`, **not** `thin_ocr_result`. DOC10's re-admission is a **set membership over
reasons**, so a thin row that arrives under a different reason must still (a) be caught by the
char-length floor and (b) land in `CRE_RETRY_REASONS`, or it will be marked and never re-admitted —
marked-and-idle is better than covered-and-wrong, but it is not the goal.

**Backlog: 691 → 682, `lowest_id_reached` = 2, sidecars 80 → 89, `needs_ocr` markers 22 (12 of them
DOC10's backfill).**

### ✅ POST-REDEPLOY VERIFICATION, 2026-09-01 16:30 UTC — deploy confirmed, DOC10 closed, one straggler repaired

**The deploy was confirmed BEHAVIOURALLY, not from `/version`** — the sandbox cannot reach the
Railway host, so a zero-work tick was fired through `lcc_cron_post` and its response read:

```
{"mode":"jobs","limit":1,...,"thin_ocr":0,"over_page_cap":0,"ocr_docs":0,
 "ocr_docs_by_engine":{},"ocr_pages_total":0,"ocr_pages_by_engine":{},"ocr_pages_unknown":0,...}
```

**`ocr_docs_by_engine` / `ocr_pages_unknown` / `thin_ocr` / `over_page_cap` are present and
`ocr_by_engine` is GONE** — that is the DOC9/DOC10 build answering. ⚠️ **A `mode=jobs&limit=1` tick
does no work and still proves the shape** — the cheapest possible deploy probe on this lane.

| check | result |
|---|---|
| deploy live | ✅ new counters present, `ocr_by_engine` removed |
| **rows covered-and-thin** | ✅ **0** — the DOC10 defect is fully closed |
| drain advancing | ✅ undrained **695 → 678** today, `lowest_id_reached` = 2 |
| new extractions clean | ✅ 15,383 / 7,068 / **1,886** chars — and the 1,886-char lease was **not**
  falsely marked thin, so the floor is not over-firing |
| `bov_ready` | 7 → 4 (DOC10 backfill) → **5** (two properties earned it, one lost on the straggler) |
| **`over_docai_page_cap`** | ⚠️ **0 — DEPLOYED BUT UNEXERCISED** |

🔧 **One straggler found and repaired: document 24.** It was written by the **pre-deploy** build at
16:00:51 — after DOC10's backfill and before the JS shipped — at **211 chars against a floor of
500**, `needs_ocr = false`. A sweep of the whole sidecar found **exactly one** such row. It was set
to `needs_ocr = true, reason = 'thin_ocr_result'`, which is **byte-identical to what
`cre-property-doc-text.js:296` now writes** (`thinOcr` takes precedence over the gpt-4o reason).
**Reversal:** `update … set needs_ocr=false, reason='no_page_anchors_gpt4o' where document_id=24`.

⚠️ **The reason MATTERS and it is not cosmetic.** `CRE_RETRY_REASONS` is
`['fetch_failed','extract_error','thin_ocr_result']` — **`no_page_anchors_gpt4o` is NOT in it.**
Marking the row while keeping its original reason would have made it *marked-and-idle forever*:
better than covered-and-wrong, but not the goal. **Verified in the code before writing** — line 296
overwrites the reason when the row is thin, so every FUTURE thin gpt-4o result re-admits correctly.
The design is sound; doc 24 was purely a deploy-window artifact.

⚠️ **10 of the 24 `needs_ocr` markers are NOT re-admittable** (`ocr_non_ok`, `over_ocr_cap`,
`office_unreadable`) — **CEILING markers, by design**, distinct from the 14 retry markers. Read
`marked_and_readmittable`, never the bare `needs_ocr` count.

⚠️ **STILL UNPROVEN, and both need a real 31+ page document:** `over_docai_page_cap` has never been
written, and **v24's structured-metadata parser has never been exercised** — the only observation of
the new cap (*"30 got 40"*) was made on **v23**. **The 16–30 page band — the entire population DOC8
exists for — has had zero OCR events either way.** A tier-split claim needs that band.

### ✅ DOC12 — 2026-09-01 18:35 UTC: the escalation is GONE. ⚠️ But say precisely WHY, because it is not the cap raise.

**Every OCR event since the redeploy — 9 of 9 on DocAI, ZERO on gpt-4o.** Char lengths 33,590 ·
21,454 · 4,378 · 4,222 · 3,462 · 2,144 · 1,633 · 1,587 · 627 — all real text, every row carrying a
page count. **The 86%-to-gpt-4o pattern that produced the 9.3× gap is finished.**

**`over_docai_page_cap` is being written — 2 rows, at 39 and 31 pages.** The marker path works: no
OCR attempted, `needs_ocr = true`, invisible to both consumers, re-admittable. DOC8's JS half is
exercised and correct.

⚠️ **AND HERE IS THE DISTINCTION THAT MATTERS: the flip is the MARKER's doing, not the cap raise's.**
Every successful DocAI row since the deploy is **≤12 pages — which the OLD 15-page cap served too.**
The two documents that exceeded the cap are **31 and 39 pages, both ABOVE 30**, so they were stopped
rather than served. **The 16–30 band — the exact population the 15 → 30 raise exists for — has still
had ZERO successful OCR events** (`in_the_16_30_band = 1`, and that row predates the deploy).

**So what is proven:** the fall-through to gpt-4o is closed, and the over-cap marker fires correctly.
**What is NOT yet proven:** that raising 15 → 30 serves any document it could not serve before.
**Do not quote the zero-escalation result as evidence for the cap raise** — they are two different
changes and only one of them has been exercised. ⚠️ **A win in the metric you were watching is not
automatically a win for the change you shipped.**

**Also observed and correct:** 2 rows `legacy_doc_unsupported` (OLE `.doc` — the documented terminal
ceiling, never fixable by OCR) and 1 `over_ocr_cap` (the bytes cap). Both marked, neither escalated.

**Drain state 18:35 UTC: undrained 639 (from 695), `bov_ready` 5 → 11 — the consumer more than
doubled.** 🔵 **DOC13's other half is still time-gated:** the 14 retry markers cross
`CRE_DOC_TEXT_RETRY_AFTER_HOURS` (24 h) at **~16:00–16:30 UTC on 2026-09-02**. Read `retry_admitted`
then — ⚠️ **and `marked_and_readmittable`, never the bare `needs_ocr` count**, which now also holds
the over-cap and legacy-doc ceiling markers that must NOT re-admit.

### 🔴 DOC12 CLOSED, 2026-09-01 21:15 UTC — the cap raise addresses a band that barely EXISTS

**14 OCR events since the redeploy, still ZERO on gpt-4o.** The escalation is fixed and stays fixed.
`over_docai_page_cap` has grown **2 → 5**. Drain: undrained **695 → 615**; `bov_ready` **5 → 13**.

**But the page distribution settles what actually fixed it, and it is not what DOC8 shipped for:**

| band | docs | observed range |
|---|---:|---|
| **01–15** — the OLD cap already served these | **19** | 1–12 |
| **16–30** — *the entire population the 15 → 30 raise exists for* | **1** | 25–25 |
| **31+** — marker, no OCR attempted | **5** | **31–57** |
| unknown (no pre-flight page count) | 131 | — |

**The 16–30 band holds ONE document in the whole measured corpus, and it predates the deploy.**
Meanwhile **five documents are 31–57 pages** — above 30 either way. **The corpus is bimodal: short
documents and long ones, with almost nothing in between.**

⚠️ **So DOC8's premise was wrong in an instructive way.** The fix was chosen from Google's own error
text (*"imageless mode raises the limit to 30"*) — **a fact about the API, not about our corpus.**
The documents actually falling through to gpt-4o were **31–57 pages**, which the raise cannot help.
**What closed the escalation was the MARKER, which stopped the fall-through.** The two changes
shipped together and only the marker did the work.

**The generalisable lesson: a vendor's stated limit tells you what the API will accept, never
whether your population sits under it. Measure the distribution before sizing a fix to a threshold.**

### 🔴 DOC14 — the long documents now get NO text at all, and they are probably the best ones

The marker is correct behaviour (better than paying 6–14× for a 211-character fragment) but it is
**not coverage**. **5 documents at 31–57 pages are marked `over_docai_page_cap`, invisible to both
consumers, and will never be extracted** — and at that length, on this corpus, they are almost
certainly **full executed leases**, the highest-value documents BOV extract could receive. **The
count grows as the backlog drains.**

⚠️ **This is a real gap, not a solved problem, and the marker makes it quiet** — the honest-counts
rule applies to us here: `bov_ready` rising while the longest leases silently get nothing.

**The likely route is DocAI ASYNCHRONOUS/batch processing**, whose page ceiling is far above the
synchronous 30 — ⚠️ **but verify that against the live discovery document rather than this page**
(DOC8's own lesson: the imageless flag was a top-level boolean, not where the prompt put it).
**Do not reach back for gpt-4o**, which was measured at 9.3× less text.

⚠️ **Caveat on all of the above: `page_count` is populated on 25 of 156 sidecar rows** — the
pre-flight only runs on the OCR path, so this is the right population but a **small sample**.
Re-measure as the backlog drains before treating the bimodality as settled.

### 🔴 DOC14 SIZED, 2026-09-01 22:20 UTC — it is 100% LEASES, at 8.1%, and the prompt is staged

**Re-measured on a larger sample, and the finding sharpened rather than softened:**

| doctype | drained | **over cap** | rate | still undrained |
|---|---:|---:|---:|---:|
| **lease** | 86 | **7** | **8.1%** | **360** |
| dd | 51 | **0** | 0% | 205 |
| om | 30 | **0** | 0% | 39 |

**Every over-cap document is a lease** — observed 31–57 pages. **Projected over the 360 undrained
leases: ~29 more, ~36 total** that will receive no text at all.

⚠️ **QUOTE 8.1%, NOT THE PAGE-COUNTED RATE.** Only OCR-path documents carry a `page_count`, so
`over_cap ÷ page_counted_leases` reads **32%** — the wrong denominator, and it overstates this **~4×**.
An earlier compound estimate in this session made exactly that error before it was measured directly.
**The denominator is all drained leases.**

**The bimodality now has a semantic explanation**: leases here are either **short (1–12 pages** —
amendments, short forms) or **long (31–57** — full executed leases). **The 16–30 band holds ONE
document in the entire corpus and it is a DD, not a lease.** So DOC8's 15 → 30 raise unlocks **zero
leases**, and this is the population that was actually falling through — which is the DOC12 finding
restated with the doctype attached.

**Why it is the item worth doing:** `bov-extract.js` reads leases to extract the tenant, and these
are the **full executed documents**. ⚠️ **They yield nothing while `bov_ready` climbs — the marker
makes the gap quiet**, which is the honest-counts failure this repo catalogues, pointed at us.

**Prompt: `docs/claude-code/prompts/DOC14-long-lease-ocr-async.md`.** Route is DocAI
**async/batch**, and three constraints are written into it: ⚠️ **verify the contract against the live
v1 discovery document** (DOC8's flag was a top-level boolean, not where the prompt put it);
⚠️ **async cannot fit the 22 s tick** — it returns a long-running operation and writes to GCS, so it
belongs in the **existing `mode=jobs` lane** as submit → poll → ingest, not a second worker; and
⚠️ **if the route is unavailable, stop and say so** — splitting a lease into chunks changes what
`extractTenantFromLease` receives, and a named honest ceiling beats a plausible workaround.

### 🛑 DOC14 BLOCKED, 2026-09-01 22:35 UTC — the async contract is verified, the prerequisites do NOT exist, nothing was built

**The route is real and the lane was NOT built, because its operator prerequisites are absent.**
Per the prompt's §2 and §6 this is the intended outcome: *a named, dated, honest ceiling beats a
half-built lane.* No code, no edge deploy, no `mode=jobs` change. `over_docai_page_cap` is untouched
and remains the correct terminal state.

#### The async contract, as READ from the live v1 discovery document

Read directly, **not taken from the prompt** (DOC8's own lesson):
`https://documentai.googleapis.com/$discovery/rest?version=v1`, **revision `20260820`**, fetched
2026-09-01 22:29 UTC (HTTP 200, 397,842 bytes).

| | shape |
|---|---|
| method | `projects.locations.processors.batchProcess` — `POST .../processors/{id}:batchProcess` |
| request | `GoogleCloudDocumentaiV1BatchProcessRequest` = `inputDocuments` · `documentOutputConfig` · `processOptions` · `skipHumanReview` · `labels` |
| response | **`GoogleLongrunningOperation`** — `name` · `done` · `error` · `metadata` |
| poll | `projects.locations.operations.get`; `metadata` is `BatchProcessMetadata` (`state`, `stateMessage`, `individualProcessStatuses[]`) |
| ingest | each `individualProcessStatuses[]` carries `inputGcsSource`, **`outputGcsDestination`**, `status` — the results are written **as JSON files to GCS**, never returned inline |

⚠️ **THE PROMPT'S PREREQUISITE LIST IS INCOMPLETE, AND THE MISSING HALF IS THE EXPENSIVE ONE.**
§2 named *"a GCS **output** bucket and its IAM."* The contract requires an **INPUT** bucket as well:

```
GoogleCloudDocumentaiV1BatchDocumentsInputConfig
  gcsPrefix    : GcsPrefix     { gcsUriPrefix }
  gcsDocuments : GcsDocuments  { documents[] { gcsUri, mimeType } }
```

**Those are its only two fields. `batchProcess` cannot accept bytes.** Compare `ProcessRequest`,
which has **three** input options — `rawDocument` (bytes), `gcsDocument`, `inlineDocument`. So the
sync seam this repo already runs (`docai-ocr` POSTs `content_base64`) has **no analogue on the async
path**: every document must be **uploaded to GCS first**. Our documents arrive as bytes from
SharePoint through the PA flow and are never persisted anywhere durable, so the lane would have to
add an upload step — which is where the confidentiality decision below lives.

⚠️ **`imagelessMode` DOES NOT EXIST ON `BatchProcessRequest`.** It is a top-level boolean on
**`ProcessRequest` only** (`GoogleCloudDocumentaiV1ProcessRequest.imagelessMode`, confirmed again in
this same read). DOC8's flag therefore does not carry over — which is harmless, since the async
ceiling is far above it either way, but it is a real contract difference and would have been
inherited by assumption.

**What §2 guessed and got RIGHT:** it is a long-running operation, it writes to GCS, it cannot
complete inside the 22 s tick, and it belongs in the existing `mode=jobs` lane as **submit → poll →
ingest** rather than a second worker.

⚠️ **THE PAGE CEILING IS NOT IN THE DISCOVERY DOCUMENT AND WAS NOT VERIFIED HERE.** Discovery
defines the request/response *shape*; page limits are quota documentation, and
**`docs.cloud.google.com` is blocked by this sandbox's egress proxy** (both `curl` and `WebFetch`
return `EGRESS_BLOCKED`). A web search summarises the Google docs as **sync 15 · imageless sync 30 ·
batch 500 pages per document**, 1 GB per file, 5,000 files per batch request — consistent with the
`500 pp` figure `document-capture-and-ocr-status.md` has carried since 2026-08-12, but **that figure
remains unverified against Google's own page and must not be quoted as measured.** It does not
change the verdict: our largest observed document is **59 pages**, comfortably under every candidate
ceiling. **The blocker is GCS, not pages.**

#### 🛑 The operator prerequisites — measured absent on four independent checks

| # | prerequisite | state |
|---|---|---|
| 1 | GCS **input** bucket/prefix (mandatory — batch takes no bytes) | ❌ none |
| 2 | GCS **output** bucket/prefix (`documentOutputConfig.gcsOutputConfig.gcsUri`) | ❌ none |
| 3 | IAM for the `GOOGLE_DOCAI_SA_KEY` service account — `storage.objects.create` on input, `get`/`list` on output | ❌ ungranted |
| 4 | IAM for the **Document AI service agent** — `service-<PROJECT_NUMBER>@gcp-sa-prod-dai-core.iam.gserviceaccount.com`, read on input + write on output | ❌ ungranted |
| 5 | an env var or secret to carry the bucket name | ❌ **no such name exists anywhere** |
| 6 | a retention/lifecycle + confidentiality decision on the buckets | ❌ never taken |

**This is a measurement, not an inference from silence — four checks, all negative:**

- **Repo grep** for `GCS|gs://|storage.googleapis|bucket` across `api/`, `supabase/`, `scripts/` and
  the root config returns **exactly one hit**, and it is the prose line in
  `document-capture-and-ocr-status.md` saying this *would* be needed.
- **`GET /api/diag?kind=env` has no GCS field at all** — not `false`, *absent*. There is no env var
  name for an operator to set.
- **LCC Opps `vault.secrets` holds 7 names** (`dia_supabase_*`, `gov_supabase_*`, `lcc_api_key`,
  `lcc_health_alert_webhook`, `lcc_railway_url`) — **none GCP or GCS.**
- **`docai-ocr` reads exactly four GCP envs** — `GOOGLE_DOCAI_SA_KEY`, `GOOGLE_DOCAI_PROCESSOR`,
  `GOOGLE_DOCAI_PROJECT_ID`, `GOOGLE_DOCAI_LOCATION`. **No bucket, and no Cloud Storage call
  anywhere in the function.**

⚠️ **THE ONE CHECK THAT COULD NOT BE RUN, STATED PLAINLY:** whether a bucket exists in GCP project
`modular-conduit-450617-h5` that LCC simply does not reference. The SA key is a Supabase edge secret
and **`*.supabase.co` is egress-blocked from this sandbox** (`curl` → `000`), so no token can be
minted here. **It does not change the verdict.** Prerequisite 4 is certainly absent regardless — the
DocAI service agent has never needed a grant, because every call this system has ever made passed
`rawDocument` inline — and prerequisite 5 is absent by direct observation.

#### 📋 What the operator needs to do to unblock it

1. Create two GCS locations in project `modular-conduit-450617-h5`, **in the `us` multi-region so
   they match `GOOGLE_DOCAI_LOCATION`** — e.g. `gs://lcc-docai-in/` and `gs://lcc-docai-out/` (one
   bucket with two prefixes is fine).
2. Grant the **`GOOGLE_DOCAI_SA_KEY` service account** `roles/storage.objectAdmin` scoped to those
   two prefixes (it must write inputs and read outputs).
3. Grant the **Document AI service agent** `service-<PROJECT_NUMBER>@gcp-sa-prod-dai-core.iam.gserviceaccount.com`
   `roles/storage.objectViewer` on the input prefix and `roles/storage.objectCreator` on the output
   prefix. ⚠️ **This is a second, different principal** — granting only the SA fails at submit time
   with a permission error that names DocAI, not us.
4. Set a **lifecycle rule** deleting objects after ~7 days on both prefixes. 👤 **This is a decision,
   not plumbing:** these are confidential executed client leases, and batch writes the **full
   extracted text** to GCS as JSON. Somebody has to say that is acceptable before the lane ships.
5. Then, and only then, the build has a place to put a bucket name.

#### ⚠️ Two design constraints for whoever builds this, so they are not rediscovered

- **The in-flight marker needs somewhere to keep the OPERATION NAME.** §2 correctly requires a dated
  marker distinct from `over_docai_page_cap` so *"waiting on batch"* and *"we will never read this"*
  are different facts — and DOC1's mechanism supplies the marker. But a poll must find the LRO, and
  the sidecar has **no column for an operation name**: `reason` is a single text field whose values
  are consumed as **set membership** by `CRE_RETRY_REASONS`, so stuffing an opaque id into it breaks
  the re-admission predicate. **A schema addition (an operation-name column, or a small
  `lcc_cre_doc_ocr_job` table) is part of the build, not an afterthought.**
- **Idempotency is a COST property here (§3).** A document already in flight must be recognised as
  in flight, which means the operation name has to be readable *before* the next submit — the same
  requirement, arrived at from the other direction.

#### 🔬 Re-measured 2026-09-01 22:31 UTC — and it MOVED in the eleven minutes since the prompt

| doctype | drained | **over cap** | rate | pages | still undrained |
|---|---:|---:|---:|---|---:|
| **lease** | 89 | **9** | **10.1%** | **31–59** | **357** |
| dd | 53 | **0** | 0% | — | 203 |
| om | 30 | **0** | 0% | — | 39 |

**`over_docai_page_cap` went 7 → 9 during this session** (two more landed at 22:00 and 22:30 UTC) —
**the count grows as the backlog drains, which is exactly what DOC14 predicted.** Still **100%
leases: zero DDs, zero OMs.** Projected over the 357 undrained leases at 10.1%: **~36 more, ~45
total.** ⚠️ **Quote the rate over ALL DRAINED LEASES, and re-derive it — it is a moving number, and
the page-counted denominator still overstates it ~4×.**

**The semantic claim is now READ, not inferred** — all nine, by name:

`LFB Plasma Lease - Florence, SC.pdf` (59) · `McBen Amended and Restated Cultivation lease.PDF` (57)
· `KEDPlasma - Myrtle Beach, SC - Lease Agreement.pdf` (46) · `Lease.pdf` (44) ·
`Verizon Lease.pdf` (44) · `Grifols - Sumter, SC - Lease Agreement.pdf` (42) ·
`Harbor Bay - FAA Lease.pdf` (39) · `Grifols - Greenwood, SC - Lease Agreement.pdf` (34) ·
`Lease (1).pdf` (31).

**These are full executed leases** — amended-and-restated instruments, named-tenant lease
agreements. They are precisely what `bov-extract.js` reads to extract the tenant, and they currently
yield nothing.

**The lane that must not move, verified:** **22 OCR events since the redeploy, ALL `google_docai`,
ZERO gpt-4o** (char_len 150–43,084). `bov_ready` **13**. Registry 1,066 rows, 894 undrained.

#### 💰 Cost, sized — and it is not what is blocking this

The nine over-cap documents are **396 pages**. Projected at the observed mean (44 pages) over ~45
documents: **~1,980 pages.** At the rate this page already carries for Enterprise Document OCR
(**~$1.50 / 1,000 pages**) that is **~$0.59 today and ~$3 for the entire projected backlog.**

⚠️ **That rate is this repo's carried figure, NOT re-verified** — the pricing page is egress-blocked
too, and batch is not guaranteed to price identically to sync. **The conclusion survives the
uncertainty by two orders of magnitude: a ~$3 lane is being held up by a bucket that does not
exist.** The real cost of this lane is the **confidentiality decision** at step 4, not the API bill.

#### ⛔ What was deliberately NOT done

- **No gpt-4o fall-through above the cap** (§3) — measured at 9.3× less text.
- **`over_docai_page_cap` not removed or weakened** — it is still the right terminal state, and it is
  what keeps a fragment out of `bov_ready`.
- **No tick-budget or row-cap change**, no second worker, no schema change, no edge deploy.
- **No page-splitting** (§6). `extractTenantFromLease` prompts over the document *whole*; chunking
  changes what the consumer receives and would need its own grading.
- **Not explored: whether a different processor has a higher synchronous ceiling.** Named, not
  pursued — a different processor returns a different document shape, which is the same class of
  substitution §6 rules out.

#### Re-derive this section

```sql
-- LCC Opps (xengecqvemvfknjvbvrq). BASELINE 2026-09-01 22:31 UTC:
--   lease 89 drained / 9 over cap (10.1%) / 357 undrained · dd 53/0 · om 30/0 · pages 31–59
-- ⚠️ over_cap RISES as the backlog drains. A fall means either the lane shipped or the
--    marker was weakened — check which before celebrating.
select lower(t.document_type) dt,
       count(*) as drained,
       count(*) filter (where t.reason = 'over_docai_page_cap') as over_cap,
       round(100.0 * count(*) filter (where t.reason = 'over_docai_page_cap')
             / nullif(count(*), 0), 1) as pct_of_drained,
       min(t.page_count) filter (where t.reason = 'over_docai_page_cap') as min_pages,
       max(t.page_count) filter (where t.reason = 'over_docai_page_cap') as max_pages
from lcc_cre_property_document_text t
group by 1 order by over_cap desc;

-- The prerequisite gate. Until an operator answers this, the lane cannot be built.
--   1. does a GCS bucket exist in modular-conduit-450617-h5?
--   2. is the DocAI service agent granted on it?          <- the one people forget
--   3. what env var carries its name?                     <- none exists today
```

### 🔴 DOC14 — BLOCKED ON AN OPERATOR PREREQUISITE, and RE-SIZED ~2× (2026-09-02)

**Nothing was built. The contract was verified from the live v1 discovery document** (revision
20260820): `batchProcess` → `GoogleLongrunningOperation`, poll
`projects.locations.operations.get`, output at
`BatchProcessMetadata.individualProcessStatuses[].outputGcsDestination`. **The prompt's §2 was right
that this is an LRO writing to GCS, cannot fit the 22 s tick, and belongs in `mode=jobs`.**

⚠️ **TWO WAYS THE PROMPT'S PREREQUISITE LIST WAS WRONG, and the missing half is the expensive one:**

1. **`BatchDocumentsInputConfig` accepts ONLY `gcsPrefix` / `gcsDocuments` — batch takes NO inline
   bytes**, unlike `ProcessRequest` (`rawDocument`/`gcsDocument`/`inlineDocument`). §2 named an
   **output** bucket; an **INPUT bucket is mandatory too**, and **every SharePoint byte-stream would
   have to be uploaded to GCS first.** That is a materially larger build than "add a bucket."
2. **`imagelessMode` does not exist on `BatchProcessRequest`** — it is a `ProcessRequest` field only.
   **DOC8's flag does not carry over.**

**Prerequisites are ABSENT on four independent checks:** a repo grep for `GCS|gs://|bucket` across
`api/`, `supabase/`, `scripts/` returns **one hit and it is the prose line saying it would be
needed** · `diag?kind=env` has **no GCS field at all** · LCC Opps `vault.secrets` holds 7 names,
**none GCP** · `docai-ocr` reads 4 GCP envs, **none a bucket**, and makes **no Cloud Storage call**.
⚠️ **One check could not run** (whether an unreferenced bucket exists in the GCP project — the SA key
is a Supabase edge secret and `*.supabase.co` is sandbox-blocked); **it does not change the verdict**,
because the Document AI **service agent** grant is certainly absent — every call this system has ever
made passed `rawDocument` inline.

⚠️ **The page ceiling could NOT be verified** — `docs.cloud.google.com` is egress-blocked.
**The ~500 pp figure this repo has carried since 2026-08-12 stays labelled UNVERIFIED.**

**👤 THE REAL GATE IS NOT COST — IT IS CONFIDENTIALITY.** ~$0.59 today and **~$3 for the whole
projected backlog** (at the repo's carried ~$1.50/1k rate, itself unverified). **Batch writes the
FULL TEXT of confidential executed client leases to GCS as JSON.** That is Scott's decision, not a
plumbing step. Unblocking also needs two `us` GCS prefixes, `storage.objectAdmin` for the DocAI SA,
**separate grants for the Document AI service agent** (`service-<PROJNUM>@gcp-sa-prod-dai-core…` —
the principal people forget), and a lifecycle rule.

**One build note recorded for whoever picks this up:** the sidecar has **nowhere to keep the LRO
operation name.** `reason` is consumed as **set membership** by `CRE_RETRY_REASONS`, so parking an
opaque id there **breaks re-admission**. A column or a small job table is **part of the build, not an
afterthought** — and it is the same requirement as the in-flight idempotency the prompt asked for.

### ⚠️ AND THE SIZING MOVED ~2× — the "small sample" caveat cashed in exactly as written

| doctype | drained | **over cap** | rate | undrained | max pages |
|---|---:|---:|---:|---:|---:|
| **lease** | 212 | **36** | **17.0%** | 234 | **141** |
| **dd** | 90 | **4** | **4.4%** | 166 | 59 |
| om | 43 | 0 | 0% | 26 | — |

**Three claims this page carried are now corrected:**

1. **The lease rate is 17.0%, not 8.1%** — it more than doubled as the sample grew 86 → 212.
2. ⚠️ **"100% leases" is REFUTED — DD is 4 over cap (4.4%).** The exclusivity was an artifact of the
   smaller sample.
3. **Max pages is 141, not 57.** ⚠️ **That makes the unverified ~500 pp async ceiling load-bearing
   after all** — the earlier "not load-bearing, our largest is 59 pages" reasoning no longer holds.

**Projection: ~87 documents total**, roughly double the ~45 recorded yesterday. **`over_docai_page_cap`
is already 40 with 426 still undrained.**

⚠️ **This is the third time in this arc a rate moved materially when the sample grew** (the gpt-4o
escalation 86%, `repeat_buyer` 8×, now this). **Quote a rate with its denominator and its sample
size, and re-measure before acting on it.** The semantic reading is now direct rather than inferred —
`LFB Plasma Lease` (59), `McBen Amended and Restated Cultivation lease` (57), `KEDPlasma – Myrtle
Beach Lease Agreement` (46), `Harbor Bay – FAA Lease` (39) — **unmistakably full executed leases.**

### ✅ DOC13 ANSWERED 2026-09-02 — `retry_admitted: 0` is CORRECT, and here is the watch item

**11 of the 14 `thin_ocr_result` markers are now past the 24 h window** (oldest 46 days) and
**none has re-extracted.** That reads like a failure and is not. Every tick since 10:00 UTC:

```
retry_admitted:0 · scan_lowest_id:2 · scan_capped:false · scan_pages:2 · eligible:15
```

**The scan reaches document id 2 and is NOT budget-capped — it simply fills `limit=15` from the 426
FRESH undrained documents before it needs a retry candidate.** Retries are correctly the lowest
priority while genuine new work exists. **The 3 `fetch_failed` markers are all under 24 h and are
correctly not due.**

⚠️ **THE WATCH ITEM — a priority inversion, benign today:** if new documents arrive faster than the
drain, the retry lane **never runs**. That is Class 12's shape one level up — not a fixed window, but
**a lower-priority lane that can starve indefinitely.** Today it is fine (426 drains in ~2 days).
**Verify `retry_admitted` goes non-zero as `undrained` approaches 0** — and if the folder feed keeps
it permanently non-empty, the retry lane needs a reserved slot rather than the remainder.

## 1. Scott's question, answered

> *"At one point there was an issue with access to deeds ingested from CoStar and I asked whether we
> needed to download those deeds and mortgages at ingestion and store them somewhere to be processed
> later."*

**Yes — that was the diagnosis, that was the decision, it was built, and it worked.**

The root problem (`UW6_REV_document_byte_capture.md`): `property_documents.source_url` was a
**CoStar CDN signed token** (`ahprd1cdn.csgpimgs.com/d2/<token>/…`), **session-gated and
short-lived**. A doc captured the same day already 403s server-side. **A capped drain returned
20/20 `fetch_failed`; ~86% of `property_documents` were stranded.**

**The decision was exactly what Scott proposed: capture the bytes AT INGEST, while authenticated,
into a per-domain non-pruned `property-documents` bucket.** Explicitly rejected: server-side
deferred re-fetch, datacenter CoStar scraping, CAPTCHA solving. **Merged as PR #1703 + #1707.**

**Result: 1,057 of 1,177 gov domain documents (90%) carry durable bytes, and deeds are 100%
extracted.** ⚠️ **It was applied to the store that had the CoStar problem. The CRE registry — which
holds the leases, DDs and OMs and feeds BOV extract — has no bytes column at all**, and did not need
one, because its sources are SharePoint.

## 2. The pipeline as it stands

**CAPTURE (domain store)** — `sidebar-pipeline.js::upsertDocumentLinks` writes the row;
`captureDocumentBytesAtIngest` runs inline (server re-fetch) · **the extension fetches bytes inside
the authenticated CoStar tab** (`background.js::fetchDocBytesViaTab` →
`/api/intake?_route=capture-doc-bytes` → `storeClientDocBytes`) — the only way to reach a
session-bound link · SharePoint via the PA "Get Artifact" flow · backfill worker
`?_route=doc-bytes-backfill` (**manual, never scheduled**).

**CAPTURE (CRE registry)** — `folder_feed_cre`: **100% SharePoint server-relative paths.** No bytes
stored; fetched at OCR time via the PA flow.

**STORAGE** — per-domain `property-documents` bucket, key
`<domain>/<doctype>/<property_id>/<content_hash>.<ext>`. ⚠️ **Bytes in Storage, never inline in
Postgres** (the R15/R18 disk-incident lesson).

**OCR (shared)** — office-text (docx/xlsx, byte-sniffed, never OCR'd) → free OSS → **Google Document
AI** → gpt-4o last resort. ⚠️ **No per-doctype tier or spend gating exists in either worker** — tier
is purely env-driven, and the only guards are global (`OCR_MAX_BYTES`, the 22 s tick budget, the
50-row cap). **There is no spend guard that halts a tick.**

**CRONS — all three verified `active = true`, 2026-09-01:**

| jobid | name | schedule | command |
|---|---|---|---|
| **160** | `lcc-document-text-deeds` | `*/30 * * * *` | `/api/document-text-tick?doctype=deed&limit=15` |
| **167** | `lcc-cre-doc-text-backfill` | `*/30 * * * *` | `…cre-doc-text-tick&mode=eligible&limit=15` |
| **169** | `lcc-cre-doc-text-jobs` | `15,45 * * * *` | `…cre-doc-text-tick&mode=jobs&limit=15` |

⚠️ **Job 160's live name is `lcc-document-text-deeds`; the migration
(`20260620170000`) schedules `lcc-document-text`.** It was renamed out-of-band. **The live
`cron.job` row is the authority — the repo does not describe it.**

**CONSUMPTION** — **domain store:** deed parser only (document number, recording date, transfer tax
→ implied price, grantor/grantee, APN) + R59 BD-spine propagation. **CRE store:**
`bov-extract.js:192-224` reads the sidecar filtered `needs_ocr=is.false&raw_text=not.is.null`,
groups into `{leases, dd, om}`, and feeds `extractTenantFromLease` plus the DD/OM joins.

## 3. ⚠️ THE BLOCKERS, in priority order

**B1 — ✅ FIXED 2026-09-01 (DOC1). `fetchEligibleCreDocs` never advanced past the newest 60 rows;
695 documents with a live consumer were unreachable.** §0 carries the fix. ⚠️ **The
self-exclusion premise written here before the fix was HALF TRUE:** the post-fetch lanes
(`ocr_non_ok`, `over_ocr_cap`, `thin_ocr_result`) do persist a row, but a **byte-fetch failure
persisted nothing** — so oldest-first needed the negative marker as well as the cursor. Verifying
that on the code path rather than from the table is what caught it.

**B2 — 🔴 THE `GovernmentProject` DOCS ARE STALE AND WILL COST MONEY.**
`GovernmentProject/CLAUDE.md` §26 and `RUNBOOK_firm_term_coverage_ops_gates.md` say *"the crons are
`active=false`"* and instruct building **a CoStar-authenticated non-datacenter (residential-egress)
session**. **Both false:** the crons are ACTIVE, and the CRE documents are **SharePoint, which never
needed egress.** ⚠️ **They also assert a `document-text-tick → lease-extractor` chain that does not
exist** (§0). **Cross-repo; cannot be fixed from this repo's PR.**

**B3 — 🔴 The gov firm-term queue expects a chain that is not wired.**
`v_gov_firm_term_reextract_queue` marks 99 sales / 58 properties `needs_ocr`, waiting on lease text
that `runLeaseExtraction` will never take from `property_documents`. **Either wire the consumer or
retire the expectation** — as it stands it is a queue nothing can drain.

**B4 — 🔴 No cron on `doc-bytes-backfill`.** Ran once (2026-08-12), never scheduled. **85 gov docs
are `url_only`, 120 have neither bytes nor text.**

**B5 — 🔴 Extension reload is silent and per-profile.** Byte capture needs manifest ≥1.0.39; current
is **1.0.45**. ⚠️ A profile on a pre-1.0.39 unpacked load captures **no bytes**, with no telemetry.

**B6 — 🔴 Marketing brochures are excluded from byte capture** (`sidebar-pipeline.js:2981`) while
gov's firm-term queue counts 25 as term-bearing.

**B7 — 🔴 `run_county_ingest_cron` is a LIVE producer writing dateless deed rows.** Fix the producer
before any backfill — Class 8.

⚠️ **DO NOT widen cron 160 to `doctype=all`.** §0. It is one `UPDATE` away and it is the wrong move.

## 4. The honest ceilings — state these before promising coverage

- ⚠️ **~325 dead-URL deeds and ~1,600 docs hold expired CoStar tokens. The server CANNOT re-fetch
  them.** Do not pretend a server drain recovers them.
- ⚠️ **1,582 gov `deed_records` have neither a document nor a URL** — not recoverable from anything
  we hold.
- **Legacy OLE `.doc`** → terminal `office_no_text:legacy_doc`, never fixable by OCR.
- **Caps are deliberate:** DocAI sync ~15 pages; `INTAKE_OCR_MAX_BYTES` 12 MB. Over-cap docs go
  off-box via the `ocr_text` resubmit seam.
- ⚠️ **`deed_records` (metadata rows, 5,819) is NOT `property_documents` (documents, 1,177).**
  Conflating them is how "we need to OCR 4,995 deeds" gets asserted — the OCR-able corpus is 325
  and it is done.

## 5. ⚠️ Traps that have each cost a cycle

- **The eligibility rule is `raw_text IS NULL AND storage_path IS NOT NULL`.** URL-only docs are
  deliberately excluded. **Do not "fix" this by re-adding a URL fallback** — it re-clogs the queue
  with rows that can never succeed.
- **The 2026-07 silent OCR outage:** the edge secret pointed at a **Custom Extractor** instead of an
  OCR processor, so DocAI 400'd and every call **silently fell to gpt-4o at 6–14× cost while
  receipts still read `enriched`.** Symptom: `ocr_tier:'cloud'` where `cloud_cheap` is expected.
  The secret is the **bare resource name** — no `https://`, no `:process`.
- **PostgREST schema-cache staleness bit this exact table** (`property_documents.source`, 2026-08-08)
  — migrations correct, writes still 400ing. Fix: `NOTIFY pgrst, 'reload schema';`
- **A key is not a value** (Class 32): `deed_records.raw_payload` carries a `recording_date` **key**
  on 4,919 rows and a **value on 10**.

## 6. What was NOT verified here

- **dia's `property_documents`** — the domain-store counts are **gov**. dia was not measured.
  The CRE-registry counts are workspace-wide.
- **WHY the CRE lane's OCR went quiet.** Since **2026-07-18** every sidecar row is `pdf_text` (free,
  digital layer); no OCR has run since. Whether that is because the reachable 60 happened to be
  digital, or because a tier broke, was **unmeasured** — the window jam masked it either way.
  ⚠️ **DOC1 removed the mask but did not answer the question**: the 695 have never been sampled, so
  their scanned/digital mix is still unknown, and **the first real OCR ticks are the measurement.**
  Watch `ocr_by_engine` and `ocr_pages_total` (§7b query 2) before letting it run unattended.
- ⚠️ **The tier split on what DID run is worth a look:** **12 rows on gpt-4o** (`tier:'cloud'`,
  `no_page_anchors_gpt4o`) against **3 on `cloud_cheap`** (DocAI) — the documented 6–14× cost
  escalation shape, though all of it predates the 2026-08-12 DocAI fix.
- **`SHAREPOINT_FETCH_URL`** is runtime env; not assertable from the repo. Probe
  `GET /api/diag?kind=env` → `sharepoint_fetch_url_set`.
- **Whether any browser profile is running a stale extension** — unobservable from here (B4).

---

## 7. What DOC1 changed, and what it did not

✅ **DEPLOYED AND VERIFIED on the first real cron tick, 2026-09-01 15:00:00 UTC** (merge 14:56:09 →
Railway redeploy → cron 167). These are measured, not predicted:

| | before (14:30 tick) | after (15:00 tick) |
|---|---:|---:|
| `eligible` | **0** (permanently) | **15** |
| `scan_lowest_id` / `eligible_lowest_id` | ~2258 | **2 / 2 — the oldest row in the population** |
| `scan_pages` · `scan_rows` · `scan_capped` | — | 1 · 200 · **false** |
| `scanned` · `text_extracted` · `ocr` | 0 · 0 · 0 | **4 · 3 · 1** |
| lease/dd/om undrained | **695** | **691** |
| sidecar rows | 76 | **80** |
| `bov_ready_properties` (the CONSUMER) | 5 | **6** |
| deeds (`property_documents`) | **325/325** | **325/325 — UNCHANGED** |
| cron 160's command | `doctype=deed` | **`doctype=deed` — UNCHANGED** |

Documents reached on that tick: **id 2** (om, 57,084 chars) · **7** (lease, 6,935) · **10** (lease,
9,492) · **11** (lease, OCR). `scanned: 4` against `eligible: 15` is **the 22 s tick budget stopping
on an item boundary**, reported honestly rather than silently.

⚠️ **`scan_capped: false` with `scan_exhausted: false` is the third, correct state** — the scan
stopped because it had its full batch of 15, not because the budget or the population ran out.

### 🔴 THE FIRST OCR ROW WENT TO gpt-4o, AND IT IS **NOT** THE CUSTOM-EXTRACTOR FOOTGUN (DOC8)

The one `ocr` row on that tick — document **11**, a lease — came back
`ocr_tier: 'cloud'`, `ocr_engine: 'gpt-4o-2024-08-06'`, **116 chars**, tagged `thin_ocr_result`
(under the 120-char `CRE_OCR_MIN_CHARS` floor). **We paid the 6–14× premium and got nothing usable.**

**The documented footgun is REFUTED here — check the error, not the symptom.** §5 says
`ocr_tier:'cloud'` where `cloud_cheap` is expected means the edge secret points at a Custom
Extractor. Live at 15:00:18, the `docai-ocr` function log reads:

```
[docai-ocr] Document AI 400 (processor=projects/108926230693/locations/us/processors/5ecc6339861c88e1):
  "message": "Document pages in non-imageless mode exceed the limit: 15 got 19.
              Try using imageless mode to increase the limit to 30.",
  "reason": "PAGE_LIMIT_EXCEEDED"
```

That is **the correct Enterprise Document OCR processor** (the exact resource id §"OCR foundation"
names as right). The secret is fine. The cause is a **19-page lease against DocAI's 15-page sync
cap** — i.e. the documented `over_page_cap → gpt-4o last resort` behaving as designed. **Google's own
error names the fix: imageless mode raises the cap 15 → 30**, a one-line edge-function change that
would route this class back to the cheap tier. ~~**Not done here**~~ — ✅ **SHIPPED 2026-09-01 as
DOC8 (`docai-ocr` v23); see §0d, including why the field is a TOP-LEVEL ProcessRequest boolean and
what now happens at 31+ pages.**

⚠️ **AND THE COST TELEMETRY IS BLIND TO EXACTLY THE EXPENSIVE PATH.** That tick reported
**`ocr_by_engine: {}` and `ocr_pages_total: 0` while spending gpt-4o money**, because
`bump()` only accumulates when `ocr_pages > 0` and the gpt-4o path returns no page count. **The
counter built to catch the 6–14× escalation reads empty precisely when the escalation happens** — the
failure-looks-like-success shape, inside the spend guard itself. ~~**Until that is fixed, read
`items[].ocr_tier` / `ocr_engine`, NEVER `ocr_by_engine`.**~~ ✅ **FIXED 2026-09-01 as DOC9 (§0d):
`ocr_by_engine` is REMOVED — read `ocr_docs_by_engine`, `ocr_pages_by_engine` and
`ocr_pages_unknown`. ⚠️ The identical blindness is still live in `document-text.js` and
`lease-backfill.js` (other lanes, deliberately untouched).**

⚠️ **Sample size is ONE OCR row.** The mechanism is confirmed; the RATE across the 691 is not. The
undrained population is lease-heavy and a 16–30-page lease is ordinary, so this plausibly repeats at
scale — **watch the next few ticks before letting it run unattended, and read the tier per item.**

**Untouched on purpose:** the `mode=jobs` claim semantics (`claimPendingJobs` is a different path
with its own locking); the 50-row hard cap and the 22 s tick budget (**the only brakes — there is no
spend guard that halts a tick**); the env-driven, doctype-uniform tier selection; and every domain-store
object. ⚠️ **If cron 160 or the deed counts move, the wrong lane was changed.**

## 7b. ⚠️ THE STANDING STATUS CHECK — run this before quoting any number on this page

Everything above is dated. These four queries re-derive it. **Baseline = 2026-09-01, immediately
before the DOC1 fix shipped**, so a later reading is a delta, not a fresh guess. ✅ **The fix is
live** (first tick 15:00 UTC, §7) — so the baseline is now genuinely a *before*, and the numbers
should be moving.

```sql
-- LCC Opps (xengecqvemvfknjvbvrq)
-- 1. The CRE backlog. BASELINE 2026-09-01: population 771 · drained 76 · undrained 695
--    · min_id 2 · max_id 2317 · newest60_done 60 (the jam's signature).
with pop as (
  select d.id from lcc_cre_property_documents d
  where lower(d.document_type) in ('lease','dd','om')
), side as (
  select distinct document_id from lcc_cre_property_document_text
  where extractor_version = 'unit1_v1'
)
select (select count(*) from pop)                                                as population,
       (select count(*) from pop p join side s on s.document_id = p.id)          as drained,
       (select count(*) from pop p left join side s on s.document_id = p.id
          where s.document_id is null)                                           as undrained,
       (select min(id) from pop) as min_id, (select max(id) from pop) as max_id,
       (select count(*) from (select id from pop order by id desc limit 60) n
          join side s on s.document_id = n.id)                                   as newest60_done;

-- 2. Outcome + spend mix. BASELINE 2026-09-01 PRE-DOC1: 45 pdf_text · 14 gpt-4o ('cloud')
--    · 3 cloud_cheap (DocAI) · 7 ocr_non_ok · 4 thin_ocr_result · 3 over_ocr_cap · 0 fetch_failed
--    · 0 extract_error.
--    ⚠️ POST-DOC10 (2026-09-01 15:51) the shape CHANGED and a naive read now misleads: all 12 thin
--    gpt-4o rows carry `reason='thin_ocr_result'` AND `needs_ocr=true` — they are markers, not
--    extractions. Split by needs_ocr, and read `v_lcc_cre_thin_ocr_watch` (must show 0 rows with
--    needs_ocr=false) rather than counting `cloud` rows as covered. New reason to expect:
--    `over_docai_page_cap` (DOC8 — over the 30-page synchronous cap, NO OCR was attempted).
--    ⚠️ `cloud` dominating `cloud_cheap` is the Custom-Extractor footgun and bills 6–14× — STOP.
--    ⚠️ A rising `fetch_failed` count is the SharePoint PA flow, not this worker: probe
--       GET /api/diag?kind=env -> sharepoint_fetch_url_set.
select coalesce(reason,'(none)') as reason, needs_ocr, method, ocr_tier, count(*) as n,
       min(extracted_at)::date as first_seen, max(extracted_at)::date as last_seen
from lcc_cre_property_document_text group by 1,2,3,4 order by n desc;

-- 3. Did the drain reach the CONSUMER? A rising sidecar count is NOT the same fact.
--    BASELINE 2026-09-01: bov_ready_properties 5 · bov_extractions 6 ·
--    consumer_visible_sidecars 66 (om 25 / lease 22 / dd 19) over 38 properties.
--    ⚠️ 66 covered documents yield only 5 READY properties, because the view needs
--       >=1 lease AND *every* lease/dd/om doc on that property covered. So the
--       consumer metric moves in steps, on a property's LAST document — expect it
--       to lag the sidecar count badly and then jump.
select (select count(*) from v_lcc_cre_bov_ready)      as bov_ready_properties,
       (select count(*) from lcc_cre_bov_extraction)   as bov_extractions,
       (select count(*) from lcc_cre_property_document_text
          where needs_ocr = false and raw_text is not null) as consumer_visible_sidecars;

-- 4. The lane that must NOT move. BASELINE: gov deeds 325 of 325 with text.
--    (gov scknotsqkcheojiaewwh) — and cron 160's command must still read doctype=deed.
select count(*) filter (where raw_text is not null) as with_text, count(*) as total
from property_documents where lower(document_type) = 'deed';
```

**Reading them honestly:**

- ⚠️ **Read `scan_capped` on the tick before reading `eligible: 0` as an empty queue.** Capped means
  `eligible` is a FLOOR. `scan_exhausted: true` with `eligible: 0` is the genuine all-clear.
- ⚠️ **Read `scan_lowest_id`, not just `eligible`.** A non-zero `eligible` off the newest rows is
  exactly what the pre-fix code produced on the day it was written; the fix is only working if the
  scan is starting at the bottom of the population.
- ⚠️ **`retry_admitted` is a re-discovery tally, never throughput** (P159a). A steady non-zero
  `retry_admitted` with a flat `undrained` means fetches are failing, not that work is happening —
  check `fetch_failed` in query 2 and the SharePoint flow.
- ⚠️ **`text_extracted` rising and `bov_ready_properties` flat is not a contradiction and not
  success.** `v_lcc_cre_bov_ready` requires **every** lease/dd/om doc on a property to be covered, so
  a partly-drained property crosses over only on its last document. **The lane's point is BOV
  extract; the sidecar count is the means.**
- ✅ **The extraction QUALITY on the already-drained 76 was read, not assumed** (2026-09-01): five
  named OMs (`MavisDiscountTire-EastGateCommons`, `Walgreens - Franklin Park`, `FedExGround-Middletown`,
  `LandPro Equipment - Clymer`, `Lowes-Edmond`) carry 16k–35k chars of real body text — tenant, address,
  lease structure, guaranty — and four named DDs (a PSA extension notice, a tax bill, a title commitment,
  an 84k-char executed PSA) read correctly at their MIDPOINT, not just the cover page. **A non-zero
  `char_len` is not evidence the extraction is useful; a midpoint sample is.** Fleet: om 25 / lease 22 /
  dd 19 covered, avg 14.9k / 16.3k / 64.0k chars.
- ⚠️ **The undrained population's scanned-vs-digital mix has never been sampled.** Every sidecar row
  since 2026-07-18 is `pdf_text` (free). The first real OCR ticks are the measurement — watch
  `ocr_by_engine` / `ocr_pages_total` on the tick response before letting it run unattended.
