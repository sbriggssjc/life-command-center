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
> **Live-verified 2026-08-31.**

---

## 0. ⚠️ THE HEADLINE — a green cron has been returning `eligible: 0` over 695 waiting documents

**There are TWO document stores, in two databases, with two workers. Conflating them is why this
topic keeps getting rediscovered.**

| | **domain store** | **CRE registry store** |
|---|---|---|
| table | `property_documents` (gov + dia domain DBs) | `lcc_cre_property_documents` (LCC Opps) |
| worker | **cron 160** `lcc-document-text-deeds` | **crons 167/169** `lcc-cre-doc-text-*` |
| has a bytes column? | ✅ `storage_path` + `storage_bucket` | ❌ **none — `source_url` only** |
| doctypes drained | `deed` only | `lease, dd, om` |
| **downstream consumer** | deed parser → BD spine | **BOV extract** → tenant/DD/OM |
| state | **deeds 325/325 text — 100% ✅** | ⚠️ **76 of 771 — and permanently stuck** |

### ⚠️ The blocker, found 2026-09-01 — `fetchEligibleCreDocs` has a fixed window and no cursor

`api/_shared/cre-property-doc-text.js:265-290`:

```js
const reg = await q('GET', `lcc_cre_property_documents?...&order=id.desc&limit=${cap * 4}`);  // newest 60
const side = ...;                                    // which of THOSE 60 already have a sidecar
const rows = reg.data.filter((r) => !done.has(r.id)).slice(0, cap);
```

**It only ever looks at the newest 60 rows.** Measured live: **`newest60_already_done = 60`.** So the
diff is empty, `eligible` is **0**, and it will be 0 forever — while **695 documents (ids 2 →
~2250) are permanently unreachable.** Live cron responses, every 30 minutes, HTTP **200**:

```
{"mode":"eligible","doctype":"lease,dd,om","limit":15,"scanned":0,"eligible":0,"items":[]}
```

⚠️ **This is Dead-End Playbook Class 12 for the THIRD time** — P135 (property-twin, fixed window),
P136 (reachability harvest, re-checking the same 120 nightly), and now this. **Same signature every
time: green cron, honest-looking zero counters, nothing moving.**

⚠️ **And these are SharePoint paths, not CoStar** — `/sites/TeamBriggs20/Shared Documents/…`,
**100% of 1,066 rows**. They do **not** expire, are **not** session-bound, and need **no** residential
egress. **They are fetchable today.** The CoStar token problem does not apply to this store at all.

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

**B1 — 🟢 `fetchEligibleCreDocs` never advances past the newest 60 rows. 695 documents with a live
consumer are unreachable.** §0. **This is the fix on this page.** The failure lanes already write a
sidecar row (`ocr_non_ok`, `over_ocr_cap`, `thin_ocr_result` are all present), so a completed or
failed row self-excludes — meaning **oldest-first ordering self-advances** and cannot jam on a
poison pill. ⚠️ **Verify that self-exclusion holds before relying on it.**

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
  digital, or because a tier broke, is **unmeasured** — the window jam masks it either way.
- ⚠️ **The tier split on what DID run is worth a look:** **12 rows on gpt-4o** (`tier:'cloud'`,
  `no_page_anchors_gpt4o`) against **3 on `cloud_cheap`** (DocAI) — the documented 6–14× cost
  escalation shape, though all of it predates the 2026-08-12 DocAI fix.
- **`SHAREPOINT_FETCH_URL`** is runtime env; not assertable from the repo. Probe
  `GET /api/diag?kind=env` → `sharepoint_fetch_url_set`.
- **Whether any browser profile is running a stale extension** — unobservable from here (B4).
