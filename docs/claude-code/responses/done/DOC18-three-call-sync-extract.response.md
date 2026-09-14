# DOC18 — response: the three-call sync window is BUILT. All four traps fired.

**Date:** 2026-09-02 · **Outcome:** the `over_docai_page_cap` dead end has a replacement — a
multi-call synchronous extract of the consumer's page window, **no GCS, no IAM, no LRO, no
confidentiality decision.** · **Guard:** `test/doc18-three-call-sync-extract.test.mjs`, 33 tests,
**28/28 mutations verified RED.** · Full suite **5,004 tests, 0 fail** after repairing three stale
DOC8 assertions this change broke (§7 — I first wrote them up as pre-existing, and that was wrong).

⚠️ **NOTHING HAS MOVED IN PRODUCTION YET, AND THAT IS THE HEADLINE FOR §7.** The route ships on a
Railway redeploy plus an additive migration; from this sandbox neither `*.supabase.co` nor Railway
is reachable (DOC17 measured `http=000`). Every number below §6 is therefore a MEASUREMENT OF THE
CODE, not of the corpus, and it is labelled as such rather than dressed up as a live result.

---

## 1. What shipped

| what | where |
|---|---|
| plan + window | `api/_shared/document-text.js` — `planPageWindow`, `ocrCloudCheapWindow`, `extractDocumentText({ ocrPageWindow })` |
| page selector | `supabase/functions/docai-ocr/index.ts` — `page_range` → `ProcessOptions`, plus traps 2 and 4 |
| the lane | `api/_handlers/cre-doc-text.js` `?mode=longdoc` + `fetchOverCapCreDocs` |
| schema + honest counts | `supabase/migrations/20260902120000_lcc_doc18_partial_page_window.sql` |
| cron | `lcc-cre-doc-text-longdoc`, `7,37 * * * *`, one document per tick |
| canonical doc | `docs/architecture/document-capture-ocr-and-deeds.md` (new DOC18 section) + `CLAUDE.md` |

`planPageWindow(141, {targetPages: 50})` → **`fromStart:30` + `[31..45]` + `[46..50]`**, exactly
DOC17's contract. §1 was not re-verified.

## 2. ⚠️ Which of the four traps actually fired — all of them

**TRAP 1 — `page_limit` is the maximum ACHIEVABLE limit.** Fired as designed and was nearly missed
in the guard rather than in the code. Nothing in the route sizes a call from it; the plan comes from
the two measured constants, and a test asserts `page_limit` never appears inside
`ocrCloudCheapWindow` at all. The one re-plan the route performs keys on **`imageless`** — a fact
about what was SENT — because a 30-page first segment is only servable when imageless applied.
⚠️ **The first cut of that test passed its own mutation:** the stub set `page_limit: 30` AND
`imageless: false` together, so a mutant keyed on `page_limit` behaved identically. The added test
is the DISCRIMINATING one — a refusal reporting `page_limit: 30` *with imageless held* must NOT
re-plan. **When two predicates would both fire on your fixture, the fixture is not a guard.**

**TRAP 2 — `At most 15 pages in one call please.`** Fired, and the half that mattered was not the
half DOC17 emphasised. The parser blindness was real (`pageLimitFromError` → `{null,null}`), but the
**cap DETECTOR** was blind too: `/PAGE_LIMIT_EXCEEDED|exceed the limit/` misses that sentence
entirely, so the wrapper would have reported a generic `docai_400` and the window could not have
told a cap refusal from a real error — on the shape it hits every time it sends 30 pages off page 1.
`isPageCapError` now covers all three shapes and `pageLimitFromError` returns `limit: 15, got: null`
(**unknown is not zero** — the message never says how many were asked for).

**TRAP 3 — the base is 15, the baseline arm said 30.** Fired at the design stage. Both constants
come from DOC17's seven-arm table, not from one error's metadata, and the guard asserts across four
document lengths (31/50/141/316) that the first segment is ≤30 and **every later one is ≤15**. A
mutant raising the base to 30 goes red.

**TRAP 4 — one shared secret resolved with `||`.** Fixed to a SET; `authorized()` accepts any
configured secret. This is a strict SUPERSET of what authenticated before, so the live drain cannot
regress, and it is what makes the function reachable from `pg_net`.

## 3. ⚠️ A defect the guard found that the prompt did not name

