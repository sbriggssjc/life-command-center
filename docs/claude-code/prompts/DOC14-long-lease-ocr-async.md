# DOC14 — the long leases get no text at all, and they are the best documents we have

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — **§0 in full**, especially the
DOC12 close (why the cap raise fixed almost nothing) and the DOC14 entry ·
`document-capture-and-ocr-status.md` (the DocAI runbook: processor id, the Custom-Extractor footgun,
the env matrix) · `CLAUDE.md` honest-counts doctrine and the Consumption-Layer rules.

---

## 1. The measurement — it is one doctype, and it is the one that matters

Documents above DocAI's synchronous page ceiling are marked `over_docai_page_cap` and **no OCR is
attempted**. That is correct behaviour (DOC8 measured the gpt-4o fall-through at **9.3× less text**),
but it is **not coverage**. Measured live 2026-09-01 22:20 UTC:

| doctype | drained | **over cap** | rate | still undrained |
|---|---:|---:|---:|---:|
| **lease** | 86 | **7** | **8.1%** | **360** |
| dd | 51 | 0 | 0% | 205 |
| om | 30 | 0 | 0% | 39 |

**Every over-cap document is a lease. Zero DDs, zero OMs.** Observed range **31–57 pages**.
**Projected over the 360 undrained leases at the measured 8.1%: ~29 more, ~36 in total.**

⚠️ **Quote 8.1%, not the page-counted rate.** Only OCR-path documents get a `page_count`, so
`over_cap ÷ page_counted_leases` reads **32%** and is the wrong denominator — it would overstate this
by ~4×. **The denominator is all drained leases.**

**And the page distribution has a semantic explanation now:** leases in this corpus are either short
(1–12 pages — amendments, short forms) or long (31–57 — full executed leases). **The 16–30 band holds
exactly ONE document across the whole corpus and it is a DD, not a lease.** So DOC8's 15 → 30 raise
unlocks **zero leases**, and this is the population that was actually falling through.

**Why it matters: `bov-extract.js` reads leases to extract the tenant.** These ~36 are the full
executed documents — the highest-value input the consumer can receive — and they currently yield
nothing while `bov_ready` climbs. ⚠️ **The marker makes the gap quiet**, which is the honest-counts
failure this repo catalogues, pointed at us.

## 2. What to build

**A path for documents ABOVE the synchronous ceiling. The likely route is DocAI asynchronous /
batch processing**, whose page limit is far above the sync 30.

- ⚠️ **VERIFY THE ASYNC CONTRACT AGAINST THE LIVE v1 DISCOVERY DOCUMENT, NOT THIS PROMPT.**
  DOC8's own lesson: the imageless flag turned out to be a **top-level `ProcessRequest` boolean**,
  and the prompt's framing would have nested it under `processOptions.ocrConfig` where it is a
  **silent no-op**. Read `https://documentai.googleapis.com/$discovery/rest?version=v1` and confirm
  the request shape, the page ceiling, and the output contract before writing code.
- ⚠️ **ASYNC DOES NOT FIT THE TICK, AND THAT IS THE REAL DESIGN CONSTRAINT.** Sync returns text
  inline; batch returns a **long-running operation** and writes output to a **GCS bucket**. It cannot
  complete inside the **22 s tick budget**. **Use the jobs lane that already exists** —
  `mode=jobs` / `claimPendingJobs` / `enqueueCreDocText` — as **submit → poll → ingest**, rather than
  inventing a second worker.
- **A submitted-but-unfinished document must carry a DATED marker of its own**, distinct from
  `over_docai_page_cap`, so *"waiting on batch"* and *"we will never read this"* are different facts.
  ⚠️ Reuse DOC1's negative-marker mechanism; **do not invent a second one.**
- **Operator prerequisites are likely and must be named, not assumed:** a **GCS output bucket** and
  its IAM. If they are absent, **stop and say so** — an honest blocked state beats a half-built lane.

## 3. ⚠️ What this must NOT do

- ⛔ **Do NOT reach back for gpt-4o above the cap.** Measured: **19 rows, avg 1,579 chars, 12 under
  500, minimum 31** against DocAI's 14,687 average. The fall-through was removed **because it was
  measured to fail**, not to save money.
- **Do NOT remove or weaken the `over_docai_page_cap` marker.** It is the correct terminal state
  until this lane exists, and it is what keeps a fragment out of `bov_ready`.
- **Do NOT raise the 22 s tick budget or the 50-row cap** to make a synchronous call fit. That is the
  wrong shape and there is **still no spend guard that halts a tick.**
- **Do not touch cron 160, the deed lane, or the domain store.** Deeds are 325/325.
- ⚠️ **Do not let a batch submission double-charge.** A resubmitted document that is already
  in-flight must be recognised as in-flight, not re-sent. **Idempotency is a cost property here, not
  just a correctness one.**

## 4. Predicted deltas — assert against these

| | today | expected |
|---|---:|---:|
| `over_docai_page_cap` rows | **7** | **falls as they extract** |
| leases with real text | — | **+7 now, ~+36 as the backlog drains** |
| gpt-4o OCR events | **0 since redeploy** | **0 — unchanged** |
| `bov_ready` | **13** | **rises, and for the right reason** |
| deeds (`property_documents`) | 325/325 | **unchanged** |

## 5. Report back

- **The async contract as you READ it from the discovery document** — request shape, real page
  ceiling, output contract — and how it differs from what §2 guessed.
- Whether the operator prerequisites exist; **if not, stop there and report the blocked state.**
- **`char_len` for the first long leases extracted**, and ⚠️ **read 3 of them at their MIDPOINT, not
  the cover page.** A non-zero length is not evidence the text is usable — DOC1's response made
  exactly this check and it is why the OM/DD extractions were trustworthy.
- **The over-cap count before and after**, and the projected residual.
- ⚠️ **Cost per document at the new tier**, measured on the first few — this lane is 31–57 page
  documents and nobody has priced it.

## 6. ⚠️ If the async route turns out not to be available

**Say so and stop.** Do not substitute a workaround — splitting a lease into 30-page chunks changes
what the consumer receives (a lease is one document; `extractTenantFromLease` prompts over it whole),
and it is exactly the kind of plausible fix that would need its own grading. **A named, dated,
honest ceiling is an acceptable outcome for this prompt.**
