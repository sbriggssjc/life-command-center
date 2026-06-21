# Claude Code prompt — UW#6: drain the document deep-parse (R58) on gov + dia

> From the deed/loan ingestion audit (task #37). R58 built a document-text deep-parser
> (`document-text-tick` → `deed-parser.js` etc.) that extracts grantor / grantee / consideration /
> legal description from deed PDFs (feeding R51 owner reconciliation + sales cross-ref), and text
> from lease/OM/DD/master/BOV PDFs. **It has NEVER been drained on gov.** Receipts-first; capped →
> gate → drain; fill-blanks + provenance-gated; the R58 parser + guards are unchanged — this turns
> the pipeline ON.

## Grounding (live, 2026-06-21)
- gov `property_documents`: **0 of ~825 docs are text-extracted** (`raw_text` empty,
  `ingestion_status` un-extracted) despite ~100% carrying a `source_url`: **deed 169**, lease 121,
  om 243, dd 38, master 29, bov 6, brochure 44, other 165, comp 9, survey 1. The R58 deep-parse has
  not run here.
- The deed **index** records (`deed_records`, 5,660) are a DIFFERENT source (assessor/recorder
  index): grantee 98% + parcel 98%, but **grantor 13%, consideration 1.8%, transfer_tax 0% — and
  those are NULL in their `raw_payload` (source-limited, NOT a cheap re-parse).** The real
  grantor/price come from the **169 deed PDFs** above, via the deep-parse. (Don't chase grantor/price
  from the index — that's the county-valuation dead-lever again.)
- dia: confirm the same `property_documents` un-drained state and include it (deeds first).

## The ask — operational drain of the EXISTING R58 pipeline (+ surface any build gap)
1. **Confirm the R58 `document-text-tick` is deployed + healthy** and that the deed branch still
   feeds `properties.latest_deed_grantee`/`_date` (R51) + the sales cross-ref, per the R58 notes.
   Flag any blocker (CoStar-CDN auth on `source_url`, OpenAI key for scanned-deed OCR, a wiring bug).
2. **Capped → gate → drain, deeds FIRST** (they feed owner reconciliation + suspected-sales):
   `GET /api/document-text-tick?doctype=deed&domain=both&limit=10` (dry-run), then
   `POST …?limit=10` (capped real). Report: `text_extracted / deed_parsed / needs_ocr`,
   `deed_records_created`, `r51_fed` (grantees pushed to the owner-conflict lane), `sales_verified`,
   and 0 wrong-writes. Then broad-drain the 169 deeds, then lease/om/dd/master/bov.
3. **Boundaries:** fill-blanks only; provenance-gated (`source='recorded_deed'`/`folder_feed_lease`
   per R58); reject ≤0/sentinels (the UW#1 lesson); never overwrite curated values; reversible;
   no fabrication (a field the PDF doesn't state stays blank). The implied-price-from-transfer-tax
   path stays gated (`DEED_IMPLIED_PRICE_FILL`, candidate-only, never overwrites a curated price).

## My gate
- Dry-run counts first. Capped real drain shows deeds parsed → grantor/consideration/legal-desc
  extracted from the actual PDFs (where the index lacked them), grantees feeding the R51 lane, 0
  clobbers, idempotent. Then broad-drain. The OM/DD/master parse (rich underwriting content) is the
  follow-on once deeds are clean — it directly feeds the OM/BOV assembly audit (task #34).
- Honest ceiling: scanned image-only deeds → `needs_ocr` (sized, recorded with text_len) → folds
  into the UW#4/#4b free-OCR path. Report the needs_ocr share so we size it.

## Note
This is operational like the lease drain — once deployment is confirmed I can drive the capped drain
through the browser session and audit each batch, same as UW#2. Surface any real build gap (auth,
OCR, wiring) rather than forcing a partial run.
