# Unit 4 — BUILD NOTES (what shipped)
**Date:** 2026-07-17 · **Status:** built, unit-tested, migration live on LCC Opps.

Unit 4 is the missing consumer the whole intake chain was waiting for: it turns a
property's persisted lease/DD/OM text into the BOV generator's request record so
"BOV this property" produces the identical workbook from any access point — because
the lease data is ONE extracted, reviewed record, not re-OCR'd per request.

---

## What shipped (file map)

**Database (LCC Opps `xengecqvemvfknjvbvrq`) — migration APPLIED:**
`supabase/migrations/20260802120000_lcc_r58_unit4_cre_doc_text_and_bov_extraction.sql`
- `lcc_cre_property_document_text` — the **raw_text sidecar** (2A). OCR/text runs
  once per doc; unique on `(document_id, extractor_version)`; carries `pages` jsonb
  (page-anchored text for clause_refs), `ocr_tier`/`ocr_confidence`, `needs_ocr`.
- `lcc_cre_bov_extraction` — the reviewable **Unit-4 record** (2B). One row per
  `(cre_property_id, extractor_version)`; `record` jsonb = the generator payload;
  `status` extracted→reviewed; `citation_risk`/`ocr_confidence`/`source_document_ids`.
- Both RLS-enabled, no policies (service-key only) — matches `lcc_cre_property_documents`.

**2A — persist raw_text (thin worker over Unit 1):**
- `api/_shared/cre-property-doc-text.js` — `runPropertyDocText(documentId, deps)`:
  registry row → `extractDocumentText` (tiered OCR, DocAI layout preferred for
  page anchors) → upsert sidecar. Idempotent; `needs_ocr` recorded; transient
  fetch failure left for retry. Plus `fetchEligibleCreDocs` and `enqueueCreDocText`.
- `api/_handlers/cre-doc-text.js` — drain tick (`?_route=cre-doc-text-tick`):
  `mode=eligible` scans registry docs with no sidecar; `mode=jobs` drains the
  `cre.doc.text` enrichment_jobs lane. Dry-run on GET.

**2B — Unit 4 proper (raw_text → BOV schema):**
- `api/_shared/bov-extract.js` — `extractBovRecord(crePropertyId, deps)`:
  gathers the property's text sidecars, runs `invokeExtractionAI` per lease → one
  tenant (abstract + rent_schedule + credit hints + **clause_refs** with page
  resolved from the sidecar `pages[]`), merges DD/OM → real_estate +
  underwriting_hints, and (via `runBovExtract`) persists to `lcc_cre_bov_extraction`.
  Advisory figures (asking price/cap) are routed through `extraction-field-policy`
  so they land as *hints*, never a reported field.
- `api/_handlers/bov-extract.js` — `?_route=bov-extract`: GET reports sidecar
  coverage; POST `{cre_property_id}` extracts + persists (status `extracted`).

