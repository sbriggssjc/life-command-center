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
- Upload `docx` files and extract document text client-side before AI extraction.
- Paste clipboard screenshots.
- Capture a live screen snapshot.
- Attach text-based exports (`.txt`, `.md`, `.csv`, `.json`, `.html`, `.htm`, `.eml`).
- Search for and bind a Government or Dialysis target record directly inside the intake card.
- Normalize HTML and raw email sources on the server before they are sent to AI.
- Send current research context plus attachments to AI for structured mapping.
- Preview proposed `update`, `insert`, and `bridge` operations with editable per-operation JSON before apply.
- Preview proposed updates against fetched current record values for before/after review when a target record can be resolved.
- Refresh before/after snapshots globally or per operation without rerunning extraction.
- Search and bind a canonical entity so extraction can produce stronger `update_entity` and bridge follow-up proposals.
- Generate canonical entity suggestions automatically from current record metadata and rank them by domain/location/identity fit.
- Auto-select canonical entities when the best suggestion is clearly dominant and expose confidence in the intake UI.
- Apply selected operations into Government or Dialysis write paths.
- Automatically log successful live-ingest sessions into `research_queue_outcomes` for provenance.

## Constraints / Known Gaps
- PDF uploads are rendered as images, not parsed into structured text; `docx` extraction currently reads main document text only and does not resolve comments, tracked changes, or embedded files.
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
- Added client-side PDF rendering into page images for multimodal intake.
- Added client-side `docx` text extraction via document XML parsing.
- Added apply flow for selected operations through existing audited mutation helpers.
- Added target-record lookup and manual binding inside the intake surface.
- Added automatic provenance logging after successful live-ingest apply operations.
- Added richer proposal review UI with field summaries, select-all/select-none, and editable JSON per operation.
- Added pre-apply snapshot loading for update operations so review can show current vs proposed field values.
- Added snapshot refresh controls and fallback matching without auxiliary filters when strict snapshot lookups miss.
- Added canonical entity search/binding in the intake surface and pass-through of selected entity context into extraction.
- Added automatic canonical entity suggestion ranking from record metadata and matched external identities.
- Added high-confidence entity auto-selection when one candidate clearly outranks the rest.
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

## Next Follow-Up Candidates
- Add deeper handling for `docx` comments/tracked changes, PDFs with OCR/text extraction, and richer MIME email attachments.
- Add more domain-specific weighting for entity suggestions using asset/agency/operator metadata and external identity source precedence.
