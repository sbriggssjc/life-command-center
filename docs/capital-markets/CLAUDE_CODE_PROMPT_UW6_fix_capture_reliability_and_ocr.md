# Claude Code prompt — UW#6 fix: byte-capture reliability + OCR + status/doctype (from the live gate)

> The UW#6-REV byte-capture ARCHITECTURE is validated live (2026-06-21): two storage-backed deeds
> (3176, 3171) parsed `via:'storage'` (`deed_parsed`) while url-only deeds correctly `fetch_failed`.
> But the live gate on real captures surfaced four defects that sit between the working foundation
> and actual grantor/price value. Receipts-first; reuse the existing pipeline; ≤12 api/*.js.

## Receipts (live, 2026-06-21)
- **Byte-capture unreliable:** only **7 of 825** gov docs ever got a `storage_path`; Scott's latest
  captures (docs 3222/3236/3237, 17:46–19:11) are still `url_captured` with NO storage_path — the
  auto-capture did not fire. dia = 0 captured.
- **Scanned deeds → no value:** the 2 parsed deeds extracted **32 and 113 chars** (null grantee/
  grantor) → `r51_fed=0`. County deeds are scanned images; pdf-parse yields ~nothing without OCR.
- **needs_ocr threshold bug:** those 32/113-char results were tagged `ingestion_status=
  'text_extracted'`, NOT `needs_ocr` — so they never route to OCR.
- **Status transition bug:** 6 of the 7 storage-backed docs have `storage_path` set but
  `ingestion_status` stuck at `url_captured` (only 3171 flipped to `bytes_captured`).
- **Doctype mis-classification:** "Press Release - Broker" docs were typed `lease`.

## Fixes
1. **Byte-capture must fire on EVERY deep-parse doc, reliably.** Diagnose why it didn't fire on the
   recent captures (3222/3236/3237 resolved a property_id, so resolution isn't the gate). Check the
   background.js `STAGE_DOC_BYTES_TO_LCC` path + console during a live capture: is the in-session
   fetch failing (CoStar token already dead even in the service worker — if so, fetch from the
   CONTENT SCRIPT / tab context, which holds the CoStar session, not the background worker), or is
   the firing condition too narrow? Make it fire for every `DEEP_PARSE_DOCTYPES` doc on capture, and
   log success/failure so it's observable. (Confirm Scott has reloaded the extension to the latest
   build — but also make it robust if a fetch fails: record the failure, don't silently skip.)
2. **Wire the deed path into the UW#4/#4b free-first OCR flow.** Deeds (and many leases) are scanned
   → the deep-parse must OCR them (Surya/PaddleOCR free tier → cheap-cloud escalation) to get
   grantor/consideration/legal-desc. Reuse the `ocrPdfToTextTiered` foundation; run it on the
   storage bytes when the digital-text layer is empty.
3. **Fix the needs_ocr threshold:** a parse yielding < N meaningful chars (e.g. < 200) →
   `ingestion_status='needs_ocr'` (terminal, with text_len), NOT `text_extracted`, so it routes to
   the OCR pass instead of being marked done-with-nothing.
4. **Fix the status transition:** when bytes are uploaded + `storage_path` written, set
   `ingestion_status='bytes_captured'` consistently (the parser keys on storage_path, but the status
   must be truthful). Backfill the 6 mislabeled rows.
5. **Doctype re-validation:** the server's `document-notify` doctype guard must reject obvious
   non-types — "Press Release", "8-K", "Investor Presentation" are `other`, not `lease`/`deed`.

## Gate (re-run after deploy + extension reload)
- A fresh CoStar capture of a deal → byte-capture fires on every doc (storage_path + `bytes_captured`
  in the domain DB), 0 silent skips. `document-text-tick` parses the storage bytes; scanned deeds
  route to OCR (`needs_ocr` then OCR-filled), and a text/OCR'd deed yields a real grantee → `r51_fed`
  > 0 (grantee appears in `v_owner_source_conflict`). Press releases land as `other`. Re-capture =
  idempotent. I'll drive this through the browser + audit the DB.

## Honest status
The foundation works (proven). The grantor/price PAYOFF is gated on (1) reliable capture + (2) OCR
(deeds are scans). This is the same OCR dependency as the leases — UW#6 and UW#4/#4b converge here.