**2C — generator consumes the record:**
- `bov-generator/main.py` — `/generate-bov` now accepts `{ cre_property_id }`:
  loads the reviewed record, merges any posted overrides (via `exclude_unset` so a
  `{cre_property_id}`-only body never wipes the record's tenants), and builds the
  same `BOVRequest`. Input models are `extra="allow"` so real_estate / abstract /
  clause_refs ride through. **Hand-authored payloads are unchanged** — proven by
  rebuilding both masters through the model path (DG 862 formulas, MOB 1233, 0 errors).
- `bov-generator/bov_record_loader.py` — stdlib-only loader; reviewed-first,
  `BOV_ALLOW_UNREVIEWED` opt-in for extracted. Needs `LCC_OPS_URL` + `LCC_OPS_SERVICE_KEY`.

**Step 4 — auto-enqueue at intake:**
- `api/_shared/cre-registry.js` — after a lease/dd/om is attached to the registry,
  `enqueueCreDocText` fires a `cre.doc.text` job (id in `external_id`, since
  `enrichment_jobs.target_id` is uuid and the doc id is bigint). Guarded to the
  extractable types; best-effort, never blocks registration.
- `api/intake.js` — routes `cre-doc-text-tick` and `bov-extract` registered.

**Tests:** `18` assertions green (parse, page-anchor resolution, lease→tenant with
clause_refs, DD→real_estate, MOB/NNN derivation, advisory-guard quarantine, persist
upsert, needs_ocr/transient handling) + enqueue-guard + the 2C model/merge suite.

---

## How reality differed from the draft spec

- **Two document registries.** `document-text.js`'s `raw_text` lives on the DOMAIN
  dbs' `property_documents` (deed/OM pipeline, `domainQuery`). The CRE leases are in
  **LCC Opps** `lcc_cre_property_documents` (`opsQuery`), which has **no** text
  column — so 2A adds the sidecar on the CRE/opsQuery side, not the domain side.
- **No `raw_text` on the registry** and `staged_intake_extractions.intake_id` is
  NOT NULL — so the Unit-4 record can't live there; it gets its own typed table
  `lcc_cre_bov_extraction` keyed by `cre_property_id` (the spec's "and/or typed
  table" path).
- **`invokeStructuredExtractionAI` doesn't exist** — the real helper is
  `invokeExtractionAI({prompt})` (self-contained prompt → JSON, fallback chain).
- **id/target_id type mismatch** — doc id is bigint, `enrichment_jobs.target_id`
  is uuid, so the job carries the id in `external_id` (text).

---

## LIVE STATUS (2026-07-17, after scheduling)

- **Drain cron is running in production.** `lcc-cre-doc-text-backfill` (pg_cron
  jobid 167, `*/30 * * * *`) → `POST /api/intake?_route=cre-doc-text-tick&mode=eligible&limit=15`.
  Smoke-tested live: HTTP 200, real docs processed, sidecars written. The digital
  docs extract fast (≤50/tick); scanned leases OCR via **google_docai** at ~2/tick
  (22s wall-clock budget), so the ~444-lease scanned backlog is a multi-day drain.
- **Daily coverage report** scheduled: `trig_015cppx2Q66hNoznbBKWDm3T` (13:00 UTC,
  push on). It reports coverage %, OCR-tier mix, and flags when lease coverage is
  high enough to advance to Step 2B.
- **Pilot record** live: `lcc_cre_bov_extraction` id 1 (property 16, reviewed) →
  generator `{cre_property_id:16}` reproduces the master byte-for-byte (10,537/10,537).

## Two production findings (fixed in code; one has an external dependency)

1. **Per-page anchors from OCR.** DocAI returns a page COUNT but Unit 1 wasn't
   capturing per-page TEXT, so lease `clause_refs` couldn't resolve real PAGE
   numbers from OCR (sections always work). FIXED on the code side: Unit 1
   (`document-text.js` `ocrCloudCheap`/tiered/`extractDocumentText`) now threads a
   `pageTexts` array → the sidecar `pages` column → `clause_refs`. **External
   dependency:** the DocAI wrapper behind `OCR_CLOUD_OCR_URL` must return per-page
   text (`page_texts` / `pages_text` / a `pages` ARRAY). Until it does, OCR'd
   leases get sections but no page numbers. Pilot/hand-authored records are
   unaffected (their pages are set).
2. **Thin OCR results.** A lease that fell through to gpt-4o returned 48 chars and
   was marked "done." FIXED: a sub-floor OCR result is tagged `reason='thin_ocr_result'`
   (and gpt-4o transcriptions `no_page_anchors_gpt4o`); Unit 4's gather treats both
   as `citation_risk` so a human reviews rather than trusting junk text.

**These three files are committed but PENDING the next redeploy** (they are not in
the currently-running deploy): `api/_shared/document-text.js`,
`api/_shared/cre-property-doc-text.js` (also carries the idempotency guard),
`api/_shared/bov-extract.js`. Plus `vercel.json` (named-path rewrites). After that
redeploy, enable the forward `jobs`-lane cron (commented in the cron migration).

## ⚠️ DocAI page-anchors BLOCKED by a processor-type misconfig (2026-07-17)

The `page_texts` code change is deployed (docai-ocr **v16**, hardened) and committed —
correct and proven innocent via A/B (the hardened build still 502→gpt-4o, so the
failure is not ours). Root cause of the OCR failures, found via a throwaway
`docai-diag` function that reproduced the exact call path:

- Service account + OAuth token: **fine** (token mint returns 200).
- Document AI returns **HTTP 400 INVALID_ARGUMENT**, fieldViolation:
  `entity_types: "Must have at least one entity type."`
- Meaning: the configured processor **`e1904ab5a10ddf4c`** (project
  `modular-conduit-450617-h5`, SA `lcc-deed-ocr@…`) is a **Custom Extractor /
  entity-extraction** processor, NOT a **Document OCR** processor. The wrapper
  sends a doc for OCR; a Custom Extractor rejects it because it wants trained
  entity types. So every scanned lease/deed 502s → falls back to gpt-4o (pricier,
  no page anchors). (Note: a google_docai success appeared earlier the same day,
  so the processor env was likely changed mid-day to this wrong processor.)

**THE FIX (GCP / env — no code):**
1. Google Cloud Console → Document AI → Processors. Create (or find) a
   **"Document OCR"** processor (a.k.a. Enterprise Document OCR) in a `us`/`eu`
   location. Custom Extractor ≠ Document OCR.
2. Copy its Processor ID.
3. Update the edge-function env `GOOGLE_DOCAI_PROCESSOR_ID` (or the full
   `GOOGLE_DOCAI_PROCESSOR` resource name) to the OCR processor. No redeploy of
   docai-ocr needed — it re-reads env per invocation.
4. Verify: `GET .../functions/v1/docai-diag` was the probe (now disabled); instead
   run a `cre-doc-text-tick` and confirm a sidecar with `ocr_engine='google_docai'`
   now has `page_count>0` and a populated `pages` array. Then delete `docai-diag`
   from the dashboard (no MCP delete tool; it's inert/410 in the meantime).

Once the OCR processor is set, page anchors populate automatically AND scanned
OCR stops burning gpt-4o. The rest of Unit 4 is unaffected and running.

## Coverage-gated auto-extraction (Step 2B, self-advancing)

Built so records generate automatically as the backlog drains — safely:
- **`v_lcc_cre_bov_ready`** (view, APPLIED): properties whose lease/dd/om are FULLY
  text-covered and have ≥1 lease. 3 properties already qualify.
- **Sweep** (`api/_handlers/bov-extract.js` `mode=sweep`, `bov-extract.js`
  `fetchReadyProperties`/`runBovExtractSweep`): extracts each ready-and-not-yet-done
  property, bounded by limit + ~25s budget. Records land **status='extracted'
  (review-gated)** — the generator prefers 'reviewed', so an auto-extracted record
  never silently drives a client deliverable.
- **Cron** `lcc-cre-bov-extract-sweep` (migration written, NOT yet applied): every
  2h, 5 properties/tick. Gated by construction — only fully-covered properties.

## ✅ ACTIVATED (2026-07-17) — all three crons live, verified

Redeploy confirmed live (sweep handler + idempotency guard responding). Activation
run end-to-end:
- `lcc-cre-doc-text-backfill` (*/30) · `lcc-cre-doc-text-jobs` (:15/:45) ·
  `lcc-cre-bov-extract-sweep` (17 */2) — all active.
- First auto-extracted record produced by the sweep (property 301, review-gated).
- Records: 1 reviewed (pilot 16) + 1 extracted; readiness view: 3 properties.
- Only remaining item is the EXTERNAL DocAI-wrapper per-page-text change (Step 6
  below) for OCR-derived lease PAGE anchors; sections + everything else work.

## ACTIVATION SEQUENCE — reference (already executed; re-run safe/idempotent)

The redeploy carries: `document-text.js` (page passthrough), `cre-property-doc-text.js`
(idempotency guard + thin-OCR flag), `bov-extract.js` + `bov-extract.js` handler
(sweep + citation flags), `vercel.json` (named-path rewrites). Then:

1. Verify: `GET /api/cre-doc-text-tick` and `GET /api/bov-extract?mode=sweep` return 200.
2. Apply migration `20260802150000_..._bov_extract_sweep_cron.sql` (schedules the sweep).
3. Enable the forward doc-text `jobs`-lane cron (uncomment in `20260802130000_..._cre_doc_text_cron.sql`).
4. Update the DocAI wrapper behind `OCR_CLOUD_OCR_URL` to return per-page text
   (`page_texts` / `pages_text` / a `pages` array) → lease clause_ref PAGE numbers
   populate automatically (code side already threads it).

Until then: the doc-text backlog keeps draining on the live cron, the daily report
tracks coverage, and the pilot `{cre_property_id:16}` path already works.

## Remaining OPS steps (not code — runtime)

1. **Schedule the drain tick.** Point the existing tick scheduler at
   `POST /api/intake?_route=cre-doc-text-tick&mode=jobs` (drains enqueued
   `cre.doc.text` jobs) and/or `&mode=eligible` (sweeps the 444-lease backlog).
   Same cap+repeat-tick model as `document-text-tick`.
2. **Set generator env** on Railway: `LCC_OPS_URL`, `LCC_OPS_SERVICE_KEY` (and
   optionally `BOV_ALLOW_UNREVIEWED=true` while piloting).
3. **OCR tier for page anchors:** ensure `OCR_CLOUD_OCR_URL` (DocAI `cloud_cheap`
   layout) is configured so lease clause_refs get real page numbers; gpt-4o stays
   last-resort.
4. **Backfill the pilots.** The Valley (Slavich/Shelley/Enhabit/Daycare) and DG
   leases aren't all in `lcc_cre_property_documents` yet — drop them in the property
   folders so the feed classifies them, then the tick fills sidecars → run
   `?_route=bov-extract&cre_property_id=16` (Valley) and the DG property id, review,
   and regenerate both masters via `{cre_property_id}` to confirm they match the
   hand-authored workbooks (pilot acceptance).
