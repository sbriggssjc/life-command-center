# ⛔ UW#6 BLOCKED (live test 2026-06-21) — revised to the real fix below

> **Gate outcome:** the capped real drain via the live endpoint returned **20/20 `fetch_failed`
> (`fetch_non_ok`), 0 parsed.** Root cause confirmed: `property_documents.source_url` is a
> CoStar-CDN signed/token path (`ahprd1cdn.csgpimgs.com/d2/<token>/…`) that is **session-gated and
> short-lived** — a document captured the SAME DAY already 403s server-side. `property_documents`
> stores only the URL, never the bytes. So R58's deferred server-side re-fetch **cannot work as
> architected**, which is why it was never drainable. The operational drain is abandoned; the real
> fix is upstream byte-capture (UW#6-REV below). The existing ~325 deeds + ~1,600 docs hold dead
> URLs (bytes gone) → recoverable only by re-capture in CoStar.

## UW#6-REV — capture document bytes at sidebar time (mirror the OM-intake pattern)
1. **Sidebar byte-capture (the fix):** when the CoStar sidebar captures a deed/lease/OM/etc. PDF,
   **download the bytes within the live CoStar session** (the browser HAS the session the server
   lacks) and upload to Storage (the `lcc-om-uploads` bucket / a docs bucket), writing
   `property_documents.storage_path` (+ keep `source_url` for reference). Identical posture to the
   OM intake pipeline, which already stores bytes — `property_documents` is the channel that
   regressed to URL-only.
2. **Deep-parse reads stored bytes:** point the R58 `document-text-tick` fetch at `storage_path`
   first (Storage, always fetchable), falling back to `source_url` only for freshly-captured docs
   within the token window. Then the deed/lease/OM deep-parse (grantor/price/legal-desc → R51 +
   sales cross-ref; lease economics; OM content) runs off durable bytes.
2b. **Auto-capture, not manual + route by doctype (confirmed via the sidebar code + a live
   screenshot 2026-06-21):** today the sidebar only auto-captures the URL ("URL Captured"); bytes
   are captured ONLY if the user manually clicks **"Stage to LCC"** in-session — and that button
   routes through the **OM** pipeline (`/api/intake/stage-om`), so a DEED staged that way stores its
   bytes but may not reach the deed parser (`deed_records` → R51). The fix must (a) **auto-Stage the
   bytes at capture time** (no manual click) and (b) **route by doctype** — deeds → the deed
   pipeline (deed_records/R51), leases → the lease extractor, OMs → stage-om. So the byte the
   browser captures in-session lands in the RIGHT downstream parser.
3. **Backfill the dead-URL docs:** the existing ~325 deeds + ~1,600 docs can't be server-fetched
   (dead tokens). Options to surface for Scott: (a) re-capture on next CoStar encounter (the sidebar
   byte-capture catches them going forward), (b) a one-time re-visit sweep of high-value deeds in
   CoStar. Do NOT pretend a server drain can recover them.

## My gate (UW#6-REV)
- A NEW sidebar capture stores `storage_path` + real bytes; `document-text-tick` then parses that
  doc from Storage end-to-end (deed → grantor/price → R51 fed), 0 `fetch_failed`. Then the drain is
  viable for newly-captured docs. Honest: the legacy URL-only backlog needs re-capture.

---
# (ORIGINAL UW#6 — superseded by the BLOCKED finding above; kept for the record)
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
