# LCC Live Ingest Worklog

## Scope
- Feature: shared live-ingest surface for Government and Dialysis dashboards.
- Goal: let users drag/drop screenshots or source files, extract facts with AI, preview proposed writes, and route approved changes into existing audited database/process paths.

## Objectives
- Add a reusable intake UI under both dashboards, anchored in the existing `Research` workflow.
- Support practical source capture from emails, webpages, and saved exports.
- Reuse existing mutation/write paths instead of creating an unaudited side channel.
- Preserve traceability so future chats can pick up this work quickly.

## Design Decisions
- Placement: embedded at the top of both `Research` tabs so intake sits next to current research queues instead of becoming a disconnected tab.
- Extraction path: use the existing multimodal `/api/chat` flow because it already accepts image `data_url` attachments.
- Writeback path: use existing audited client helpers:
  - `applyChangeWithFallback`
  - `applyInsertWithFallback`
  - `canonicalBridge`
- Safety model: AI only proposes writes; the UI shows the operations first, then the user applies selected operations.

## Current MVP Capabilities
- Drag/drop image files.
- Upload PDFs and automatically convert the first pages into images for AI extraction.
- Extract selectable text from PDFs when available, alongside rendered page images.
- Upload `docx` files and extract document text client-side before AI extraction.
- Preserve more `docx` context by extracting comments, deleted text markers, footnotes, and endnotes.
- Paste clipboard screenshots.
- Capture a live screen snapshot.
- Attach text-based exports (`.txt`, `.md`, `.csv`, `.json`, `.html`, `.htm`, `.eml`).
- Search for and bind a Government or Dialysis target record directly inside the intake card.
- Normalize HTML and raw email sources on the server before they are sent to AI.
- Normalize richer multipart email structure on the server, including attachment summaries for `.eml` sources.
- Send current research context plus attachments to AI for structured mapping.
- Preview proposed `update`, `insert`, and `bridge` operations with editable per-operation JSON before apply.
- Preview proposed updates against fetched current record values for before/after review when a target record can be resolved.
- Refresh before/after snapshots globally or per operation without rerunning extraction.
- Search and bind a canonical entity so extraction can produce stronger `update_entity` and bridge follow-up proposals.
- Generate canonical entity suggestions automatically from current record metadata and rank them by domain/location/identity fit.
- Auto-select canonical entities when the best suggestion is clearly dominant and expose confidence in the intake UI.
- Weight canonical entity suggestions with more domain-specific signals such as asset/org type, operator/agency fit, and preferred source systems.
- Apply selected operations into Government or Dialysis write paths.
- Automatically log successful live-ingest sessions into `research_queue_outcomes` for provenance.

## Constraints / Known Gaps
- PDF uploads are rendered as images and now include selectable PDF text when available, but they still lack OCR for image-only PDFs; `docx` extraction now includes comments/deletions/notes but still does not resolve embedded files or full tracked-change semantics.
- Email normalization now extracts readable text-like attachments plus simple embedded PDF and `docx` text when those payloads contain extractable text, but it still does not OCR image-only PDFs/images or unpack more complex Office/image binaries embedded inside `.eml` files.
- Operation quality depends on current record context and the source material. The prompt blocks fabricated IDs, so some proposed writes may stop at `missing_information`.
- Dialysis research selection is still limited by the existing screen behavior; the new lookup flow mitigates that, but queue-to-selection behavior is still worth tightening later.

## Files Changed
- `app.js`
- `index.html`
- `api/live-ingest.js`
- `api/_shared/live-ingest-normalize.js`
- `gov.js`
- `dialysis.js`
- `styles.css`
- `LCC_LIVE_INGEST_WORKLOG.md`
- `test/live-ingest-normalize.test.js`

