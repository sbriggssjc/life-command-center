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

## 0. ⚠️ THE HEADLINE — the pipeline works, and it is pointed at one doctype

**Measured live on gov `property_documents`, 2026-08-31:**

| doctype | docs | with bytes | **with text** | ⚠️ **bytes but NO text** |
|---|---:|---:|---:|---:|
| **deed** | 325 | 325 | **325 (100%)** | **0** ✅ |
| other | 272 | 272 | 0 | **272** |
| om | 288 | 185 | 0 | **185** |
| lease | 127 | 119 | 0 | **119** |
| brochure | 72 | 71 | 0 | **71** |
| dd | 41 | 38 | 0 | 38 |
| master · comp · bov · survey | 52 | 47 | 0 | 47 |
| **TOTAL** | **1,177** | **1,057 (90%)** | **325** | **732** |

**Deeds are 100% extracted. Everything else is 0%.** **732 documents hold durable bytes in storage,
the OCR chain is live and proven, the crons run every 30 minutes — and nothing drains them**, because
**cron 160 filters `doctype=deed`**.

⚠️ **That includes 119 leases** — and gov's firm-term coverage gap (gov `CLAUDE.md` §23–26) has been
waiting on exactly those. **The capture problem was solved. The drain was never widened.**

## 1. Scott's question, answered

> *"At one point there was an issue with access to deeds ingested from CoStar and I asked whether we
> needed to download those deeds and mortgages at ingestion and store them somewhere to be processed
> later."*

**Yes — that was the diagnosis, that was the decision, and it was built.**

The root problem (`UW6_REV_document_byte_capture.md`): `property_documents.source_url` was a
**CoStar CDN signed token** (`ahprd1cdn.csgpimgs.com/d2/<token>/…`), **session-gated and
short-lived**. A doc captured the same day already 403s server-side. **A capped drain returned
20/20 `fetch_failed`; ~86% of `property_documents` were stranded.**

**The decision was exactly what Scott proposed: capture the bytes AT INGEST, while authenticated,
into a per-domain non-pruned `property-documents` bucket.** Explicitly rejected: server-side
deferred re-fetch, datacenter CoStar scraping, CAPTCHA solving.

**Built and merged in two halves — PR #1703 and #1707.** Result: **1,057 of 1,177 gov documents
(90%) now have durable bytes.**

## 2. The pipeline as it stands

**CAPTURE** — `sidebar-pipeline.js::upsertDocumentLinks` writes the row; **`captureDocumentBytesAtIngest`
is called inline** (server re-fetch, works for non-session-bound links) · **the extension fetches
bytes inside the authenticated CoStar tab** (`background.js::fetchDocBytesViaTab` →
`/api/intake?_route=capture-doc-bytes` → `storeClientDocBytes`) — the only way to reach a
session-bound link · **SharePoint** via the PA "Get Artifact" flow · **backfill worker**
`?_route=doc-bytes-backfill` (manual).

**STORAGE** — per-domain `property-documents` bucket, key
`<domain>/<doctype>/<property_id>/<content_hash>.<ext>`. ⚠️ **Bytes in Storage, never inline in
Postgres** (the R15/R18 disk-incident lesson). Readers prefer `storage_path` over `source_url`.

**OCR** — tiered: office-text (docx/xlsx, byte-sniffed, never OCR'd) → free OSS → **Google Document
AI** (`docai-ocr` edge fn, Enterprise Document OCR processor) → gpt-4o vision last resort.
**Default is zero-spend**; the paid tiers are inert unless configured. ✅ **Configured and live.**

**CRONS — verified `active = true` on 2026-08-31:**

| jobid | name | schedule |
|---|---|---|
| **160** | `lcc-document-text-deeds` | `*/30 * * * *` ⚠️ **`doctype=deed` only** |
| **167** | `lcc-cre-doc-text-backfill` | `*/30 * * * *` |
| **169** | `lcc-cre-doc-text-jobs` | `15,45 * * * *` |

**CONSUMPTION** — deed parser (document number, **recording date**, transfer tax → implied price,
grantor/grantee, APN) · lease extractor → `leases` → gov firm-term triggers · CRE doc-text sidecar →
BOV extract · ORE Phase 1 Unit C (grantor/grantee addresses).

## 3. ⚠️ THE BLOCKERS, in priority order

**B1 — Cron 160 drains ONLY `doctype=deed`. 732 documents with bytes have no scheduled pass.**
The single highest-value fix on this page. The chain is proven at 100% on deeds; it is simply not
pointed at leases (119), OMs (185), `other` (272) or brochures (71).
⚠️ **Do not just widen the filter blindly** — check the per-doctype extractor exists and the spend
tier is right; OMs already have their own path (`stageOmIntake`), and `other` at 272 rows is the
largest bucket and the least specified.

**B2 — ⚠️ THE `GovernmentProject` DOCS ARE STALE AND WILL COST MONEY.**
`GovernmentProject/CLAUDE.md` §26 and `RUNBOOK_firm_term_coverage_ops_gates.md` still say
*"the crons are `active=false`"* and instruct the operator to re-enable them and to build **a
CoStar-authenticated non-datacenter (residential-egress) session**. **Both are false today:** the
crons are ACTIVE (verified), and the residential-egress requirement was **obviated** by the
extension in-session capture. **Acting on those docs buys infrastructure that is not needed.**
**Cross-repo fix; cannot be done from this repo's PR.**

**B3 — No cron on `doc-bytes-backfill`.** It ran once (2026-08-12) and was never scheduled, so
anything the two capture paths miss accumulates with nothing sweeping it. **85 gov docs are
`url_only` and 120 have neither bytes nor text today.**

**B4 — Extension reload is silent and per-profile.** Byte capture needs manifest ≥1.0.39;
current is **1.0.45**. ⚠️ **A browser profile still running a pre-1.0.39 unpacked load captures no
bytes at all, with no telemetry.** Cheapest thing to verify.

**B5 — Marketing brochures are excluded from byte capture** by the doctype gate, while gov's own
firm-term queue counts **25 brochures** as term-bearing. Those can never be filled as things stand.

**B6 — `run_county_ingest_cron` is a LIVE producer writing dateless deed rows.** `deed_records`
`created_at` runs to today. ⚠️ **Fix the producer before any backfill** — Class 8.

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

- **dia's `property_documents`** — every count on this page is **gov**. dia was not measured.
- **Whether the 732 have per-doctype extractors** that would succeed if cron 160 were widened —
  B1 says check, and that check has not been done.
- **`SHAREPOINT_FETCH_URL`** is runtime env; not assertable from the repo. Probe
  `GET /api/diag?kind=env` → `sharepoint_fetch_url_set`.
- **Whether any browser profile is running a stale extension** — unobservable from here (B4).
