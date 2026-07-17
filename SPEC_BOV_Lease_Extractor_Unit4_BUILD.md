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
