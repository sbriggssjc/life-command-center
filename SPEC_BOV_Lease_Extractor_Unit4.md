# SPEC — BOV / Lease Structured Extractor (R58 "Unit 4")
**Status:** ✅ BUILT (2026-07-17) · migration applied to LCC Opps · code committed · unit-tested
**Owner surface:** LCC Opps (`xengecqvemvfknjvbvrq`) · `api/_shared/`
**Depends on:** `document-text.js` (Unit 1), `ai.js`, the folder-feed intake, the BOV generator schema

> **Build notes:** see `SPEC_BOV_Lease_Extractor_Unit4_BUILD.md` for exactly what
> shipped, the file map, how the real schema differed from the draft, and the two
> remaining ops steps (schedule the drain tick · backfill the pilot deals).

---

## 1. Why this exists

`document-text.js`'s header already names this unit: *"a future rent-roll / dd / **bov** extractor — Unit 4."* Everything upstream exists and is live; this is the missing consumer.

**What's already true (verified July 2026):**
- `folder_feed_cre` scans `/sites/TeamBriggs20/Shared Documents/PROPERTIES/**` and writes classified rows to **`lcc_cre_property_documents`** (`id, cre_property_id, file_name, document_type, source_url, source, created_at`). Live counts: lease 444 · dd 250 · comp 134 · bov 78 · master 74 · om 67.
- **Unit 1** (`document-text.js`) turns a doc's bytes → text: digital via pdf-parse; scanned via the tiered OCR (`ocrPdfToTextTiered`: pdf-text → free tesseract → `cloud_cheap` Google Document AI → gpt-4o vision), byte-source aware for both absolute vendor URLs and SharePoint server-relative refs, with the `DOC_TEXT_MIN_CHARS` thin-text-layer floor.
- **Unit 2** (deed) proves the pattern; structured output lands in `staged_intake_extractions.extraction_snapshot`.

**The gap:** `lcc_cre_property_documents` has **no persisted `raw_text`**, and no unit turns a property's lease/DD text into the **BOV generator schema**. This spec closes both.

---

## 2. Two-step build

### 2A. Persist `raw_text` (thin worker over Unit 1)

Add a text sidecar so OCR runs **once per document** and every consumer reuses it.

- **Schema:** new table `lcc_cre_property_document_text` — `document_id (FK → lcc_cre_property_documents.id)`, `raw_text text`, `method text ('text_extracted'|'ocr')`, `ocr_tier text ('free'|'cloud_cheap'|'gpt4o')`, `ocr_confidence numeric`, `page_count int`, `pages jsonb (per-page text + page number, from the DocAI layout tier)`, `thin_text_layer bool`, `char_len int`, `extracted_at timestamptz`, `extractor_version text`. (Kept as a sidecar so the registry stays a registry; matches how `staged_intake_extractions` hangs off `intake_id`.)
- **Worker:** `runPropertyDocText(documentId, deps)` — reads the registry row, fetches bytes via `fetchDocBytes({ sourceUrl, storageRef })` (already SharePoint-aware), calls `extractDocumentText(...)`, upserts the sidecar. Idempotent on `(document_id, extractor_version)`.
- **Tier rule for leases/DD:** force `ocrTiered: true` and prefer the **DocAI `cloud_cheap` layout** response — it returns **page-anchored text**, which is what fills the abstract's `clause_refs` page column. gpt-4o vision is transcription-only fallback (no reliable page anchors) — never the lease default (the tests already assert this).
- **Trigger:** enqueue on the same bridge that classifies (`sharepoint.document.classify` / folder-feed), filtered to `document_type in ('lease','dd')`. Reuses `enqueueEnrichmentJob` / `claimPendingJobs` in `bridges.js`.

### 2B. Unit 4 — `bov-extract.js` (raw_text → BOV schema)

`extractBovRecord(crePropertyId, deps) → { property, tenants[], real_estate, underwriting_hints }` shaped to the **BOV generator's Pydantic schema** (the output contract already exists in `main.py`):

- Gather the property's `document_type in ('lease','dd','om')` text sidecars.
- Run `invokeStructuredExtractionAI` (`ai.js`) per lease → one `TenantInput` with its `abstract` (LeaseAbstractInput), `rent_schedule[]`, `credit` hints, and **`clause_refs`** (page from the sidecar `pages[]`, section from the model). Same structured-extraction pattern as the deed parser (Unit 2).
- Merge the DD/OM text into `real_estate` (year built, parcel/APN, land, zoning, flood, demographics) and `underwriting_hints` (in-place NOI, cap, price).
- Apply `extraction-field-policy.js` + `field-priority-guard.js` (executed lease > OM > CoStar > estimate) so provenance/precedence matches the rest of the system.
- **Persist:** `staged_intake_extractions` with `document_type='bov'` (and/or a typed `lcc_cre_lease_abstract` table), so it's reviewable in the live-ingest UI like every other extraction, with `ocr_confidence` / citation-risk flags already rendered there.

### 2C. BOV generator consumes the record

`POST /generate-bov` gains an alternate input: `{ cre_property_id }` → the API loads the latest reviewed Unit-4 record and builds the same `BOVRequest` payload the schema already accepts. Hand-authored payloads still work unchanged. Result: "BOV this property" from any access point produces the identical workbook, because the lease data is the one extracted record — not re-read per request.

---

## 3. Routing across access points (the consistency guarantee)

One substrate, many callers. Every access point reads/writes the **same** `lcc_cre_property_documents` (+ text sidecar + extraction), so output is identical regardless of origin:

- **Claude / Cowork / Northmarq Project** — before abstracting a lease, query the property's text sidecar; if present, use it; if absent, enqueue Unit 1 (don't `pdftotext` or re-OCR locally). *(This session's lesson.)*
- **Copilot / M365** — the folder-feed + bridge already run server-side; Copilot reads the extracted record.
- **Email intake** — the existing Outlook intake flow drops the attachment into the folder-feed → Unit 1 → Unit 4, same path.
- **ChatGPT / ad-hoc** — allowed to *draft*, but must write results back through the intake bridge; never a silo.

**Standing rule:** *extract once at intake → persist to `lcc_cre_property_documents` (+ sidecar/extraction) → all consumers read it; never re-OCR at the access point.*

---

## 4. Build order

1. `lcc_cre_property_document_text` migration + `runPropertyDocText` worker (Unit 1 already does the OCR — this is wiring + persistence). Backfill `document_type='lease'` for the two pilot deals (Valley MOB, Dollar General) first.
2. `bov-extract.js` (Unit 4) → `staged_intake_extractions`, reviewed in the live-ingest UI.
3. `/generate-bov?cre_property_id=…` input path.
4. Turn on lease/DD auto-enqueue in the classify bridge.

**Pilot acceptance:** the four Valley leases (Slavich, Shelley, Enhabit, Daycare — three scanned, one docx) and the Dollar General lease produce populated `abstract` + `rent_schedule` + `clause_refs` (with page numbers from the DocAI layout tier) with zero manual `pdftotext`, and regenerate both master BOVs identically to the hand-authored ones.