**`page_count` and `ocr_pages` used to be the same number, and the window splits them.** Before this
route DocAI either read the whole document or refused it, so `buildDocTextRow` wrote its
`knownPages` (which prefers `ocr_pages`) into `page_count`. For a windowed extract that records a
**141-page lease as 141 → 50** and erases the very fact that makes it a partial. The thin-OCR floor
still keys on pages READ (correct — "is this text too thin for what we extracted"); the persisted
`page_count` is now the document's length. **Found by an assertion, not by reading the code.**

## 4. The tick-budget decision, and what a document looks like between ticks

**CHOSEN: its own budget (`CRE_OCR_WINDOW_BUDGET_MS`, 110 s), ONE document per tick, NO cross-tick
partial state.** Spanning ticks would need per-segment text persisted mid-document — a half-written
sidecar both consumers could read, and a limbo state that can strand; that is the class this repo
keeps paying for. So a document is **never mid-flight between ticks**: it is either

- a **partial with text** (`needs_ocr=false`, `partial_extract`, `pages_covered`, `page_ranges`), or
- a **dated marker** (`over_docai_page_cap` = never attempted · `window_failed` = attempted, empty).

**Idempotency / no double-charge:** a successful partial flips `needs_ocr` false and leaves the
queue permanently, so it can never restart from call 1. A window that fails PART way **keeps the
pages it already paid for** rather than discarding them — discarding is exactly what would make the
next attempt re-buy them. A total failure rewrites the marker with a fresh `extracted_at`, **which
is the cursor**: the head rotates instead of re-selecting the same unservable document forever
(P135/P136 — *what makes a target stop being selected?* Here: "it was attempted", recorded as a
date, not "it produced output").

## 5. The honest ceiling (§5), on the row

Pages beyond ~50 are still not captured; for a 141-page lease, 51–141 remain unread, and the
`abstract` block asks for renewal options, early termination, default cure and holdover — clauses
that routinely sit in the back half. So a partial is tagged `partial_page_window`, raises
**citation risk** in `gatherPropertyText`, and `v_lcc_cre_bov_ready` gained **`partial_docs` /
`fully_covered_docs` / `lease_partial`** (appended — `CREATE OR REPLACE VIEW` is append-only).

⚠️ **Membership is deliberately UNCHANGED, and that is a judgement worth arguing with.** §5 says a
partial must never count as complete coverage. Excluding partials from `bov_ready` membership would
also keep 42 real leases out of BOV extract — strictly worse for the operator, to avoid a claim
nobody makes once the row says `partial_docs`. `covered_docs` keeps its existing meaning
(**consumable**) and is qualified rather than silently redefined; the alternative re-uses a name for
a different fact, which is the DOC9 `ocr_by_engine` failure. **If the intent was harder — that a
property with any partial should not be `bov_ready` at all — that is a one-line change to the
`HAVING`, and it should be made deliberately rather than inferred.**

## 6. ⚠️ §7's asks that CANNOT be answered from here, stated plainly

**`char_len` for the first converted long leases, and reading three of them at the page-30 and
page-45 boundaries: NOT PRODUCED.** Three independent reasons, none of them fixable in this session:

1. **The JS half is not deployed.** No document has been through the route.
2. **The 42 documents are unreachable from where the credentials live.** They are SharePoint
   server-relative refs fetched through the Power Automate flow, and `SHAREPOINT_FETCH_URL` is a
   Railway env var, not a Supabase edge secret — DOC17 hit this and said so.
3. **`docai-page-probe` returns `text_chars` and `page_numbers` but NEVER the text**, by design. It
   could confirm the three ranges come back as `[1..30]`, `[31..45]`, `[46..50]` — but DOC17 already
   measured arms 1, 2 and 6, `[46..50]` is 5 pages inside a limit `[31..45]` already proved, and §4
   says do not re-verify §1. **So a probe run would have spent real money to re-measure a settled
   contract and still not returned the boundary TEXT.** It was not run.

**What replaces it, and why it is stronger than a length check:** the prompt's own warning is that
*"a plausible total length is not evidence the seams are clean"* — so the seam is not built from
lengths at all. It is assembled as a **map keyed on Document AI's own page numbers**, which makes
duplication structurally impossible and a gap DETECTED rather than inferred. The guard exercises
that against a stub honouring the selector: **50 pages, `page_ranges [[1,50]]`, `page_gaps []`,
`duplicate_pages 0`**, page 31 immediately after page 30 and page 46 after page 45 in the assembled
text; plus a duplicated in-range page (dropped, page appears exactly once), a holed segment
(reported as `[[38,38]]`), and a **silently ignored selector** (caught by the page numbers, walk
stopped). **The boundary text on real documents remains owed, and the verification query is in the
canonical doc.**

