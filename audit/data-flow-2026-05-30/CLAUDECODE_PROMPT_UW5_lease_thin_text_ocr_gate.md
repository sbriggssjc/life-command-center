# Claude Code — UW#5: lease extractor must OCR thin-text scanned PDFs (not just zero-text)

## Why (live verification, 2026-06-22)
Google Document AI is now fully wired and confirmed processing documents end-to-end
(`ocr_engine: google_docai`, ~95% confidence). Live proof: the El Paso Memorandum of
Lease (folder_feed_seen 5566, dia property 23316) and the Kerrville Memorandum (6152)
OCR'd through the tiered seam and enriched real records.

But the lease corpus won't fully flow to OCR because of a gate in
`api/_handlers/lease-extractor.js` `runLeaseExtraction`. The OCR branch only fires when
the extracted text is **completely empty**:

```js
let text = await leaseTextFromBytes(sp.buffer, sp.contentType || mediaType);   // line ~847
...
if (!text && String(process.env.LEASE_EXTRACT_OCR || 'true').toLowerCase() !== 'false') {  // line ~857
  const ocr = await ocrPdfToTextTiered({ buffer: sp.buffer, mediaType: sp.contentType || mediaType })...
}
if (!text) return { normalized: null, needs_ocr: true, source: 'needs_ocr' };   // line ~866
```

Most scanned executed leases are NOT zero-text — they carry a **thin junk text layer**
(a recording stamp, a page number, OCR bleed). Live example: the Walterboro estoppel
(folder_feed_seen 2835) returns `text_len: 143` / `reason: thin_text_layer` and is marked
`needs_ocr` **without ever calling OCR**, because `!text` is false (143 chars ≠ empty).
So Document AI never sees it.

The **deed path already handles this correctly**. `api/_shared/document-text.js`
(`extractDocumentText`, UW#6) discards a sub-floor PDF text layer before the OCR decision:

```js
const floor = Number.isFinite(minChars) ? minChars : DOC_TEXT_MIN_CHARS;   // 200 default
const thinTextLayer = isPdf && text && floor > 0 && meaningfulTextLen(text) < floor;
if (thinTextLayer) { text = ''; method = null; }   // → routes to OCR
```

The lease extractor needs the same floor. This is the single change that unlocks the bulk
of the scanned-lease corpus to Document AI.

## Fix (surgical, `api/_handlers/lease-extractor.js`)
1. Import the shared helper (single source of truth — do NOT duplicate the threshold):
   `import { ocrPdfToTextTiered, meaningfulTextLen, DOC_TEXT_MIN_CHARS } from '../_shared/document-text.js';`
   (`meaningfulTextLen` is already exported. `DOC_TEXT_MIN_CHARS` is currently a module
   const in document-text.js — **export it** there so it can be imported, or add a tiny
   exported getter. Keep the env knob `DOC_TEXT_MIN_CHARS` (default 200).)
2. In `runLeaseExtraction`, right after `let text = await leaseTextFromBytes(...)` and
   BEFORE the `if (!text ...)` OCR gate, discard a thin PDF text layer so the existing OCR
   branch fires:
   ```js
   const isPdf = /pdf/i.test(sp.contentType || mediaType || '');
   const floor = Number(process.env.LEASE_TEXT_MIN_CHARS || DOC_TEXT_MIN_CHARS);
   if (isPdf && text && floor > 0 && meaningfulTextLen(text) < floor) {
     text = '';   // thin junk layer (recording stamp / page no.) → route to OCR
   }
   ```
   - **PDF-only.** Do NOT apply the floor to docx/xlsx/text salvage paths — those are taken
     at face value (mirror document-text.js's `isPdf` gate). A short legitimate text doc
     must not be force-OCR'd.
   - Everything downstream is unchanged: the tiered OCR call, the guards (location /
     draft / multi-tenant / operator), fill-blanks-only, `source='folder_feed_lease'`
     provenance, one-active-lease dedupe, the `needs_ocr` graceful fallback, and the
     `ocr_tier` / `ocr_engine` / `ocr_pages` telemetry.
3. The thin layer's junk text must NEVER reach the lease prompt — discarding it (set to '')
   guarantees the OCR'd text (or `needs_ocr`) is what flows on. Don't concatenate.

## Re-process the backlog (no re-OCR needed for the decision, but OCR will now run)
The `?id=<id>` resubmit path and the `lease-backfill` drain both run `runLeaseExtraction`,
so they inherit the fix automatically. The previously-parked `thin_text_layer` leases
need to re-enter the queue: extend the lease-backfill eligibility (or a one-pass reparse)
to re-include rows whose `subject_hint.lease_backfill.reason = 'thin_text_layer'` (bump a
marker version the way R58c did with `deed_no_parties_r58c`, so genuine non-OCR-able rows
aren't re-hammered forever). A capped real drain after deploy should show these leases
flip from `thin_text_layer` → `enriched` with `ocr_engine: google_docai`.

## Verify (report back)
- Unit test: a PDF whose `leaseTextFromBytes` returns a sub-200-char junk layer →
  `runLeaseExtraction` calls `ocrPdfToTextTiered` (mock it) and uses the OCR text, NOT the
  junk layer; a real >floor text layer is used directly (no OCR); a docx/xlsx short text is
  NOT force-OCR'd; a true zero-text PDF still OCRs (no regression).
- `node --check`; `ls api/*.js | wc -l` = 12; full suite green.
- Post-deploy (live, gated): a capped `lease-backfill` drain over the re-included
  `thin_text_layer` set returns `ocr_engine: google_docai` and fills lease fields /
  routes conflicts to the Decision Center, exactly like the El Paso memorandum did.

## Boundaries
PDF-only floor; reuse the shared `meaningfulTextLen` + `DOC_TEXT_MIN_CHARS` (no duplicated
threshold); OCR only adds a text layer — guards / fill-blanks / provenance / dedupe all
unchanged; ≤12 api/*.js; no migration. JS ships on the Railway redeploy of merged `main`.

## Bottom line
Document AI works; the lease extractor just wasn't handing it the thin-text scans (only the
zero-text ones). One PDF-only minChars floor — the same one the deed path already uses —
routes the bulk of the scanned-lease corpus through Document AI.