## What Changed
- Added a shared `Live Intake` workbench renderer/binder in `app.js`.
- Added browser-side attachment normalization for screenshots and text exports.
- Added extraction prompt + JSON proposal parsing.
- Added authenticated server-side normalization for HTML and `.eml` text sources.
- Extended server-side email normalization to summarize multipart attachments and combine more readable MIME text parts.
- Extended server-side email normalization again to recurse through nested MIME parts and include readable excerpts from text-like attachments such as CSV, JSON, HTML, and nested email content.
- Extended server-side email normalization again to decode attached PDF payloads and surface readable embedded PDF text when available, without claiming OCR for image-only pages.
- Extended server-side email normalization again to decode attached `docx` payloads with a minimal ZIP/XML reader and surface body text, comments, and notes when present.
- Tightened tracked-change handling for `docx` extraction so inserted/deleted revisions now preserve author/date context in both direct `docx` intake and `.eml`-embedded `docx` normalization.
- Extended `.eml` normalization and client extraction wiring so attached email images can flow back as extracted image attachments into the existing multimodal AI path, instead of only appearing in attachment summaries.
- Added `.xlsx` intake support for direct uploads and `.eml` attachments, with workbook/sheet/shared-string parsing that converts spreadsheet rows into readable tabular text for extraction.
- Added a vision-based OCR transcript step in the client live-ingest flow so attached images, screenshots, and image-only PDF pages can contribute extracted text context before proposal generation, while still being passed as images for multimodal reasoning.
- Added an `Extraction Inputs` review block in the intake UI so normalized source text and OCR transcripts can be inspected before applying proposed operations.
- Split OCR review into page-level transcript entries with source-image labels and confidence tags so each excerpt can be traced back to its originating screenshot or attachment.
- Added explicit low-confidence OCR warnings in the review UI and highlighted those transcript entries so uncertain text is visible before writeback.
- Added low-confidence OCR acknowledgment gating so `Apply Selected` stays disabled until the transcript warning is explicitly acknowledged, with the same rule enforced in the apply handler.
- Added OCR-aware proposal tagging so operations generated from an extraction run that included low-confidence OCR are labeled individually in the review list and the proposal notes call that out explicitly.
- Added heuristic source-lineage tagging for proposal operations by matching operation text against extraction inputs, so review cards can point to the most likely OCR page or source document.
- Added client-side PDF rendering into page images for multimodal intake.
- Added client-side PDF text extraction via `pdf.js` text content when the PDF contains selectable text.
- Added client-side `docx` text extraction via document XML parsing.
- Extended `docx` extraction to include comments, deleted text markers, footnotes, and endnotes.
- Added apply flow for selected operations through existing audited mutation helpers.
- Added target-record lookup and manual binding inside the intake surface.
- Added automatic provenance logging after successful live-ingest apply operations.
- Added richer proposal review UI with field summaries, select-all/select-none, and editable JSON per operation.
- Added pre-apply snapshot loading for update operations so review can show current vs proposed field values.
- Added snapshot refresh controls and fallback matching without auxiliary filters when strict snapshot lookups miss.
- Added canonical entity search/binding in the intake surface and pass-through of selected entity context into extraction.
- Added automatic canonical entity suggestion ranking from record metadata and matched external identities.
- Added high-confidence entity auto-selection when one candidate clearly outranks the rest.
- Added more domain-specific entity weighting using asset/org metadata and preferred source systems.
- Injected the workbench into both Government and Dialysis research tabs.
- Added styling for the new intake surface and proposal preview.

## Verification Plan
- Syntax check updated JS files.
- Run unit tests for source normalization helper.
- Confirm PDF renderer integration does not break page script loading.
- Confirm both dashboards render the intake card.
- Confirm file picker / paste / capture actions do not throw.
- Confirm extraction path builds a proposal and apply flow routes through mutation helpers.

## Verification Status
- `node --check app.js` passed.
- `node --check gov.js` passed.
- `node --check dialysis.js` passed.
- Follow-up record-lookup changes in `app.js` also passed `node --check app.js`.
- `node --check api/live-ingest.js` passed.
- `node --check api/_shared/live-ingest-normalize.js` passed.
- `node --test test/live-ingest-normalize.test.js` passed.
- PDF intake follow-up changes in `app.js` also passed `node --check app.js`.
- DOCX intake follow-up changes in `app.js` also passed `node --check app.js`.
- Proposal review/editor follow-up changes in `app.js` also passed `node --check app.js`.
- Before/after snapshot diff follow-up changes in `app.js` also passed `node --check app.js`.
- Snapshot refresh/matching follow-up changes in `app.js` also passed `node --check app.js`.
- Canonical entity binding follow-up changes in `app.js` also passed `node --check app.js`.
- Automatic entity suggestion/ranking follow-up changes in `app.js` also passed `node --check app.js`.
- High-confidence entity auto-select follow-up changes in `app.js` also passed `node --check app.js`.
- Domain-specific entity weighting follow-up changes in `app.js` also passed `node --check app.js`.
- Richer DOCX extraction follow-up changes in `app.js` also passed `node --check app.js`.
- Richer email normalization follow-up changes passed `node --check api/_shared/live-ingest-normalize.js`.
- Updated email normalization tests passed `node --test test/live-ingest-normalize.test.js`.

## Next Follow-Up Candidates
- Add stronger OCR quality handling such as retry prompts or model-returned source citations, plus deeper extraction for more complex Office payloads such as legacy Excel or PowerPoint files.
- Add deeper source-precedence weighting and identity-link heuristics from domain-specific external IDs, not just current-record metadata.