**Measured cost against the ~$3.30 estimate: NOT MEASURED, and the estimate is unchanged and still
carries DOC17's caveat that ~$1.50/1k pages is the repo's carried rate, unverified.** The route
bills exactly `pages_covered`, which the tick reports as `window_pages_covered`, so the first live
run measures it directly. Predicted: ≤50 pages per document × 42 ≈ **≤2,100 pages ≈ $3.15**, and
lower in fact because 18 of the 42 are 31–50 pages.

**Residual — how many documents still exceed the window: 24 of 42 (>50pp, max 141)**, from the
CURRENT STATE block's own re-measure, unmoved. Those 24 become partials; the other 18 are covered in
full. ⚠️ **A second residual is named and unsized:** `ocrCloudCheap` refuses a buffer over
`INTAKE_OCR_MAX_BYTES` (12 MB) and the selector does not help — the whole document is sent on every
call. A large scan will come back `window_failed / over_ocr_cap`. **How many of the 42 that is
cannot be measured from here** (byte sizes live behind the PA flow); the first `mode=longdoc` run
reports it as a named reason rather than a silence.

## 7. What must not have moved, and the three failing tests

⛔ **gpt-4o is unreachable from this path by construction** — the window calls `ocrCloudCheap`
directly, never `ocrPdfToTextTiered`, and a failed window returns the marker rather than falling
through. Asserted behaviourally (0 calls to either).
**The ordinary under-cap drain is byte-identical**: the window is opt-in per caller, the worker
defaults it OFF, the `eligible`/`jobs` lanes never pass it, and a non-windowed sidecar payload gains
no new keys — so it cannot 400 on PGRST204 even if the migration lags. **`over_docai_page_cap` is
not removed.** No GCS, no batch, no LRO.

### ⚠️ Three DOC8 assertions went RED, and I called them pre-existing before checking

They were not. All three are in `test/doc8-doc9-doc10-page-cap-and-thin-floor.test.mjs` and all
three are **stale greps over correct code** — the repo's documented rule is to *determine
breach-vs-stale-grep before you "fix"*, so each was read against the shipped source first:

1. **`!/processOptions[\s\S]{0,200}imagelessMode/`** — a **200-CHARACTER PROXIMITY WINDOW**, and
   `callDocai` now takes a `processOptions` PARAMETER whose name sits within 200 chars of the body's
   `imagelessMode`. The invariant is about **NESTING, not proximity**; re-anchored to ask the actual
   question — does any `processOptions: { … }` object literal contain `imagelessMode`? This is the
   fixed-window footgun `CLAUDE.md` documents, in its undershoot direction.
2. **`/callDocai\([^)]*false\)/`** — `false` is no longer the last argument. The invariant is "a
   retry with imageless OFF", not "false ends the call".
3. **`CRE_CEILING_REASONS` deep-equals `['over_docai_page_cap']`** — DOC18 legitimately adds
   `window_failed`. The set is still PINNED (an accidental widening must stay deliberate), just to
   the current membership.

All three repairs were **mutation-verified RED** on the invariants they exist for (imagelessMode
nested under processOptions · the retry not turning imageless off · `over_docai_page_cap` dropped
from the ceiling set), so the guard still discriminates rather than having been loosened to pass.

## 8. Deploy order and verification

**Additive schema BEFORE the writer** (the constant rule): apply `20260902120000`, then redeploy.
⚠️ **`GET /api/intake?_route=cre-doc-text-tick&mode=longdoc` is an UNGATED DRY RUN** — it costs
nothing and returns the PLAN (page count, marker age, exact segment list per document). Run it
first; the spend is sized before it happens.

Then verify **on the sidecar delta, never the tick's own tally** (`lcc_cron_post` stops listening at
60 s while the handler runs on — P123):

```sql
select * from public.v_lcc_cre_longdoc_backlog;
select count(*) filter (where partial_extract) as partials,
       min(char_len), max(char_len)
  from public.lcc_cre_property_document_text
 where extractor_version = 'unit1_v1' and not needs_ocr;
select sum(partial_docs), sum(fully_covered_docs), count(*) from public.v_lcc_cre_bov_ready;
```

Read `partial_window` / `ocr` / `window_pages_covered` / `window_failed` on the tick — never
`scanned`, and never `eligible`.
