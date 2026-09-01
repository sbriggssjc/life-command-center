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
> **Live-verified 2026-08-31; §0 blocker FIXED and re-measured 2026-09-01 (DOC1).**
>
> ⚠️ **Every number on this page is dated. Before quoting one, run §7b — the standing status check,
> with its 2026-09-01 baseline.**

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

| | before | after |
|---|---:|---:|
| `eligible` on a fresh tick | **0** (permanently) | **> 0** while a backlog exists |
| lowest registry id the scan can reach | **~2258** | **the oldest row in the population** |
| lease/dd/om undrained | **695** | falls ~15 per tick as crons 167/169 run |
| sidecar rows | 76 | rising |
| deeds (`property_documents`) | **325/325** | **325/325 — UNCHANGED** |
| cron 160's command | `doctype=deed` | **`doctype=deed` — UNCHANGED** |
| cron 167/169 schedule + `limit` | `*/30`, `15` | **unchanged** |

**Untouched on purpose:** the `mode=jobs` claim semantics (`claimPendingJobs` is a different path
with its own locking); the 50-row hard cap and the 22 s tick budget (**the only brakes — there is no
spend guard that halts a tick**); the env-driven, doctype-uniform tier selection; and every domain-store
object. ⚠️ **If cron 160 or the deed counts move, the wrong lane was changed.**

## 7b. ⚠️ THE STANDING STATUS CHECK — run this before quoting any number on this page

Everything above is dated. These four queries re-derive it. **Baseline = 2026-09-01, immediately
before the DOC1 fix shipped**, so a later reading is a delta, not a fresh guess.

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

-- 2. Outcome + spend mix. BASELINE: 45 pdf_text · 14 gpt-4o ('cloud') · 3 cloud_cheap (DocAI)
--    · 7 ocr_non_ok · 4 thin_ocr_result · 3 over_ocr_cap · 0 fetch_failed · 0 extract_error.
--    ⚠️ `cloud` dominating `cloud_cheap` is the Custom-Extractor footgun and bills 6–14× — STOP.
--    ⚠️ A rising `fetch_failed` count is the SharePoint PA flow, not this worker: probe
--       GET /api/diag?kind=env -> sharepoint_fetch_url_set.
select coalesce(reason,'(none)') as reason, needs_ocr, method, ocr_tier, count(*) as n,
       min(extracted_at)::date as first_seen, max(extracted_at)::date as last_seen
from lcc_cre_property_document_text group by 1,2,3,4 order by n desc;

-- 3. Did the drain reach the CONSUMER? A rising sidecar count is NOT the same fact.
--    BASELINE: 0 fully-covered properties on the readiness view.
select count(*) as bov_ready_properties from v_lcc_cre_bov_ready;

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
- ⚠️ **The undrained population's scanned-vs-digital mix has never been sampled.** Every sidecar row
  since 2026-07-18 is `pdf_text` (free). The first real OCR ticks are the measurement — watch
  `ocr_by_engine` / `ocr_pages_total` on the tick response before letting it run unattended.
