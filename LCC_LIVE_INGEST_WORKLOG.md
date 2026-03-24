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
- Paste clipboard screenshots.
- Capture a live screen snapshot.
- Attach text-based exports (`.txt`, `.md`, `.csv`, `.json`, `.html`, `.htm`, `.eml`).
- Search for and bind a Government or Dialysis target record directly inside the intake card.
- Send current research context plus attachments to AI for structured mapping.
- Preview proposed `update`, `insert`, and `bridge` operations.
- Apply selected operations into Government or Dialysis write paths.

## Constraints / Known Gaps
- Direct PDF/docx parsing is not implemented in this pass; screenshots are the supported path for those sources.
- Operation quality depends on current record context and the source material. The prompt blocks fabricated IDs, so some proposed writes may stop at `missing_information`.
- Dialysis research selection is still limited by the existing screen behavior; the new lookup flow mitigates that, but queue-to-selection behavior is still worth tightening later.

## Files Changed
- `app.js`
- `gov.js`
- `dialysis.js`
- `styles.css`
- `LCC_LIVE_INGEST_WORKLOG.md`

## What Changed
- Added a shared `Live Intake` workbench renderer/binder in `app.js`.
- Added browser-side attachment normalization for screenshots and text exports.
- Added extraction prompt + JSON proposal parsing.
- Added apply flow for selected operations through existing audited mutation helpers.
- Added target-record lookup and manual binding inside the intake surface.
- Injected the workbench into both Government and Dialysis research tabs.
- Added styling for the new intake surface and proposal preview.

## Verification Plan
- Syntax check updated JS files.
- Confirm both dashboards render the intake card.
- Confirm file picker / paste / capture actions do not throw.
- Confirm extraction path builds a proposal and apply flow routes through mutation helpers.

## Verification Status
- `node --check app.js` passed.
- `node --check gov.js` passed.
- `node --check dialysis.js` passed.
- Follow-up record-lookup changes in `app.js` also passed `node --check app.js`.

## Next Follow-Up Candidates
- Add first-class PDF/email parsing on the server.
- Add record lookup/search inside the intake card when no current record is selected.
- Add richer per-operation field diff UI.
- Auto-link successful ingest sessions into `research_queue_outcomes` with source provenance.
