# DOC8 + DOC9 + DOC10 — the cheap OCR tier 502s on long documents, and the fallback silently writes fragments

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — **§0 in full**, especially
*"POST-DOC1 RE-MEASURE"* and *"DOC10"* · the DOC1 response in `docs/claude-code/responses/` ·
`document-capture-and-ocr-status.md` (the DocAI runbook: processor id, the Custom-Extractor footgun,
the env matrix) · `CLAUDE.md` honest-counts doctrine.

**Three coupled defects. Do them in this order — the order is load-bearing.**

---

## 1. The measurement

DOC1 unjammed the CRE drain and its first tick immediately tripped the spend check. Measured across
**every OCR row the lane has ever produced**:

| tier | rows | avg chars | **under 500 chars** | `thin_ocr_result` |
|---|---:|---:|---:|---:|
| **`cloud` (gpt-4o)** | **19 (86%)** | **1,579** | **12 (63%)** | 5 |
| `cloud_cheap` (DocAI) | 3 (14%) | **14,687** | 0 | 0 |

**The expensive tier returns 9.3× LESS text** (gpt-4o minimum: **31 characters**).

**Cause, read from the edge-function log rather than guessed:** `docai-ocr` returned HTTP **502**,
`PAGE_LIMIT_EXCEEDED — "non-imageless mode exceed the limit: 15 got 19"`. ⚠️ **NOT the documented
Custom-Extractor footgun** — the processor is the correct Enterprise Document OCR one. It is
DocAI's **15-page synchronous cap**, and this corpus is lease-heavy.

**Exposure:** the undrained backlog is **416 lease / 235 dd / 44 om**. At the observed OCR rates
(lease 48%, dd 29%, om 0%) that is **~200 lease + ~57 dd OCR events, ~86% of which currently route
to the failing tier**, over the ~3–4 days the backlog takes to drain.

## 2. DOC8 — raise the cheap tier's page ceiling (do this FIRST)

Google's own error names the fix: **imageless mode** raises the synchronous cap from 15 to **30**
pages. Change the `docai-ocr` edge function to request it.

- **Verify the flag against current Document AI documentation before shipping** — do not take
  "imageless mode" from this prompt as an API contract. Confirm the field name and that the
  processor supports it.
- ⚠️ **30 is still a cap, not a solution.** Establish what happens at 31+ pages and make it a
  **named, dated negative marker** (DOC1's mechanism), never a silent fall-through to gpt-4o.
  ⚠️ **A lease over 30 pages is completely ordinary** — measure how much of the backlog that is
  before deciding the residual is small.
- **Do not remove the gpt-4o tier.** It is the correct last resort for a genuinely un-servable
  document; the defect is that it is being reached routinely and silently.
- **Deploy note:** this is a Supabase **edge function** on **LCC Opps**, not a Railway deploy.

## 3. DOC9 — the counter built to catch the escalation is blind to it

The 15:00 tick reported `ocr_by_engine: {}` and `ocr_pages_total: 0` **while spending gpt-4o money**,
because `bump()` only counts when `ocr_pages > 0` and gpt-4o returns no page count.

**Count the ENGINE unconditionally; count PAGES only when known.** ⚠️ **Do not report an unknown
page count as 0** — that is the P180 NULL-is-not-zero failure, and here it zeroes exactly the tier
you are trying to watch. Until this ships, **read `items[].ocr_tier`, never `ocr_by_engine`.**

⚠️ **This is why §7c's spend check could not have caught DOC8 on its own** — the query reads
`ocr_tier` off the sidecar, which is populated, but the tick's own summary counter is not. **Both
were needed.**

## 4. DOC10 — a thin OCR result must NOT count as covered (do this AFTER DOC8)

⚠️ **This is a correctness defect and it is worse than failing.** `gatherPropertyText`
(`bov-extract.js:192-224`) admits on `needs_ocr=is.false&raw_text=not.is.null`, and
`v_lcc_cre_bov_ready` counts a document covered on `AND NOT t.needs_ocr`. **A 31-character fragment
satisfies both**, so BOV extract receives it as though it were the lease and the property reads
*covered* — **it will never be retried, because nothing distinguishes it from a real extraction.**

- **A thin OCR result on a multi-page document writes DOC1's dated negative marker**
  (`needs_ocr = true`, re-admitted after `CRE_DOC_TEXT_RETRY_AFTER_HOURS`). Reuse that mechanism;
  do not invent a second one.
- ⚠️ **`reason='thin_ocr_result'` is ALREADY SET on 5 rows and no consumer reads it.** The label
  exists and nothing acts on it — that is the gap.
- **The floor must be page-aware, not a flat char count.** A genuinely short one-page document is
  not thin. ⚠️ **And `page_count` is NULL on 79 of 80 sidecar rows**, so a rule keyed on it is mostly
  inert — measure what you can actually key on before choosing the predicate.
- **Backfill the existing 12** to the marker so they re-admit. ⚠️ **Report how many properties leave
  `bov_ready` when you do** — that number going DOWN is the fix working, and someone will read it as
  a regression if you do not say so first.

⚠️ **Order matters: DOC8 before DOC10.** A quality floor shipped while the cheap tier still 502s on
long documents will correctly reject most leases and park the backlog on retry markers.

## 5. ⚠️ What this must NOT do

- **Do not pause or re-schedule crons 167/169** without saying so explicitly — the drain is
  producing real value (OMs and digital leases extract at 16k–35k chars, `bov_ready` moved 5 → 6).
- **Do not touch cron 160 or the deed lane.** Deeds are 325/325 and correct.
- **Do not raise the 22 s tick budget or the 50-row cap.** ⚠️ **There is still no spend guard that
  halts a tick** — those two are the only brakes, and DOC8 is about to make OCR succeed more often.
- **Do not re-OCR anything already extracted at good length.** Only the thin rows re-admit.

## 6. Report back

- **The tier split on the first ticks after DOC8** — `cloud_cheap` must overtake `cloud`. This is
  the whole point; report it before anything else.
- **Average `char_len` by tier, before and after.** The target is gpt-4o's 1,579 becoming irrelevant
  because DocAI is serving these documents at ~14,687.
- What happens at 31+ pages now, and **how much of the backlog that is**.
- For DOC10: the floor you chose, what you keyed it on, the count you backfilled, and **the
  `bov_ready` delta with the explanation attached**.
- ⚠️ **Read 3 named re-extracted documents** that previously came back thin. A tier change is not
  evidence the text is now usable.
