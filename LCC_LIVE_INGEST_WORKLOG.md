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
- Added `.pptx` intake support for direct uploads and `.eml` attachments, with slide and notes text extraction so PowerPoint decks can feed the same intake pipeline as other Office sources.
- Extended the extraction prompt and proposal parser to support model-returned `source_refs` per operation against an indexed extraction-source catalog, with heuristic lineage retained as fallback when the model does not cite sources.
- Added citation-aware apply gating so operations produced in a low-confidence OCR run without model-cited `source_refs` are flagged individually and require a second acknowledgment before apply.
- Added safer batch controls so the review UI can auto-select only cited operations, letting the lower-risk subset move forward without bundling uncited OCR-dependent operations into the same apply action.
- Tightened the default selection behavior so uncited operations from low-confidence OCR runs now start deselected automatically, making the default apply path conservative without hiding the riskier operations.
- Added targeted OCR retry controls on low-confidence transcript entries so a single source image can be re-read and the proposal remapped without restarting the whole intake batch.
- Added retry-result comparison for OCR retries so each retried source can show before/after transcript text and confidence changes directly in the extraction review panel.
- Weighted proposal ordering toward model-cited and stronger-source operations so the safer subset appears first in the review list instead of being mixed evenly with heuristic or uncited OCR-dependent operations.
- Added inline source-evidence excerpts on operation cards so model-cited quotes or heuristic source snippets are visible directly where the proposed write is reviewed.
- Grouped proposal cards by strongest supporting source so related operations cluster under the same cited document or OCR page instead of rendering as a flat list.
- Added source-group actions so each grouped source section can select or clear all of its operations at once during review.
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
- Reconciled a repo drift issue where the worklog/CSS reflected the advanced live-ingest review flow but the checked-in `app.js` had reverted to an older workbench block; restored the advanced live-ingest block into the current `app.js` and re-ran `node --check app.js`.
- Added persistent OCR retry history in the review UI so retried sources keep an auditable before/after trail across multiple attempts, and re-ran `node --check app.js`.
- Added OCR retry confidence-delta handling so each retry history entry shows whether confidence improved, worsened, or stayed flat, and the retry toast now reports that outcome directly.
- Added OCR retry-result promotion rules so improved OCR sources are marked as promoted and operation-level low-confidence badges now follow the actual cited or matched source instead of inheriting run-level OCR risk across the board.
- Added source-level apply gating for worsened OCR retries so retried sources that lose confidence are flagged in the source list, propagate `Retry Worsened` risk to affected operations, and require a separate acknowledgment before selected risky operations can be applied.
- Repaired a truncated `app.js` live-ingest tail by restoring the missing extraction/parser/apply section from the last good commit and reapplying the newer OCR retry safeguards on top of the repaired block.
- Added default auto-deselection for operations tied to OCR sources that worsened after retry, alongside the existing citation-risk auto-deselection behavior.
- Added bulk toolbar actions for worsened-retry operations so the review surface can select only that subset or clear it in one step, while also clearing stale worsened-risk acknowledgments when bulk selection changes.
- Restored source-group review rendering in the proposal panel and added safe group controls: `Select Group`, `Include Worsened`, and `Clear Group`, with default group selection continuing to keep worsened-retry operations deselected unless explicitly included.
- Added source-group risk summaries plus an `Acknowledge Group Risk` shortcut when the currently selected risky operations are isolated to one source group, so low-confidence/citation/worsened acknowledgments can be applied from the group header instead of only in the global footer.
- Added legacy Office intake coverage for `.doc` and `.xls` by extracting readable string previews from binary files in both direct-upload handling and server-side email attachment normalization, with regression coverage in `test/live-ingest-normalize.test.js`.
- Added per-group acknowledgment state indicators in the grouped review header so each source cluster can show whether OCR/citation/retry gates are pending, already acknowledged, or not active for the currently selected operations.
- Added legacy `.ppt` intake coverage alongside the earlier `.doc` and `.xls` support, using the same readable-string preview strategy for direct uploads and email attachments, with regression coverage in `test/live-ingest-normalize.test.js`.
- Added a top-level review toolbar summary that aggregates the currently selected operation gates, showing selected-count plus OCR/citation/retry gate status as pending or acknowledged without requiring group expansion.
- Tightened the legacy binary attachment heuristics for `.doc`, `.xls`, and `.ppt` so previews preserve cleaner business text and more table-like rows while filtering out more OLE/container noise, with updated regression coverage for the legacy Excel row/header case.
- Improved server-side PDF text preview heuristics so attachment normalization can extract cleaner text from `BT`/`ET` text blocks, `TJ` arrays, and escaped PDF literal strings instead of relying mainly on broad ASCII runs.
- Added PDF preview de-duplication across repeated text fragments and multi-block extracts so recurring headers or duplicated lease lines do not get overrepresented in normalized attachment text.
- Extended PDF preview extraction to handle hex-encoded text operators across separate text blocks, improving coverage for noisier multi-stream PDFs that mix literal and hex string content.
- Added `FlateDecode` PDF stream extraction so compressed text streams can be inflated and passed through the same PDF operator parser, improving preview coverage for more realistic attachment PDFs.
- Extended PDF stream decoding to support `ASCIIHexDecode` and `ASCII85Decode` filter chains before operator parsing, improving preview coverage for encoded multi-stream attachment PDFs.
- Added `RunLengthDecode` PDF stream support so another common opaque stream wrapper can still feed readable operator text into live-ingest normalization.
- Added PDF `/DecodeParms` predictor handling on top of `FlateDecode`, including PNG-style predictor reversal for row-prefixed streams, so predictor-heavy compressed PDFs can still surface readable operator text during normalization.
- Added `LZWDecode` PDF stream support, including predictor pass-through after LZW expansion, so older or export-heavy PDFs using LZW-compressed text streams can still produce readable preview text.
- Added decoded-stream text fallback for PDFs so compressed or filtered streams without standard `BT`/`ET` text operators can still contribute clean text-like runs into normalized attachment previews.
- Added PDF document-metadata harvesting for document-info and XMP-style fields so metadata-heavy attachments can still contribute useful labels when page-text extraction is sparse.
- Added PDF annotation and accessibility text harvesting for keys like `/Contents`, `/T`, `/Alt`, and `/ActualText`, so authored sidecar labels can supplement sparse page-text extraction.
- Added PDF embedded-file metadata harvesting for `/Filespec` labels like file names and descriptions, so package-style PDFs can expose useful attachment labels even before deeper embedded-file extraction exists.
- Added conservative PDF embedded-payload extraction for readable `/EmbeddedFile` streams, so package-style PDFs can contribute actual text-like embedded content instead of only file-spec labels.
- Extended PDF embedded-payload extraction to recognize richer payload types, including OOXML documents and common text-like subtypes, so embedded DOCX/XLSX/PPTX-style content can feed into the same preview pipeline.
- Added PDF embedded-image extraction so image-like `/EmbeddedFile` payloads now surface as `extracted_attachments` for both direct PDF intake and PDF email attachments, feeding the existing OCR/multimodal path.
- Extended PDF embedded-payload extraction to recognize legacy Office binaries as well, so embedded `.doc`/`.xls`/`.ppt` content now uses the same cleaned preview heuristics as direct legacy Office attachments.
- Extended PDF embedded-payload extraction to recognize embedded email exports too, so packaged `.eml` content now flows through the same email normalizer instead of degrading to generic text-run extraction.
- Added generic ZIP handling for embedded PDF payloads so non-OOXML archives can contribute readable text-like entries such as `.txt`, `.csv`, `.json`, `.html`, and nested `.eml` sidecars.
- Added embedded RTF handling for PDF payloads so packaged `.rtf` content now converts to readable text instead of leaking control words through the generic fallback path.
- Added embedded calendar handling for PDF payloads so packaged `.ics` content now converts to a cleaner event summary instead of falling back to raw RFC lines.
- Added embedded delimited-text handling for PDF payloads so packaged TSV-style exports now render as readable rows instead of generic plain-text fallback.
- Added embedded YAML handling for PDF payloads so packaged `.yaml`/`.yml`-style sidecars now normalize cleanly instead of relying on the generic text fallback.

## Next Follow-Up Candidates
- Move to richer binary attachment heuristics for embedded mixed-content binaries beyond the current PDF and legacy Office preview paths, especially additional niche embedded binary families or the remaining opaque PDF stream filters.
- Add deeper source-precedence weighting and identity-link heuristics from domain-specific external IDs, not just current-record metadata.
